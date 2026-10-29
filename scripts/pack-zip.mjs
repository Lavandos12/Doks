import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const rootDir = process.cwd();
const outZip = path.join(rootDir, 'Doks-Setup.zip');

const setupExe = path.join(rootDir, 'DoksSetup.exe');
const releaseDir = path.join(rootDir, 'release');

if (!fs.existsSync(setupExe) || !fs.existsSync(releaseDir)) {
  console.log('Building components before packaging...');
  execSync('npm run build:setup', { stdio: 'inherit', cwd: rootDir });
}

console.log('Creating portable distribution zip archive...');
if (process.platform === 'win32') {
  execSync(`powershell -NoProfile -Command "Compress-Archive -Path DoksSetup.exe, Doks.exe, release -DestinationPath '${outZip}' -Force"`, { stdio: 'inherit', cwd: rootDir });
} else {
  execSync(`zip -r "${outZip}" DoksSetup.exe Doks.exe release/`, { stdio: 'inherit', cwd: rootDir });
}

if (fs.existsSync(outZip)) {
  const stats = fs.statSync(outZip);
  console.log(`Successfully created distribution archive: Doks-Setup.zip (${(stats.size / 1024).toFixed(1)} KB)`);
}
