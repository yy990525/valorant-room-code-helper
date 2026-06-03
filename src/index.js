import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import screenshot from 'screenshot-desktop';
import { Jimp } from 'jimp';
import { createWorker, PSM } from 'tesseract.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const configPath = path.join(rootDir, 'config.json');
const debugDir = path.join(rootDir, 'debug');
const selectorPath = path.join(__dirname, 'select-region.ps1');
const tessdataDir = path.join(rootDir, 'tessdata');

const defaultConfig = {
  codeRegion: null,
  inputPoint: null,
  joinPoint: null,
  pollMs: 450,
  cooldownMs: 2200,
  minConfidence: 54,
  confirmFrames: 2,
  historySize: 20,
  beepOnDetect: true,
  enterAfterPaste: false,
  hotkeys: true,
  autoSubmit: false,
  clickJoin: true,
  clearBeforePaste: true,
  useCodePattern: false,
  ocrLanguages: 'eng+chi_sim',
  codePattern: '[A-Z0-9]{5,8}',
  substitutions: {},
  debugImages: true
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function loadConfig() {
  if (!(await pathExists(configPath))) {
    return { ...defaultConfig };
  }

  const raw = await fs.readFile(configPath, 'utf8');
  return { ...defaultConfig, ...JSON.parse(raw) };
}

async function saveConfig(config) {
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function runPowerShell(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-Sta',
      '-ExecutionPolicy',
      'Bypass',
      ...args
    ], {
      windowsHide: false,
      ...options
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', chunk => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error((stderr || stdout || `PowerShell exited with ${code}`).trim()));
      }
    });
  });
}

async function selectRegion(title) {
  const output = await runPowerShell([
    '-File',
    selectorPath,
    '-Mode',
    'region',
    '-Title',
    title
  ]);
  return JSON.parse(output);
}

async function selectPoint(title) {
  const output = await runPowerShell([
    '-File',
    selectorPath,
    '-Mode',
    'point',
    '-Title',
    title
  ]);
  return JSON.parse(output);
}

function printOcrResult(result, label = 'OCR result') {
  console.log(`\n${label}:`);
  console.log(`Text: ${result.text ?? '(not found)'}`);
  console.log(`Code: ${result.code ?? '(not found)'}`);
  console.log(`Raw: ${result.rawText || '(empty)'}`);
  console.log(`Normalized: ${result.normalizedText || '(empty)'}`);
  console.log(`Confidence: ${result.confidence.toFixed(1)}`);
  console.log(`Source: ${result.source}`);
  console.log(`Reason: ${result.reason}`);
  console.log(`Debug screen: ${path.join(debugDir, 'last-screen.png')}`);
  console.log(`Debug raw crop: ${path.join(debugDir, 'last-crop-raw.png')}`);
  console.log(`Debug OCR crop: ${path.join(debugDir, 'last-ocr.png')}`);
}

async function setup() {
  const config = await loadConfig();

  console.log('\nStep 1/3: drag around the Douyin room-code area.');
  config.codeRegion = await selectRegion('Select Douyin room code area');
  console.log('Saved code region:', config.codeRegion);
  console.log('\nTaking one screenshot and reading the room code...');

  const worker = await createOcrWorker(config);
  try {
    const result = await recognizeOnce(worker, config);
    printOcrResult(result, 'Room code after Step 1');
    if (result.code) {
      await copyToClipboard(result.code);
      console.log(`Copied to clipboard: ${result.code}`);
    } else {
      console.log('No code recognized. Clipboard was not changed.');
    }
  } finally {
    await worker.terminate();
  }

  console.log('\nStep 2/3: click the VALORANT room-code input box.');
  config.inputPoint = await selectPoint('Click VALORANT code input box');
  console.log('Saved input point:', config.inputPoint);

  console.log('\nStep 3/3: click the VALORANT Join Room button.');
  config.joinPoint = await selectPoint('Click VALORANT Join Room button');
  console.log('Saved join point:', config.joinPoint);

  await saveConfig(config);
  console.log(`\nSetup complete. Config saved to ${configPath}`);
  console.log('Run: npm run start');
}

