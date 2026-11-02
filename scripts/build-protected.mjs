import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import * as esbuild from 'esbuild';

const rootDir = process.cwd();
const releaseDir = path.join(rootDir, 'release');
const releaseWebDist = path.join(releaseDir, 'web', 'dist');

if (fs.existsSync(releaseWebDist)) {
  fs.rmSync(releaseWebDist, { recursive: true, force: true });
}

console.log('Building @doks/shared, @doks/agent, and @doks/web...');
execSync('npm run build --workspace=shared', { stdio: 'inherit', cwd: rootDir });
execSync('npm run build --workspace=agent', { stdio: 'inherit', cwd: rootDir });
execSync('npm run build --workspace=web', { stdio: 'inherit', cwd: rootDir });

if (!fs.existsSync(releaseDir)) {
  fs.mkdirSync(releaseDir, { recursive: true });
}

console.log('Bundling and minifying server with esbuild...');
const result = await esbuild.build({
  entryPoints: ['agent/src/index.ts'],
  bundle: true,
  write: false,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
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

// Удаляем все существующие shebang из собранного кода, чтобы не было дублей на 2-3 строках
let bundledCode = result.outputFiles[0].text.replace(/^#!.*\r?\n/gm, '').trimStart();

// Ставим ровно один shebang строго на первой строке
const finalCode = `#!/usr/bin/env node\n"use strict";\n${bundledCode}\n`;

const outPath = path.join(releaseDir, 'doks-server.cjs');
fs.writeFileSync(outPath, finalCode, 'utf8');

console.log('Copying web/dist to release/web/dist...');
const sourceWebDist = path.join(rootDir, 'web', 'dist');
if (fs.existsSync(sourceWebDist)) {
  fs.cpSync(sourceWebDist, releaseWebDist, { recursive: true });
}

const serverStats = fs.statSync(outPath);
console.log(`Release bundle created: ${(serverStats.size / 1024).toFixed(1)} KB`);
