using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
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
        private string webUrl = "http://127.0.0.1:4780";
        private static readonly Regex UrlRegex = new Regex(@"http://127\.0\.0\.1:\d+", RegexOptions.Compiled);

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

                Color purpleTop = Color.FromArgb(84, 60, 220);   // #543CDC
                Color purpleBot = Color.FromArgb(77, 11, 173);   // #4D0BAD
                Color eyePurple = Color.FromArgb(80, 36, 196);

                using (GraphicsPath bgPath = new GraphicsPath())
                {
                    int r = 26;
                    bgPath.AddArc(1, 1, r, r, 180, 90);
                    bgPath.AddArc(63 - r, 1, r, r, 270, 90);
                    bgPath.AddArc(63 - r, 63 - r, r, r, 0, 90);
                    bgPath.AddArc(1, 63 - r, r, r, 90, 90);
                    bgPath.CloseFigure();
                    using (LinearGradientBrush bgBrush = new LinearGradientBrush(new Point(0, 0), new Point(64, 64), purpleTop, purpleBot))
                    {
                        g.FillPath(bgBrush, bgPath);
                    }
                }

                // Exact traced outer cat head contour (64x64)
                PointF[] catHead = new PointF[] {
                    new PointF(9.1f, 10.8f), new PointF(8.4f, 12.2f), new PointF(7.9f, 14.0f), new PointF(7.6f, 16.0f),
                    new PointF(7.5f, 18.5f), new PointF(8.2f, 23.4f), new PointF(9.1f, 26.5f), new PointF(10.3f, 29.2f),
                    new PointF(10.3f, 29.6f), new PointF(9.5f, 31.4f), new PointF(8.8f, 33.7f), new PointF(8.3f, 36.6f),
                    new PointF(7.9f, 41.2f), new PointF(6.9f, 44.1f), new PointF(8.5f, 46.7f), new PointF(10.7f, 48.8f),
                    new PointF(12.4f, 49.9f), new PointF(14.7f, 51.1f), new PointF(18.1f, 52.3f), new PointF(21.2f, 53.1f),
                    new PointF(24.1f, 53.5f), new PointF(28.4f, 53.9f), new PointF(36.8f, 53.8f), new PointF(42.3f, 53.1f),
                    new PointF(45.3f, 52.5f), new PointF(48.1f, 51.6f), new PointF(51.0f, 50.2f), new PointF(52.4f, 49.4f),
                    new PointF(54.0f, 48.1f), new PointF(55.8f, 46.2f), new PointF(56.7f, 44.7f), new PointF(57.0f, 43.8f),
                    new PointF(56.4f, 42.7f), new PointF(56.0f, 41.1f), new PointF(55.4f, 35.1f), new PointF(54.8f, 32.5f),
                    new PointF(53.7f, 29.3f), new PointF(54.7f, 26.9f), new PointF(55.8f, 23.1f), new PointF(56.4f, 19.7f),
                    new PointF(56.4f, 17.0f), new PointF(56.2f, 14.7f), new PointF(55.8f, 12.8f), new PointF(55.0f, 11.1f),
                    new PointF(54.3f, 10.3f), new PointF(53.6f, 10.0f), new PointF(52.8f, 10.0f), new PointF(49.8f, 11.3f),
                    new PointF(46.3f, 13.6f), new PointF(41.2f, 17.7f), new PointF(37.2f, 16.4f), new PointF(33.3f, 15.9f),
                    new PointF(30.7f, 15.9f), new PointF(27.9f, 16.2f), new PointF(25.3f, 16.8f), new PointF(22.7f, 17.7f),
                    new PointF(17.5f, 13.5f), new PointF(13.6f, 11.0f), new PointF(12.4f, 10.4f), new PointF(10.7f, 10.0f),
                    new PointF(9.9f, 10.1f)
                };

                PointF[] rightEye = new PointF[] {
                    new PointF(48.8f, 40.4f), new PointF(48.9f, 40.8f), new PointF(48.8f, 41.8f), new PointF(48.0f, 42.7f),
                    new PointF(47.4f, 43.1f), new PointF(45.0f, 44.0f), new PointF(41.7f, 45.6f), new PointF(37.6f, 48.0f),
                    new PointF(36.6f, 48.2f), new PointF(35.9f, 47.7f), new PointF(35.8f, 46.5f), new PointF(36.5f, 45.2f),
                    new PointF(39.0f, 42.6f), new PointF(41.6f, 40.8f), new PointF(43.5f, 39.9f), new PointF(45.4f, 39.4f),
                    new PointF(47.7f, 39.6f)
                };

                PointF[] leftEye = new PointF[] {
                    new PointF(15.2f, 40.3f), new PointF(16.3f, 39.6f), new PointF(18.6f, 39.4f), new PointF(20.7f, 39.9f),
                    new PointF(22.3f, 40.8f), new PointF(24.8f, 42.6f), new PointF(27.2f, 44.9f), new PointF(28.1f, 46.5f),
                    new PointF(28.2f, 47.2f), new PointF(28.0f, 47.8f), new PointF(27.4f, 48.2f), new PointF(26.3f, 48.0f),
                    new PointF(21.4f, 45.2f), new PointF(16.3f, 42.9f), new PointF(15.1f, 41.7f), new PointF(15.0f, 40.8f)
                };

                PointF[] rightEarInner = new PointF[] {
                    new PointF(52.8f, 14.2f), new PointF(53.5f, 15.0f), new PointF(53.8f, 16.3f), new PointF(53.7f, 19.8f),
                    new PointF(52.8f, 23.8f), new PointF(51.6f, 26.2f), new PointF(51.3f, 26.5f), new PointF(49.3f, 23.6f),
                    new PointF(50.0f, 21.8f), new PointF(49.9f, 21.1f), new PointF(49.4f, 20.7f), new PointF(45.6f, 20.8f),
                    new PointF(45.4f, 20.5f), new PointF(47.1f, 18.3f), new PointF(49.5f, 15.8f), new PointF(51.9f, 14.3f)
                };

                PointF[] leftEarInner = new PointF[] {
                    new PointF(11.2f, 14.2f), new PointF(12.5f, 14.5f), new PointF(14.3f, 15.7f), new PointF(16.4f, 17.8f),
                    new PointF(18.5f, 20.5f), new PointF(18.3f, 20.8f), new PointF(14.5f, 20.7f), new PointF(14.0f, 21.1f),
                    new PointF(13.9f, 21.7f), new PointF(14.6f, 23.7f), new PointF(12.7f, 26.5f), new PointF(12.1f, 25.9f),
                    new PointF(11.2f, 23.7f), new PointF(10.2f, 19.6f), new PointF(10.1f, 16.5f), new PointF(10.3f, 15.5f),
                    new PointF(10.6f, 14.6f)
                };

                using (SolidBrush whiteBrush = new SolidBrush(Color.White))
                {
                    g.FillPolygon(whiteBrush, catHead);
                }

                using (SolidBrush cutBrush = new SolidBrush(eyePurple))
                {
                    g.FillPolygon(cutBrush, rightEye);
                    g.FillPolygon(cutBrush, leftEye);
                    g.FillPolygon(cutBrush, rightEarInner);
                    g.FillPolygon(cutBrush, leftEarInner);
                }
            }
            return Icon.FromHandle(bmp.GetHicon());
        }

        private void InitializeLogWindow()
        {
            logWindow = new Form();
            logWindow.Text = "Doks — Agent Terminal (Minimize or close to hide in tray)";
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
            menu.MenuItems.Add("Open Doks in Browser", (s, e) => OpenUrl(webUrl));
            menu.MenuItems.Add("Phone Bridge (QR Code)", (s, e) => OpenUrl(webUrl + "/?openBridge=1"));
            menu.MenuItems.Add("-");
            menu.MenuItems.Add("Show / Hide Terminal", (s, e) => ToggleLogWindow());
            menu.MenuItems.Add("Open Vault Folder (~/Doks)", (s, e) =>
            {
                string vault = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Doks");
                if (!Directory.Exists(vault)) Directory.CreateDirectory(vault);
                Process.Start("explorer.exe", vault);
            });
            menu.MenuItems.Add("Restart Server", (s, e) =>
            {
                StopAgent();
                StartAgent();
            });
            menu.MenuItems.Add("-");
            menu.MenuItems.Add("Exit (Stop Doks)", (s, e) => ExitApplication());

            trayIcon = new NotifyIcon();
            trayIcon.Icon = CreateBrandIcon();
            trayIcon.Text = "Doks";
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

            Match m = UrlRegex.Match(line);
            if (m.Success)
            {
                webUrl = m.Value;
            }

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
                string rootBundle = Path.Combine(rootDir, "doks-server.cjs");
                string devBundle = Path.Combine(rootDir, "agent", "dist", "index.js");
                string scriptPath = File.Exists(protectedBundle) ? protectedBundle : (File.Exists(rootBundle) ? rootBundle : devBundle);

                ProcessStartInfo psi = new ProcessStartInfo();
                string nodeExe = "node";
                string[] nodeCandidates = new string[] {
                    Path.Combine(rootDir, "node.exe"),
                    Path.Combine(rootDir, "bin", "node.exe"),
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe"),
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "node", "node.exe")
                };

                foreach (string n in nodeCandidates)
                {
                    if (File.Exists(n)) { nodeExe = n; break; }
                }

                psi.FileName = nodeExe;
                psi.Arguments = "\"" + scriptPath + "\" --open";
                psi.WorkingDirectory = rootDir;
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                psi.StandardOutputEncoding = Encoding.UTF8;
                psi.StandardErrorEncoding = Encoding.UTF8;

                StringBuilder startupLog = new StringBuilder();
                agentProcess = new Process();
                agentProcess.StartInfo = psi;
                agentProcess.OutputDataReceived += (s, e) => {
                    AppendLog(e.Data);
                    if (!string.IsNullOrEmpty(e.Data)) startupLog.AppendLine(e.Data);
                };
                agentProcess.ErrorDataReceived += (s, e) => {
                    AppendLog(e.Data);
                    if (!string.IsNullOrEmpty(e.Data)) startupLog.AppendLine(e.Data);
                };
                agentProcess.Start();
                agentProcess.BeginOutputReadLine();
                agentProcess.BeginErrorReadLine();

                // Watchdog: detect immediate crash within 2 seconds
                Thread watchdog = new Thread(() => {
                    Thread.Sleep(2000);
                    if (agentProcess != null && agentProcess.HasExited && agentProcess.ExitCode != 0)
                    {
                        string err = startupLog.ToString();
                        MessageBox.Show(
                            "Doks background Node.js server stopped unexpectedly (Exit Code: " + agentProcess.ExitCode + ").\n\nLog output:\n" + (string.IsNullOrEmpty(err) ? "No error output captured." : err),
                            "Doks Server Error",
                            MessageBoxButtons.OK,
                            MessageBoxIcon.Error);
                    }
                });
                watchdog.IsBackground = true;
                watchdog.Start();

                trayIcon.ShowBalloonTip(2500, "Doks Started", "Server is running in background. Double-click to open canvas, right-click for menu.", ToolTipIcon.Info);
            }
            catch (Exception ex)
            {
                MessageBox.Show("Failed to launch Doks Node.js agent:\n" + ex.Message, "Doks Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
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
            bool createdNew;
            using (Mutex mutex = new Mutex(true, @"Global\DoksTraySingleInstanceMutex", out createdNew))
            {
                if (!createdNew)
                {
                    try
                    {
                        Process.Start(new ProcessStartInfo("http://127.0.0.1:4780") { UseShellExecute = true });
                    }
                    catch { }
                    return;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new DoksTrayApp());
            }
        }
    }
}