async function ensureTessdata() {
  await fs.mkdir(tessdataDir, { recursive: true });
  const languages = ['eng', 'chi_sim'];
  for (const language of languages) {
    const target = path.join(tessdataDir, `${language}.traineddata.gz`);
    if (await pathExists(target)) {
      continue;
    }

    const source = path.join(
      rootDir,
      'node_modules',
      '@tesseract.js-data',
      language,
      '4.0.0_best_int',
      `${language}.traineddata.gz`
    );
    await fs.copyFile(source, target);
  }
}

async function cropAndPrepare(region, debugImages) {
  const display = await findDisplayForRegion(region);
  const imageBuffer = await screenshot({ format: 'png', screen: display.id });
  if (debugImages) {
    await fs.mkdir(debugDir, { recursive: true });
    await fs.writeFile(path.join(debugDir, 'last-screen.png'), imageBuffer);
  }

  const image = await Jimp.read(imageBuffer);
  const x = Math.max(0, Math.round(region.x - display.left));
  const y = Math.max(0, Math.round(region.y - display.top));
  const width = Math.min(image.bitmap.width - x, Math.round(region.width));
  const height = Math.min(image.bitmap.height - y, Math.round(region.height));

  if (width <= 0 || height <= 0) {
    throw new Error('Configured code region is outside the screen.');
  }

  const cropped = image.crop({ x, y, w: width, h: height });
  const rawCropBuffer = await cropped.getBuffer('image/png');
  if (debugImages) {
    await fs.writeFile(path.join(debugDir, 'last-crop-raw.png'), rawCropBuffer);
  }

  const stats = getImageStats(cropped);

  cropped.greyscale();
  cropped.brightness(0.12);
  cropped.contrast(0.45);
  cropped.resize({
    w: Math.max(width * 3, 420)
  });

  const buffer = await cropped.getBuffer('image/png');
  if (debugImages) {
    await fs.mkdir(debugDir, { recursive: true });
    await fs.writeFile(path.join(debugDir, 'last-ocr.png'), buffer);
  }
  return {
    rawBuffer: rawCropBuffer,
    processedBuffer: buffer,
    stats
  };
}

function getImageStats(image) {
  const data = image.bitmap.data;
  const pixels = image.bitmap.width * image.bitmap.height;
  let min = 255;
  let max = 0;
  let brightPixels = 0;
  let darkPixels = 0;

  for (let i = 0; i < data.length; i += 4) {
    const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
    min = Math.min(min, brightness);
    max = Math.max(max, brightness);
    if (brightness > 180) brightPixels += 1;
    if (brightness < 60) darkPixels += 1;
  }

  return {
    width: image.bitmap.width,
    height: image.bitmap.height,
    contrast: max - min,
    brightRatio: brightPixels / pixels,
    darkRatio: darkPixels / pixels
  };
}

function looksBlank(stats) {
  return stats.contrast < 18 || (stats.brightRatio < 0.002 && stats.darkRatio > 0.92);
}

async function findDisplayForRegion(region) {
  const displays = await screenshot.listDisplays();
  const centerX = region.x + region.width / 2;
  const centerY = region.y + region.height / 2;
  const containing = displays.find(display => (
    centerX >= display.left &&
    centerX <= display.right &&
    centerY >= display.top &&
    centerY <= display.bottom
  ));

  if (containing) {
    return containing;
  }

  return displays
    .map(display => {
      const displayCenterX = display.left + display.width / 2;
      const displayCenterY = display.top + display.height / 2;
      const distance = Math.hypot(centerX - displayCenterX, centerY - displayCenterY);
      return { display, distance };
    })
    .sort((a, b) => a.distance - b.distance)[0].display;
}

