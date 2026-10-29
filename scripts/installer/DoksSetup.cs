using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace DoksInstaller
{
    public class DoksSetupForm : Form
    {
        private Label statusLabel;
        private Label titleLabel;
        private Label subtitleLabel;
        private int targetProgressWidth = 0;
        private int currentProgressWidth = 0;
        private System.Windows.Forms.Timer animTimer;
        private bool isDragging = false;
        private Point dragCursorPoint;
        private Point dragFormPoint;

        [DllImport("Gdi32.dll", EntryPoint = "CreateRoundRectRgn")]
        private static extern IntPtr CreateRoundRectRgn(
            int nLeftRect, int nTopRect, int nRightRect, int nBottomRect, int nWidthEllipse, int nHeightEllipse);

        [DllImport("shell32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        public static extern void SHChangeNotify(int wEventId, int uFlags, IntPtr dwItem1, IntPtr dwItem2);

        public DoksSetupForm()
        {
            this.FormBorderStyle = FormBorderStyle.None;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.Size = new Size(480, 340);
            this.BackColor = Color.FromArgb(13, 11, 24); // Deep Obsidian Violet
            this.DoubleBuffered = true;

            // Rounded corners for modern window shape
            this.Region = Region.FromHrgn(CreateRoundRectRgn(0, 0, Width, Height, 24, 24));

            // Draggable window support
            this.MouseDown += (s, e) => {
                if (e.Button == MouseButtons.Left) {
                    isDragging = true;
                    dragCursorPoint = Cursor.Position;
                    dragFormPoint = this.Location;
                }
            };
            this.MouseMove += (s, e) => {
                if (isDragging) {
                    Point diff = Point.Subtract(Cursor.Position, new Size(dragCursorPoint));
                    this.Location = Point.Add(dragFormPoint, new Size(diff));
                }
            };
            this.MouseUp += (s, e) => { isDragging = false; };

            // Close button (Top-Right)
            Button closeBtn = new Button();
            closeBtn.Text = "✕";
            closeBtn.Font = new Font("Segoe UI", 10, FontStyle.Regular);
            closeBtn.ForeColor = Color.FromArgb(140, 130, 165);
            closeBtn.BackColor = Color.Transparent;
            closeBtn.FlatStyle = FlatStyle.Flat;
            closeBtn.FlatAppearance.BorderSize = 0;
            closeBtn.Size = new Size(32, 32);
            closeBtn.Location = new Point(436, 12);
            closeBtn.Cursor = Cursors.Hand;
            closeBtn.MouseEnter += (s, e) => closeBtn.ForeColor = Color.FromArgb(245, 243, 255);
            closeBtn.MouseLeave += (s, e) => closeBtn.ForeColor = Color.FromArgb(140, 130, 165);
            closeBtn.Click += (s, e) => Application.Exit();
            this.Controls.Add(closeBtn);

            // Title
            titleLabel = new Label();
            titleLabel.Text = "Doks";
            titleLabel.Font = new Font("Segoe UI", 24, FontStyle.Bold);
            titleLabel.ForeColor = Color.FromArgb(248, 247, 255);
            titleLabel.Location = new Point(0, 120);
            titleLabel.Size = new Size(480, 42);
            titleLabel.TextAlign = ContentAlignment.MiddleCenter;
            this.Controls.Add(titleLabel);

            // Subtitle
            subtitleLabel = new Label();
            subtitleLabel.Text = "Collaborative Infinite Canvas";
            subtitleLabel.Font = new Font("Segoe UI", 10, FontStyle.Regular);
            subtitleLabel.ForeColor = Color.FromArgb(167, 139, 250); // Violet 400
            subtitleLabel.Location = new Point(0, 164);
            subtitleLabel.Size = new Size(480, 24);
            subtitleLabel.TextAlign = ContentAlignment.MiddleCenter;
            this.Controls.Add(subtitleLabel);

            // Status label
            statusLabel = new Label();
            statusLabel.Text = "Initializing installation...";
            statusLabel.Font = new Font("Segoe UI", 9, FontStyle.Regular);
            statusLabel.ForeColor = Color.FromArgb(196, 181, 253);
            statusLabel.Location = new Point(60, 225);
            statusLabel.Size = new Size(360, 20);
            statusLabel.TextAlign = ContentAlignment.MiddleLeft;
            this.Controls.Add(statusLabel);

            // Smooth animation timer for progress bar
            animTimer = new System.Windows.Forms.Timer();
            animTimer.Interval = 15;
            animTimer.Tick += (s, e) => {
                if (currentProgressWidth < targetProgressWidth) {
                    currentProgressWidth = Math.Min(currentProgressWidth + 6, targetProgressWidth);
                    this.Invalidate(new Rectangle(60, 250, 360, 10));
                }
            };
            animTimer.Start();

            // Background installation worker
            Thread installThread = new Thread(() => {
                PerformInstall();
            });
            installThread.IsBackground = true;

            this.Load += (s, e) => installThread.Start();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;

            // Outer subtle purple border
            using (Pen borderPen = new Pen(Color.FromArgb(55, 35, 95), 1.5f))
            {
                g.DrawRectangle(borderPen, 0, 0, this.Width - 1, this.Height - 1);
            }

            // Draw glowing cat logo squircle (72x72)
            int logoSize = 72;
            int logoX = (this.Width - logoSize) / 2;
            int logoY = 32;

            using (GraphicsPath path = new GraphicsPath())
            {
                int r = 24;
                path.AddArc(logoX, logoY, r, r, 180, 90);
                path.AddArc(logoX + logoSize - r, logoY, r, r, 270, 90);
                path.AddArc(logoX + logoSize - r, logoY + logoSize - r, r, r, 0, 90);
                path.AddArc(logoX, logoY + logoSize - r, r, r, 90, 90);
                path.CloseFigure();

                using (LinearGradientBrush lgb = new LinearGradientBrush(
                    new Point(logoX, logoY),
                    new Point(logoX + logoSize, logoY + logoSize),
                    Color.FromArgb(139, 92, 246),  // #8B5CF6
                    Color.FromArgb(91, 33, 182)))  // #5B21B6
                {
                    g.FillPath(lgb, path);
                }
            }

            // Draw Exact High-Definition Traced Cat Head Contour
            GraphicsState state = g.Save();
            g.TranslateTransform(logoX + 4, logoY + 4);
            float scale = 64f / 64f;
            g.ScaleTransform(scale, scale);

            // Exact vector points from Doks brand identity
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

            using (Brush whiteBrush = new SolidBrush(Color.White))
            {
                g.FillPolygon(whiteBrush, catHead);
            }

            g.Restore(state);

            // Draw Rounded Progress Track (X: 60, Y: 250, W: 360, H: 8)
            int barX = 60, barY = 250, barW = 360, barH = 8;
            using (GraphicsPath trackPath = new GraphicsPath())
            {
                int r = 8;
                trackPath.AddArc(barX, barY, r, r, 180, 90);
                trackPath.AddArc(barX + barW - r, barY, r, r, 270, 90);
                trackPath.AddArc(barX + barW - r, barY + barH - r, r, r, 0, 90);
                trackPath.AddArc(barX, barY + barH - r, r, r, 90, 90);
                trackPath.CloseFigure();
                using (Brush trackBrush = new SolidBrush(Color.FromArgb(28, 22, 48)))
                {
                    g.FillPath(trackBrush, trackPath);
                }
            }

            // Draw Rounded Progress Fill with Violet Gradient
            if (currentProgressWidth > 6)
            {
                using (GraphicsPath fillPath = new GraphicsPath())
                {
                    int r = 8;
                    int fillW = Math.Min(currentProgressWidth, barW);
                    fillPath.AddArc(barX, barY, r, r, 180, 90);
                    fillPath.AddArc(barX + fillW - r, barY, r, r, 270, 90);
                    fillPath.AddArc(barX + fillW - r, barY + barH - r, r, r, 0, 90);
                    fillPath.AddArc(barX, barY + barH - r, r, r, 90, 90);
                    fillPath.CloseFigure();
                    using (LinearGradientBrush fillBrush = new LinearGradientBrush(
                        new Point(barX, barY),
                        new Point(barX + barW, barY),
                        Color.FromArgb(124, 58, 237),   // Violet 600
                        Color.FromArgb(192, 132, 252)))  // Violet 400
                    {
                        g.FillPath(fillBrush, fillPath);
                    }
                }
            }
        }

        private void PerformInstall()
        {
            try
            {
                SetStatus("Preparing target directory...", 15);
                Thread.Sleep(300);

                // Gracefully stop any running Doks instances to prevent file lock issues
                foreach (var proc in Process.GetProcessesByName("Doks"))
                {
                    try { proc.Kill(); proc.WaitForExit(1000); } catch { }
                }

                string localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                string appDir = Path.Combine(localApp, "Programs", "Doks");
                if (!Directory.Exists(appDir)) Directory.CreateDirectory(appDir);

                SetStatus("Installing application binaries...", 45);
                string sourceDir = AppDomain.CurrentDomain.BaseDirectory;

                string releaseDir = Path.Combine(sourceDir, "release");
                string sourceDoksExe = Path.Combine(sourceDir, "Doks.exe");

                if (Directory.Exists(releaseDir))
                {
                    CopyDirectory(releaseDir, appDir);
                    string destRelease = Path.Combine(appDir, "release");
                    if (!Directory.Exists(destRelease)) Directory.CreateDirectory(destRelease);
                    CopyDirectory(releaseDir, destRelease);

                    if (File.Exists(sourceDoksExe))
                    {
                        File.Copy(sourceDoksExe, Path.Combine(appDir, "Doks.exe"), true);
                    }
                }
                else
                {
                    CopyDirectory(sourceDir, appDir);
                }

                SetStatus("Creating Desktop and Start Menu shortcuts...", 75);
                Thread.Sleep(300);

                string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                string startMenu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs");
                string exePath = Path.Combine(appDir, "Doks.exe");

                // Copy app.ico explicitly into application directory
                string sourceIco = Path.Combine(sourceDir, "scripts", "tray-launcher", "app.ico");
                if (!File.Exists(sourceIco)) sourceIco = Path.Combine(sourceDir, "app.ico");
                string targetIco = Path.Combine(appDir, "app.ico");
                if (File.Exists(sourceIco))
                {
                    File.Copy(sourceIco, targetIco, true);
                }

                // Explicit shortcut icon pointing directly to app.ico (or exePath fallback)
                string icoPathForShortcut = File.Exists(targetIco) ? targetIco : exePath;
                CreateShortcut(desktop, "Doks", exePath, icoPathForShortcut);
                CreateShortcut(startMenu, "Doks", exePath, icoPathForShortcut);

                // Instantly invalidate and flush Windows Shell icon cache
                try
                {
                    SHChangeNotify(0x08000000 /* SHCNE_ASSOCCHANGED */, 0x0000 /* SHCNF_IDLIST */, IntPtr.Zero, IntPtr.Zero);
                }
                catch { }

                SetStatus("Installation complete! Launching Doks...", 100);
                Thread.Sleep(700);

                if (File.Exists(exePath))
                {
                    Process.Start(new ProcessStartInfo(exePath) { UseShellExecute = true });
                }

                this.Invoke((MethodInvoker)delegate { this.Close(); });
            }
            catch (Exception ex)
            {
                this.Invoke((MethodInvoker)delegate {
                    statusLabel.ForeColor = Color.FromArgb(248, 113, 113);
                    statusLabel.Text = "Install failed: " + ex.Message;
                });
            }
        }

        private void SetStatus(string text, int pct)
        {
            this.Invoke((MethodInvoker)delegate {
                statusLabel.Text = text;
                targetProgressWidth = (int)(360 * (pct / 100.0));
            });
        }

        private void CopyDirectory(string source, string target)
        {
            if (!Directory.Exists(target)) Directory.CreateDirectory(target);

            foreach (string file in Directory.GetFiles(source))
            {
                string name = Path.GetFileName(file);
                if (name.Equals("DoksSetup.exe", StringComparison.OrdinalIgnoreCase)) continue;
                if (name.EndsWith(".tmp", StringComparison.OrdinalIgnoreCase)) continue;
                File.Copy(file, Path.Combine(target, name), true);
            }

            foreach (string dir in Directory.GetDirectories(source))
            {
                string dirName = Path.GetFileName(dir);
                if (dirName.Equals("node_modules", StringComparison.OrdinalIgnoreCase) || dirName.Equals(".git", StringComparison.OrdinalIgnoreCase)) continue;
                if (dirName.Equals(".gemini", StringComparison.OrdinalIgnoreCase)) continue;
                if (dirName.Equals("agent", StringComparison.OrdinalIgnoreCase)) continue;
                if (dirName.Equals("tests", StringComparison.OrdinalIgnoreCase)) continue;
                if (dirName.Equals("shared", StringComparison.OrdinalIgnoreCase)) continue;
                if (dirName.Equals("scripts", StringComparison.OrdinalIgnoreCase)) continue;

                string destSub = Path.Combine(target, dirName);
                if (!Directory.Exists(destSub)) Directory.CreateDirectory(destSub);
                CopyDirectory(dir, destSub);
            }
        }

        private void CreateShortcut(string folder, string name, string targetPath, string iconPath = null)
        {
            try
            {
                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                if (shellType != null)
                {
                    dynamic shell = Activator.CreateInstance(shellType);
                    dynamic shortcut = shell.CreateShortcut(Path.Combine(folder, name + ".lnk"));
                    shortcut.TargetPath = targetPath;
                    shortcut.WorkingDirectory = Path.GetDirectoryName(targetPath);
                    shortcut.IconLocation = (iconPath ?? targetPath) + ",0";
                    shortcut.Save();
                }
            }
            catch { }
        }

        [STAThread]
        public static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new DoksSetupForm());
        }
    }
}
