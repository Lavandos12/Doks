using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Threading;
using System.Windows.Forms;

namespace DoksInstaller
{
    public class DoksSetupForm : Form
    {
        private Label statusLabel;
        private Label titleLabel;
        private Label subtitleLabel;
        private Panel progressFill;
        private bool isDragging = false;
        private Point dragCursorPoint;
        private Point dragFormPoint;

        public DoksSetupForm()
        {
            this.FormBorderStyle = FormBorderStyle.None;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.Size = new Size(460, 320);
            this.BackColor = Color.FromArgb(15, 10, 28); // Deep obsidian violet #0F0A1C
            this.DoubleBuffered = true;

            // Make form draggable
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

            // Close button
            Button closeBtn = new Button();
            closeBtn.Text = "✕";
            closeBtn.Font = new Font("Segoe UI", 10, FontStyle.Regular);
            closeBtn.ForeColor = Color.FromArgb(160, 150, 180);
            closeBtn.BackColor = Color.Transparent;
            closeBtn.FlatStyle = FlatStyle.Flat;
            closeBtn.FlatAppearance.BorderSize = 0;
            closeBtn.Size = new Size(32, 32);
            closeBtn.Location = new Point(418, 10);
            closeBtn.Cursor = Cursors.Hand;
            closeBtn.Click += (s, e) => Application.Exit();
            this.Controls.Add(closeBtn);

            // Title
            titleLabel = new Label();
            titleLabel.Text = "Doks";
            titleLabel.Font = new Font("Segoe UI", 22, FontStyle.Bold);
            titleLabel.ForeColor = Color.FromArgb(245, 243, 255);
            titleLabel.Location = new Point(0, 110);
            titleLabel.Size = new Size(460, 40);
            titleLabel.TextAlign = ContentAlignment.MiddleCenter;
            this.Controls.Add(titleLabel);

            // Subtitle
            subtitleLabel = new Label();
            subtitleLabel.Text = "Collaborative Infinite Canvas";
            subtitleLabel.Font = new Font("Segoe UI", 10, FontStyle.Regular);
            subtitleLabel.ForeColor = Color.FromArgb(167, 139, 250); // Violet 400
            subtitleLabel.Location = new Point(0, 150);
            subtitleLabel.Size = new Size(460, 24);
            subtitleLabel.TextAlign = ContentAlignment.MiddleCenter;
            this.Controls.Add(subtitleLabel);

            // Status label
            statusLabel = new Label();
            statusLabel.Text = "Installing Doks...";
            statusLabel.Font = new Font("Segoe UI", 9, FontStyle.Regular);
            statusLabel.ForeColor = Color.FromArgb(196, 181, 253);
            statusLabel.Location = new Point(50, 215);
            statusLabel.Size = new Size(360, 20);
            statusLabel.TextAlign = ContentAlignment.MiddleLeft;
            this.Controls.Add(statusLabel);

            // Custom Progress Bar panel
            Panel progressContainer = new Panel();
            progressContainer.Location = new Point(50, 240);
            progressContainer.Size = new Size(360, 8);
            progressContainer.BackColor = Color.FromArgb(30, 20, 50);

            progressFill = new Panel();
            progressFill.Location = new Point(0, 0);
            progressFill.Size = new Size(0, 8);
            progressFill.BackColor = Color.FromArgb(139, 92, 246); // Violet 500
            progressContainer.Controls.Add(progressFill);
            this.Controls.Add(progressContainer);

            // Installation background worker
            Thread installThread = new Thread(() => {
                PerformInstall(statusLabel, progressFill);
            });
            installThread.IsBackground = true;

            this.Load += (s, e) => installThread.Start();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;

            // Draw rounded purple border
            using (Pen borderPen = new Pen(Color.FromArgb(90, 50, 150), 1.5f))
            {
                g.DrawRectangle(borderPen, 0, 0, this.Width - 1, this.Height - 1);
            }

            // Draw glowing cat logo box
            int logoSize = 64;
            int logoX = (this.Width - logoSize) / 2;
            int logoY = 35;

            using (GraphicsPath path = new GraphicsPath())
            {
                int r = 20;
                path.AddArc(logoX, logoY, r, r, 180, 90);
                path.AddArc(logoX + logoSize - r, logoY, r, r, 270, 90);
                path.AddArc(logoX + logoSize - r, logoY + logoSize - r, r, r, 0, 90);
                path.AddArc(logoX, logoY + logoSize - r, r, r, 90, 90);
                path.CloseFigure();

                using (LinearGradientBrush lgb = new LinearGradientBrush(
                    new Point(logoX, logoY),
                    new Point(logoX + logoSize, logoY + logoSize),
                    Color.FromArgb(139, 92, 246),
                    Color.FromArgb(91, 33, 182)))
                {
                    g.FillPath(lgb, path);
                }
            }

            // White Cat silhouette
            using (Brush whiteBrush = new SolidBrush(Color.White))
            {
                PointF[] catEars = new PointF[] {
                    new PointF(logoX + 16, logoY + 44),
                    new PointF(logoX + 18, logoY + 22),
                    new PointF(logoX + 28, logoY + 30),
                    new PointF(logoX + 36, logoY + 30),
                    new PointF(logoX + 46, logoY + 22),
                    new PointF(logoX + 48, logoY + 44)
                };
                g.FillPolygon(whiteBrush, catEars);
                g.FillEllipse(whiteBrush, logoX + 18, logoY + 28, 28, 24);
            }
        }

