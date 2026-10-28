import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import * as esbuild from 'esbuild';

const rootDir = process.cwd();
const releaseDir = path.join(rootDir, 'release');
const releaseWebDist = path.join(releaseDir, 'web', 'dist');

console.log('Building @doks/shared and @doks/web...');
execSync('npm run build --workspace=shared', { stdio: 'inherit', cwd: rootDir });
execSync('npm run build --workspace=web', { stdio: 'inherit', cwd: rootDir });

if (!fs.existsSync(releaseDir)) {
  fs.mkdirSync(releaseDir, { recursive: true });
}

console.log('Bundling obfuscated release/doks-server.cjs with esbuild...');
await esbuild.build({
  entryPoints: ['agent/src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'release/doks-server.cjs',
  minify: true,
  minifyIdentifiers: true,
  minifySyntax: true,
  minifyWhitespace: true,
  sourcemap: false,
  legalComments: 'none',
  define: {
    'import.meta.url': '""'
  },
  external: ['fsevents']
});

console.log('Copying web/dist to release/web/dist...');
const sourceWebDist = path.join(rootDir, 'web', 'dist');
if (fs.existsSync(sourceWebDist)) {
  fs.cpSync(sourceWebDist, releaseWebDist, { recursive: true });
}

const serverStats = fs.statSync(path.join(releaseDir, 'doks-server.cjs'));
console.log(`Protected release bundle created successfully:`);
console.log(`- release/doks-server.cjs: ${(serverStats.size / 1024).toFixed(1)} KB`);
console.log(`- release/web/dist: ${fs.readdirSync(releaseWebDist).length} items`);
