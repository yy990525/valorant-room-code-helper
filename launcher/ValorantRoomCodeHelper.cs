using System;
using System.Diagnostics;
using System.IO;

class ValorantRoomCodeHelper
{
    static int Main(string[] args)
    {
        Console.OutputEncoding = System.Text.Encoding.UTF8;
        Console.InputEncoding = System.Text.Encoding.UTF8;

        string exeDir = AppDomain.CurrentDomain.BaseDirectory;
        string projectDir = FindProjectDir(exeDir);
        if (projectDir == null)
        {
            Console.WriteLine("找不到项目目录。请把 exe 放在项目目录或 dist 目录里运行。");
            Pause();
            return 1;
        }

        while (true)
        {
            Console.Clear();
            Console.WriteLine("无畏契约抢码上车助手");
            Console.WriteLine("====================");
            Console.WriteLine("项目目录: " + projectDir);
            Console.WriteLine();
            Console.WriteLine("1. 开始自动识别并填充");
            Console.WriteLine("2. 重新配置截图/输入/加入位置");
            Console.WriteLine("3. 测试 OCR 并复制识别值");
            Console.WriteLine("4. 打开调试截图目录");
            Console.WriteLine("5. 退出");
            Console.WriteLine();
            Console.Write("请选择 1-5: ");

            string choice = Console.ReadLine();
            if (choice == "1")
            {
                RunNpm(projectDir, "start");
            }
            else if (choice == "2")
            {
                RunNpm(projectDir, "setup");
            }
            else if (choice == "3")
            {
                RunNpm(projectDir, "test-ocr");
            }
            else if (choice == "4")
            {
                OpenDebugDir(projectDir);
            }
            else if (choice == "5")
            {
                return 0;
            }
        }
    }

    static string FindProjectDir(string exeDir)
    {
        string current = exeDir;
        for (int i = 0; i < 4; i++)
        {
            if (File.Exists(Path.Combine(current, "package.json")) && Directory.Exists(Path.Combine(current, "src")))
            {
                return current;
            }

            DirectoryInfo parent = Directory.GetParent(current.TrimEnd(Path.DirectorySeparatorChar));
            if (parent == null)
            {
                break;
            }
            current = parent.FullName;
        }
        return null;
    }

    static void RunNpm(string projectDir, string script)
    {
        Console.Clear();
        Console.WriteLine("运行: npm run " + script);
        Console.WriteLine("按 Ctrl+C 可停止 start 监听。");
        Console.WriteLine();

        ProcessStartInfo startInfo = new ProcessStartInfo();
        startInfo.FileName = "cmd.exe";
        startInfo.Arguments = "/c npm run " + script;
        startInfo.WorkingDirectory = projectDir;
        startInfo.UseShellExecute = false;

        using (Process process = Process.Start(startInfo))
        {
            process.WaitForExit();
            Console.WriteLine();
            Console.WriteLine("命令已结束，退出码: " + process.ExitCode);
        }

        Pause();
    }

    static void OpenDebugDir(string projectDir)
    {
        string debugDir = Path.Combine(projectDir, "debug");
        if (!Directory.Exists(debugDir))
        {
            Directory.CreateDirectory(debugDir);
        }
        Process.Start("explorer.exe", debugDir);
    }

    static void Pause()
    {
        Console.WriteLine();
        Console.WriteLine("按回车返回菜单...");
        Console.ReadLine();
    }
}
