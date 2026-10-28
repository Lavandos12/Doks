using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Text;
using System.Windows.Forms;

namespace DoksLauncher
{
    public class DoksTrayApp : ApplicationContext
    {
        private NotifyIcon trayIcon;
        private Form logWindow;
        private RichTextBox logBox;
        private Process agentProcess;
        private string rootDir;
        private string webUrl = "http://127.0.0.1:3000";

        public DoksTrayApp()
        {
            rootDir = AppDomain.CurrentDomain.BaseDirectory;
            InitializeLogWindow();
            InitializeTrayIcon();
            StartAgent();
        }

        private Icon CreateBrandIcon()
        {
            Bitmap bmp = new Bitmap(32, 32);
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                using (SolidBrush bg = new SolidBrush(Color.FromArgb(99, 102, 241)))
                {
                    g.FillEllipse(bg, 1, 1, 30, 30);
                }
                using (Font f = new Font("Segoe UI", 16, FontStyle.Bold, GraphicsUnit.Pixel))
                using (SolidBrush fg = new SolidBrush(Color.White))
                {
                    SizeF sz = g.MeasureString("D", f);
                    g.DrawString("D", f, fg, (32 - sz.Width) / 2, (32 - sz.Height) / 2);
                }
            }
            return Icon.FromHandle(bmp.GetHicon());
        }

        private void InitializeLogWindow()
        {
            logWindow = new Form();
            logWindow.Text = "Doks — Терминал агента (Сверните или закройте крестиком, чтобы спрятать в трей)";
            logWindow.Size = new Size(780, 480);
            logWindow.BackColor = Color.FromArgb(13, 15, 23);
            logWindow.ForeColor = Color.FromArgb(226, 232, 240);
            logWindow.StartPosition = FormStartPosition.CenterScreen;
            logWindow.Icon = CreateBrandIcon();

            logBox = new RichTextBox();
            logBox.Dock = DockStyle.Fill;
            logBox.ReadOnly = true;
            logBox.BackColor = Color.FromArgb(13, 15, 23);
            logBox.ForeColor = Color.FromArgb(165, 180, 252);
            logBox.Font = new Font("Consolas", 10F, FontStyle.Regular);
            logBox.BorderStyle = BorderStyle.None;
            logWindow.Controls.Add(logBox);

            logWindow.FormClosing += (s, e) =>
            {
                if (e.CloseReason == CloseReason.UserClosing)
                {
                    e.Cancel = true;
                    logWindow.Hide();
                }
            };
        }

        private void InitializeTrayIcon()
        {
            ContextMenu menu = new ContextMenu();
            menu.MenuItems.Add("Открыть Doks в браузере", (s, e) => Process.Start(webUrl));
            menu.MenuItems.Add("Режим моста (QR для телефона)", (s, e) => Process.Start(webUrl + "/?openBridge=1"));
            menu.MenuItems.Add("-");
            menu.MenuItems.Add("Показать / Скрыть терминал", (s, e) => ToggleLogWindow());
            menu.MenuItems.Add("Открыть папку хранилища (~/Doks)", (s, e) =>
            {
                string vault = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Doks");
                if (!Directory.Exists(vault)) Directory.CreateDirectory(vault);
                Process.Start("explorer.exe", vault);
            });
            menu.MenuItems.Add("Перезапустить сервер", (s, e) =>
            {
                StopAgent();
                StartAgent();
            });
            menu.MenuItems.Add("-");
            menu.MenuItems.Add("Выход (Остановить Doks)", (s, e) => ExitApplication());

            trayIcon = new NotifyIcon();
            trayIcon.Icon = CreateBrandIcon();
            trayIcon.Text = "Doks — Локальное рабочее пространство";
            trayIcon.ContextMenu = menu;
            trayIcon.Visible = true;
            trayIcon.DoubleClick += (s, e) => Process.Start(webUrl);
        }

        private void ToggleLogWindow()
        {
            if (logWindow.Visible)
                logWindow.Hide();
            else
            {
                logWindow.Show();
                logWindow.BringToFront();
            }
        }

        private void AppendLog(string line)
        {
            if (string.IsNullOrEmpty(line)) return;
            if (logWindow.IsHandleCreated)
            {
                logWindow.BeginInvoke((MethodInvoker)delegate
                {
                    logBox.AppendText("[" + DateTime.Now.ToString("HH:mm:ss") + "] " + line + Environment.NewLine);
                    logBox.SelectionStart = logBox.Text.Length;
                    logBox.ScrollToCaret();
                });
            }
        }

        private void StartAgent()
        {
            try
            {
                string protectedBundle = Path.Combine(rootDir, "release", "doks-server.cjs");
                string devBundle = Path.Combine(rootDir, "agent", "dist", "index.js");
                string scriptPath = File.Exists(protectedBundle) ? protectedBundle : devBundle;

                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = "node";
                psi.Arguments = "\"" + scriptPath + "\" --open";
                psi.WorkingDirectory = rootDir;
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                psi.StandardOutputEncoding = Encoding.UTF8;
                psi.StandardErrorEncoding = Encoding.UTF8;

                agentProcess = new Process();
                agentProcess.StartInfo = psi;
                agentProcess.OutputDataReceived += (s, e) => AppendLog(e.Data);
                agentProcess.ErrorDataReceived += (s, e) => AppendLog(e.Data);
                agentProcess.Start();
                agentProcess.BeginOutputReadLine();
                agentProcess.BeginErrorReadLine();

                trayIcon.ShowBalloonTip(2500, "Doks запущен", "Сервер работает в фоновом режиме. Двойной клик — открыть доску, правый клик — терминал и настройки.", ToolTipIcon.Info);
            }
            catch (Exception ex)
            {
                MessageBox.Show("Не удалось запустить Node.js агент Doks:\n" + ex.Message, "Ошибка Doks", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void StopAgent()
        {
            try
            {
                if (agentProcess != null && !agentProcess.HasExited)
                {
                    agentProcess.Kill();
                    agentProcess.WaitForExit(2000);
                }
            }
            catch { }
        }

        private void ExitApplication()
        {
            StopAgent();
            trayIcon.Visible = false;
            Application.Exit();
        }

        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new DoksTrayApp());
        }
    }
}
