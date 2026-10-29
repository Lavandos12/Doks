import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const rootDir = process.cwd();
const sourceFile = path.join(rootDir, 'scripts', 'tray-launcher', 'DoksTray.cs');
const outFile = path.join(rootDir, 'Doks.exe');
const iconFile = path.join(rootDir, 'scripts', 'tray-launcher', 'app.ico');

if (!fs.existsSync(sourceFile)) {
  console.error(`Source file not found: ${sourceFile}`);
  process.exit(1);
}

if (process.platform !== 'win32') {
  console.log('Skipping Windows .exe compilation on non-Windows host.');
  process.exit(0);
}

const cscCandidates = [
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe'
];

let cscPath = cscCandidates.find((p) => fs.existsSync(p));

if (!cscPath) {
  try {
    const whichCsc = execSync('where csc.exe', { encoding: 'utf8' }).trim().split('\n')[0].trim();
    if (whichCsc && fs.existsSync(whichCsc)) {
      cscPath = whichCsc;
    }
  } catch {}
}

if (!cscPath) {
  console.warn('csc.exe was not found in standard .NET Framework directories. Skipping .exe build.');
  process.exit(0);
}

const iconFlag = fs.existsSync(iconFile) ? ` /win32icon:"${iconFile}"` : '';

console.log(`Compiling Doks.exe using ${cscPath}...`);
const cmd = `"${cscPath}" /nologo /target:winexe /out:"${outFile}" /r:System.Windows.Forms.dll /r:System.Drawing.dll${iconFlag} "${sourceFile}"`;

try {
  execSync(cmd, { stdio: 'inherit', cwd: rootDir });
  if (fs.existsSync(outFile)) {
    const stats = fs.statSync(outFile);
    console.log(`Successfully built Doks.exe (${(stats.size / 1024).toFixed(1)} KB)`);
  }
} catch (err) {
  console.error('Failed to compile Doks.exe:', err);
  process.exit(1);
}