function normalizeCode(text, config) {
  const normalizedText = text.replace(/\s+/g, ' ').trim();
  const upper = normalizedText.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const chars = [...upper].map(char => config.substitutions?.[char] ?? char);
  const codeCandidate = chars.join('');
  if (!config.useCodePattern) {
    return {
      text: normalizedText || null,
      code: codeCandidate || null,
      normalizedText
    };
  }

  const match = codeCandidate.match(new RegExp(config.codePattern));
  return {
    text: normalizedText || null,
    code: match?.[0] ?? null,
    normalizedText
  };
}

function extractConfidence(result) {
  const words = result.data?.words ?? [];
  const useful = words.filter(word => /[A-Za-z0-9]/.test(word.text));
  if (!useful.length) {
    return result.data?.confidence ?? 0;
  }

  const total = useful.reduce((sum, word) => sum + word.confidence, 0);
  return total / useful.length;
}

async function createOcrWorker(config) {
  await ensureTessdata();
  const worker = await createWorker(config.ocrLanguages, 1, {
    langPath: tessdataDir,
    gzip: true,
    cachePath: path.join(rootDir, '.tesseract-cache'),
    logger: event => {
      if (event.status === 'recognizing text') {
        process.stdout.write(`\rOCR ${(event.progress * 100).toFixed(0)}%   `);
      }
    }
  });

  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_LINE,
    debug_file: 'NUL',
    preserve_interword_spaces: '0'
  });

  return worker;
}

async function recognizeOnce(worker, config) {
  const { rawBuffer, processedBuffer, stats } = await cropAndPrepare(config.codeRegion, config.debugImages);
  const rawAttempt = await recognizeBuffer(worker, rawBuffer, config, 'last-crop-raw.png');
  if (rawAttempt.text && !(looksBlank(stats) && rawAttempt.confidence < 45)) {
    return rawAttempt;
  }

  const processedAttempt = await recognizeBuffer(worker, processedBuffer, config, 'last-ocr.png');
  if (processedAttempt.text && !(looksBlank(stats) && processedAttempt.confidence < 45)) {
    return processedAttempt;
  }

  if (looksBlank(stats)) {
    return {
      text: null,
      code: null,
      rawText: '',
      normalizedText: '',
      confidence: Math.max(rawAttempt.confidence, processedAttempt.confidence),
      source: `${rawAttempt.source}, ${processedAttempt.source}`,
      reason: `Crop looks blank or has too little contrast. contrast=${stats.contrast.toFixed(1)}, brightRatio=${stats.brightRatio.toFixed(4)}`
    };
  }

  return processedAttempt;
}

async function recognizeBuffer(worker, buffer, config, source) {
  const result = await worker.recognize(buffer);
  const rawText = result.data?.text ?? '';
  const { text, code, normalizedText } = normalizeCode(rawText, config);
  const confidence = extractConfidence(result);
  const reason = getOcrReason({ text, code, rawText, normalizedText, confidence }, config);
  return {
    text,
    code,
    rawText: rawText.trim(),
    normalizedText,
    confidence,
    source,
    reason
  };
}

function getOcrReason(result, config) {
  if (!result.rawText.trim()) {
    return 'OCR did not read any text. The crop may be empty, hidden, too small, or the stream text is not visible yet.';
  }
  if (!result.text) {
    return 'OCR read text, but it became empty after whitespace cleanup.';
  }
  if (!config.useCodePattern) {
    return 'OK. Pattern matching is disabled, so OCR text is printed directly.';
  }
  if (!result.code) {
    return `Text did not match codePattern ${config.codePattern}. Change codePattern if the room code length is different.`;
  }
  if (result.confidence < config.minConfidence) {
    return `Code matched, but confidence is below minConfidence ${config.minConfidence}.`;
  }
  return 'OK';
}