        private void PerformInstall(Label status, Panel progress)
        {
            try
            {
                UpdateStatus(status, progress, "Preparing target directory...", 15);
                Thread.Sleep(300);

                // Terminate any running Doks instance to prevent file locks during upgrade
                foreach (var proc in Process.GetProcessesByName("Doks"))
                {
                    try
                    {
                        proc.Kill();
                        proc.WaitForExit(1000);
                    }
                    catch { }
                }

                string localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                string appDir = Path.Combine(localApp, "Programs", "Doks");
                if (!Directory.Exists(appDir)) Directory.CreateDirectory(appDir);

                UpdateStatus(status, progress, "Copying program binaries...", 45);
                string sourceDir = AppDomain.CurrentDomain.BaseDirectory;

                // Smart copy: If release folder exists, copy release/ payload and Doks.exe
                string releaseDir = Path.Combine(sourceDir, "release");
                string sourceDoksExe = Path.Combine(sourceDir, "Doks.exe");

                if (Directory.Exists(releaseDir))
                {
                    CopyDirectory(releaseDir, appDir);
                    if (File.Exists(sourceDoksExe))
                    {
                        File.Copy(sourceDoksExe, Path.Combine(appDir, "Doks.exe"), true);
                    }
                }
                else
                {
                    // Direct folder copy
                    CopyDirectory(sourceDir, appDir);
                }

                UpdateStatus(status, progress, "Creating Desktop shortcut...", 75);
                Thread.Sleep(300);

                string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                string exePath = Path.Combine(appDir, "Doks.exe");
                CreateShortcut(desktop, "Doks", exePath);

                UpdateStatus(status, progress, "Installation complete! Launching Doks...", 100);
                Thread.Sleep(600);

                // Launch installed application
                if (File.Exists(exePath))
                {
                    Process.Start(new ProcessStartInfo(exePath) { UseShellExecute = true });
                }

                this.Invoke((MethodInvoker)delegate { this.Close(); });
            }
            catch (Exception ex)
            {
                this.Invoke((MethodInvoker)delegate {
                    status.ForeColor = Color.FromArgb(248, 113, 113);
                    status.Text = "Install failed: " + ex.Message;
                });
            }
        }

        private void UpdateStatus(Label status, Panel progress, string text, int pct)
        {
            if (this.IsDisposed || !this.IsHandleCreated) return;
            this.Invoke((MethodInvoker)delegate {
                status.Text = text;
                progress.Width = (int)(360 * (pct / 100.0));
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
                if (dirName.Equals("node_modules", StringComparison.OrdinalIgnoreCase)) continue;
                if (dirName.Equals(".git", StringComparison.OrdinalIgnoreCase)) continue;
                if (dirName.Equals(".gemini", StringComparison.OrdinalIgnoreCase)) continue;
                if (dirName.Equals("agent", StringComparison.OrdinalIgnoreCase)) continue;
                if (dirName.Equals("tests", StringComparison.OrdinalIgnoreCase)) continue;
                if (dirName.Equals("shared", StringComparison.OrdinalIgnoreCase)) continue;
                if (dirName.Equals("scripts", StringComparison.OrdinalIgnoreCase)) continue;

                string destSub = Path.Combine(target, dirName);
                CopyDirectory(dir, destSub);
            }
        }

        private void CreateShortcut(string folder, string name, string targetPath)
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
                    shortcut.IconLocation = targetPath + ",0";
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
