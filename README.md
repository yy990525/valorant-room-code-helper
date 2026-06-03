# 无畏契约抢码上车助手

这是一个 Windows 屏幕辅助工具：截取抖音直播里你框选的房间码区域，用 OCR 识别 5-8 位英数字房间码，然后粘贴到无畏契约的房间码输入框。

它不读取或修改游戏内存，也不绕过反作弊；本质上只做截图识别、剪贴板粘贴和鼠标点击。使用前请确认不违反游戏和平台规则。

## 使用方法

1. 安装依赖：

   ```powershell
   npm install
   ```

2. 打开抖音直播窗口和无畏契约房间码窗口，让两个窗口都露出来。

3. 首次配置：

   ```powershell
   npm run setup
   ```

   按提示依次操作：

   - 框选抖音直播画面里房间码会出现的位置
   - 第一段框选后，程序会立刻截图并打印识别结果
   - 点击无畏契约的房间码输入框
   - 点击无畏契约的“加入房间”按钮

4. 测试当前框选区域识别效果：

   ```powershell
   npm run test-ocr
   ```

   调试截图会保存到 `debug/last-ocr.png`。如果识别不准，先打开这张图看裁剪区域是不是正好框住了房间码。

   如果识别到了 `Code`，程序会立刻把这个值写入系统剪贴板，所以你手动 `Ctrl+V` 也会粘贴同一个值。如果没有识别出 `Code`，剪贴板不会被修改。

5. 开始监听：

   ```powershell
   npm run start
   ```

## 运行快捷键

启动后终端里可以直接按：

- `p`：暂停或继续
- `o`：暂停时单次识别
- `q` 或 `Ctrl+C`：停止

识别成功时会响铃，并打印类似：

```text
>>> DETECTED ABC123 confidence=87.5. Filling VALORANT input...
```

## 抢码增强配置

编辑 `config.json` 可以调这些：

```json
{
  "confirmFrames": 2,
  "historySize": 20,
  "beepOnDetect": true,
  "enterAfterPaste": false,
  "autoSubmit": false,
  "useCodePattern": false,
  "minConfidence": 54,
  "pollMs": 450
}
```

- `confirmFrames`：连续识别到同一个码几次才执行，默认 2，减少误识别。
- `historySize`：记录最近识别过的码，避免重复粘贴。
- `beepOnDetect`：识别成功后响铃。
- `enterAfterPaste`：粘贴后按回车，默认关闭。
- `autoSubmit`：粘贴后自动点击“加入房间”，默认关闭。
- `useCodePattern`：是否用正则匹配房间码，默认关闭。关闭时截图 OCR 读到什么英数字就打印/粘贴什么。
- `minConfidence`：识别置信度阈值，漏识别可降低，误触发可提高。
- `pollMs`：截图识别间隔，越小越快，但更吃性能。

## Code 输出规则

默认不再用正则匹配房间码。程序会同时加载英文和简体中文 OCR：

- `Text`：完整 OCR 文本，中文也会保留，方便调试截图内容。
- `Code`：从 OCR 文本里提取出的英文字母和数字候选，用于粘贴房间码。

例如 OCR 读到：

```text
ALE458
```

就会输出：

```text
Code: ALE458
```

如果裁剪区域像空白或对比度太低，程序会直接提示 `Crop looks blank...`，避免 OCR 在空白图上乱猜出 `EE` 这类结果。

OCR 会优先识别 `debug/last-crop-raw.png`，也就是你看到的原始裁剪图；如果原图没有读出内容，才会尝试 `debug/last-ocr.png` 这张预处理图。输出里的 `Source` 会告诉你实际采用了哪张图。

监听模式下，只有识别出 `Code` 并通过连续帧确认后，才会点击输入框、粘贴和加入房间；没有识别出值时不会执行下一步。

常见原因：

- 框选区域没有真正框住房间码，先看 `debug/last-ocr.png`。
- 房间码还没出现在直播画面里。
- 字太小、被弹幕遮挡、直播压缩太糊。
- 多显示器负坐标裁剪错误。这个版本已修复，会按房间码所在显示器截图。
- 置信度低于 `minConfidence`，这时会显示具体原因。

如果你之后又想启用正则过滤，可以改：

```json
{
  "useCodePattern": true,
  "codePattern": "[A-Z0-9]{5,8}"
}
```

## 识别不准时

- 重新运行 `npm run setup`，房间码区域尽量框小一点，只框住字符。
- 用 `npm run test-ocr` 看 `Raw`、`Normalized`、`Reason`。
- 打开 `debug/last-ocr.png`，确认截图里字符清楚。
- 把抖音窗口放大，关闭弹幕遮挡。
- 如果截图是黑的，把抖音或游戏切到窗口化/无边框窗口化。
