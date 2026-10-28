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
            Bitmap bmp = new Bitmap(64, 64);
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.Clear(Color.Transparent);

                Color purpleBg = Color.FromArgb(91, 33, 182); // #5B21B6
                using (GraphicsPath bgPath = new GraphicsPath())
                {
                    int r = 18;
                    bgPath.AddArc(2, 2, r, r, 180, 90);
                    bgPath.AddArc(62 - r, 2, r, r, 270, 90);
                    bgPath.AddArc(62 - r, 62 - r, r, r, 0, 90);
                    bgPath.AddArc(2, 62 - r, r, r, 90, 90);
                    bgPath.CloseFigure();
                    using (SolidBrush bgBrush = new SolidBrush(purpleBg))
                    {
                        g.FillPath(bgBrush, bgPath);
                    }
                }

                // White cat head silhouette + ears + neck
                using (SolidBrush whiteBrush = new SolidBrush(Color.White))
                {
                    PointF[] leftEar = new PointF[] { new PointF(14, 26), new PointF(14, 10), new PointF(27, 18) };
                    PointF[] rightEar = new PointF[] { new PointF(50, 26), new PointF(50, 10), new PointF(37, 18) };
                    g.FillPolygon(whiteBrush, leftEar);
                    g.FillPolygon(whiteBrush, rightEar);
                    g.FillEllipse(whiteBrush, 13, 16, 38, 28);
                    PointF[] body = new PointF[] {
                        new PointF(20, 39), new PointF(44, 39),
                        new PointF(52, 58), new PointF(12, 58)
                    };
                    g.FillPolygon(whiteBrush, body);
                }

                // Purple inner ear cutouts and squinted eyes
                using (SolidBrush cutBrush = new SolidBrush(purpleBg))
                {
                    PointF[] leftInnerEar = new PointF[] { new PointF(17, 23), new PointF(17, 14), new PointF(24, 19) };
                    PointF[] rightInnerEar = new PointF[] { new PointF(47, 23), new PointF(47, 14), new PointF(40, 19) };
                    g.FillPolygon(cutBrush, leftInnerEar);
                    g.FillPolygon(cutBrush, rightInnerEar);

                    PointF[] leftEye = new PointF[] { new PointF(19, 28), new PointF(29, 31), new PointF(22, 34) };
                    PointF[] rightEye = new PointF[] { new PointF(45, 28), new PointF(35, 31), new PointF(42, 34) };
                    g.FillPolygon(cutBrush, leftEye);
                    g.FillPolygon(cutBrush, rightEye);
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

        private void OpenUrl(string url)
        {
            try
            {
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            }
            catch { }
        }

        private void InitializeTrayIcon()
        {
            ContextMenu menu = new ContextMenu();
            menu.MenuItems.Add("Открыть Doks в браузере", (s, e) => OpenUrl(webUrl));
            menu.MenuItems.Add("Режим моста (QR для телефона)", (s, e) => OpenUrl(webUrl + "/?openBridge=1"));
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
            trayIcon.DoubleClick += (s, e) => OpenUrl(webUrl);
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
                    ProcessStartInfo killPsi = new ProcessStartInfo("taskkill", "/F /T /PID " + agentProcess.Id);
                    killPsi.CreateNoWindow = true;
                    killPsi.UseShellExecute = false;
                    Process killProc = Process.Start(killPsi);
                    if (killProc != null) killProc.WaitForExit(2000);
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
