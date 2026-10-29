import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const rootDir = process.cwd();
const installerSource = path.join(rootDir, 'scripts', 'installer', 'DoksSetup.cs');
const outExe = path.join(rootDir, 'DoksSetup.exe');
const iconFile = path.join(rootDir, 'scripts', 'tray-launcher', 'app.ico');

console.log('Building protected bundle and Doks.exe first...');
execSync('npm run pack:release', { stdio: 'inherit', cwd: rootDir });
execSync('npm run build:exe', { stdio: 'inherit', cwd: rootDir });

if (process.platform !== 'win32') {
  console.log('Setup script ready. Skipping .exe compilation on non-Windows host.');
  process.exit(0);
}

const cscCandidates = [
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe'
];
let cscPath = cscCandidates.find(p => fs.existsSync(p));

if (!cscPath) {
  try {
    const which = execSync('where csc.exe', { encoding: 'utf8' }).trim().split('\n')[0].trim();
    if (which && fs.existsSync(which)) cscPath = which;
  } catch {}
}

if (!cscPath) {
  console.warn('csc.exe not found in standard .NET Framework locations. Setup script created.');
  process.exit(0);
}

const iconFlag = fs.existsSync(iconFile) ? ` /win32icon:"${iconFile}"` : '';

console.log(`Compiling DoksSetup.exe with ${cscPath}...`);
const cmd = `"${cscPath}" /nologo /target:winexe /out:"${outExe}" /r:System.Windows.Forms.dll /r:System.Drawing.dll${iconFlag} "${installerSource}"`;

try {
  execSync(cmd, { stdio: 'inherit', cwd: rootDir });
  if (fs.existsSync(outExe)) {
    const stats = fs.statSync(outExe);
    console.log(`Successfully compiled DoksSetup.exe (${(stats.size / 1024).toFixed(1)} KB)!`);
  }
} catch (err) {
  console.error('Failed to compile DoksSetup.exe:', err);
  process.exit(1);
}
