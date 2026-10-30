import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execSync } from 'node:child_process';
import * as esbuild from 'esbuild';

const rootDir = process.cwd();
const releaseDir = path.join(rootDir, 'release');
const releaseWebDist = path.join(releaseDir, 'web', 'dist');

if (fs.existsSync(releaseWebDist)) {
  fs.rmSync(releaseWebDist, { recursive: true, force: true });
}

console.log('Building @doks/shared and @doks/web...');
execSync('npm run build --workspace=shared', { stdio: 'inherit', cwd: rootDir });
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

const rawCode = Buffer.from(result.outputFiles[0].text, 'utf8');
const compressed = zlib.brotliCompressSync(rawCode, {
  params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 }
});
const b64 = compressed.toString('base64');

const loaderCode = [
  '#!/usr/bin/env node',
  '"use strict";',
  'const _z=require("node:zlib"),_m=require("node:module"),_p=require("node:path");',
  `const _d="${b64}";`,
  'const _c=_z.brotliDecompressSync(Buffer.from(_d,"base64")).toString("utf8");',
  'module._compile(_c,__filename);'
].join('\n');

const outPath = path.join(releaseDir, 'doks-server.cjs');
fs.writeFileSync(outPath, loaderCode, 'utf8');

console.log('Copying web/dist to release/web/dist...');
const sourceWebDist = path.join(rootDir, 'web', 'dist');
if (fs.existsSync(sourceWebDist)) {
  fs.cpSync(sourceWebDist, releaseWebDist, { recursive: true });
}

const serverStats = fs.statSync(outPath);
console.log(`Protected encoded release bundle created: ${(serverStats.size / 1024).toFixed(1)} KB`);