function psString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function copyToClipboard(value) {
  if (!value) {
    throw new Error('Cannot copy an empty value to clipboard.');
  }

  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    `[System.Windows.Forms.Clipboard]::SetText(${psString(value)})`,
    `$actual = [System.Windows.Forms.Clipboard]::GetText()`,
    `if ($actual -ne ${psString(value)}) { throw "Clipboard verification failed. Expected ${value}, got $actual" }`
  ].join('; ');

  await runPowerShell(['-Command', script], { windowsHide: true });
}

async function fillCode(code, config) {
  if (!code) {
    console.log('\nNo code recognized. Skipping paste/join.');
    return false;
  }

  const mouseInputType = 'using System; using System.Runtime.InteropServices; public static class MouseInput { [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y); [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo); public const uint LEFTDOWN = 0x0002; public const uint LEFTUP = 0x0004; public static void Click(int x, int y) { SetCursorPos(x, y); mouse_event(LEFTDOWN, 0, 0, 0, UIntPtr.Zero); mouse_event(LEFTUP, 0, 0, 0, UIntPtr.Zero); } }';
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    `Add-Type -TypeDefinition ${psString(mouseInputType)}`,
    `[System.Windows.Forms.Clipboard]::SetText(${psString(code)})`,
    `$actual = [System.Windows.Forms.Clipboard]::GetText()`,
    `if ($actual -ne ${psString(code)}) { throw "Clipboard verification failed. Expected ${code}, got $actual" }`,
    `[MouseInput]::Click(${Math.round(config.inputPoint.x)}, ${Math.round(config.inputPoint.y)})`,
    'Start-Sleep -Milliseconds 70',
    config.clearBeforePaste ? '[System.Windows.Forms.SendKeys]::SendWait("^a")' : '',
    config.clearBeforePaste ? 'Start-Sleep -Milliseconds 40' : '',
    '[System.Windows.Forms.SendKeys]::SendWait("^v")',
    config.enterAfterPaste ? 'Start-Sleep -Milliseconds 50' : '',
    config.enterAfterPaste ? '[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")' : '',
    config.clickJoin && config.autoSubmit ? 'Start-Sleep -Milliseconds 80' : '',
    config.clickJoin && config.autoSubmit ? `[MouseInput]::Click(${Math.round(config.joinPoint.x)}, ${Math.round(config.joinPoint.y)})` : ''
  ].filter(Boolean).join('; ');

  await runPowerShell(['-Command', script], { windowsHide: true });
  return true;
}

function assertConfigured(config) {
  const missing = [];
  if (!config.codeRegion) missing.push('codeRegion');
  if (!config.inputPoint) missing.push('inputPoint');
  if (config.clickJoin && !config.joinPoint) missing.push('joinPoint');
  if (missing.length) {
    throw new Error(`Missing ${missing.join(', ')}. Run: npm run setup`);
  }
}

function createKeyControls(state) {
  if (!process.stdin.isTTY) {
    return () => {};
  }

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  const onData = key => {
    const value = String(key).toLowerCase();
    if (key === '\u0003' || value === 'q') {
      state.shouldStop = true;
      return;
    }
    if (value === 'p') {
      state.paused = !state.paused;
      console.log(`\n${state.paused ? 'Paused' : 'Resumed'}.`);
      return;
    }
    if (value === 'o') {
      state.scanOnce = true;
      state.paused = true;
      console.log('\nScanning once...');
    }
  };

  process.stdin.on('data', onData);

  return () => {
    process.stdin.off('data', onData);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
  };
}

function addHistory(history, code, limit) {
  history.unshift({
    code,
    at: new Date().toISOString()
  });
  if (history.length > limit) {
    history.length = limit;
  }
}

function isInHistory(history, code) {
  return history.some(item => item.code === code);
}

function writeStatus(message) {
  process.stdout.write(`\r${message.padEnd(120, ' ')}`);
}

async function start() {
  const config = await loadConfig();
  assertConfigured(config);

  console.log('\nStarting room-code helper.');
  console.log(`Mode: ${config.autoSubmit ? 'auto paste + click Join' : 'paste only, you click Join manually'}`);
  console.log(`Confirm frames: ${config.confirmFrames}, min confidence: ${config.minConfidence}`);
  console.log(config.hotkeys ? 'Keys: p pause/resume, o scan once while paused, q or Ctrl+C stop.\n' : 'Press Ctrl+C to stop.\n');

  const worker = await createOcrWorker(config);
  let lastCode = null;
  let lastAcceptedAt = 0;
  let pendingCode = null;
  let pendingCount = 0;
  const history = [];
  const state = {
    paused: false,
    scanOnce: false,
    shouldStop: false
  };
  const cleanupKeys = config.hotkeys ? createKeyControls(state) : () => {};

  try {
    while (!state.shouldStop) {
      if (state.paused && !state.scanOnce) {
        writeStatus(`${new Date().toLocaleTimeString()} paused`);
        await sleep(120);
        continue;
      }

      state.scanOnce = false;
      const now = Date.now();
      const result = await recognizeOnce(worker, config);
      const conf = Number.isFinite(result.confidence) ? result.confidence : 0;
      const status = result.code
        ? `candidate=${result.code} ${pendingCode === result.code ? `${pendingCount + 1}/${config.confirmFrames}` : `1/${config.confirmFrames}`} confidence=${conf.toFixed(1)} raw="${result.rawText}"`
        : `no code confidence=${conf.toFixed(1)} normalized="${result.normalizedText}"`;
      writeStatus(`${new Date().toLocaleTimeString()} ${status}`);

      if (result.code && conf >= config.minConfidence) {
        if (pendingCode === result.code) {
          pendingCount += 1;
        } else {
          pendingCode = result.code;
          pendingCount = 1;
        }
      } else {
        pendingCode = null;
        pendingCount = 0;
      }

      const ready = (
        result.code &&
        pendingCode === result.code &&
        pendingCount >= config.confirmFrames &&
        result.code !== lastCode &&
        !isInHistory(history, result.code) &&
        now - lastAcceptedAt >= config.cooldownMs
      );

      if (ready) {
        lastCode = result.code;
        lastAcceptedAt = now;
        addHistory(history, result.code, config.historySize);
        if (config.beepOnDetect) {
          process.stdout.write('\x07');
        }
        console.log(`\n>>> DETECTED ${result.code} confidence=${conf.toFixed(1)}. Filling VALORANT input...`);
        const filled = await fillCode(result.code, config);
        if (!filled) {
          console.log('No paste/join action was performed.');
        }
      }

      await sleep(config.pollMs);
    }
  } finally {
    cleanupKeys();
    await worker.terminate();
  }
}

async function testOcr() {
  const config = await loadConfig();
  if (!config.codeRegion) {
    throw new Error('Missing codeRegion. Run: npm run setup');
  }
  const worker = await createOcrWorker(config);
  try {
    const result = await recognizeOnce(worker, config);
    printOcrResult(result, 'OCR test result');
    if (result.code) {
      await copyToClipboard(result.code);
      console.log(`Copied to clipboard: ${result.code}`);
    } else {
      console.log('No code recognized. Clipboard was not changed.');
    }
  } finally {
    await worker.terminate();
  }
}

async function main() {
  const command = process.argv[2] ?? 'start';
  if (command === 'setup') {
    await setup();
    return;
  }
  if (command === 'start') {
    await start();
    return;
  }
  if (command === 'test-ocr') {
    await testOcr();
    return;
  }

  console.error(`Unknown command: ${command}`);
  console.error('Use one of: setup, start, test-ocr');
  process.exitCode = 1;
}

main().catch(error => {
  console.error('\nError:', error.message);
  process.exitCode = 1;
});
