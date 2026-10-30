import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { streamDirectoryAsZip } from '../../agent/src/storage/zip-stream.js';

function extractStoreZip(zipFilePath: string, destDir: string): void {
  const buf = fs.readFileSync(zipFilePath);
  let offset = 0;
  while (offset < buf.length - 4) {
    const sig = buf.readUInt32LE(offset);
    if (sig === 0x02014b50) {
      const size = buf.readUInt32LE(offset + 20);
      const nameLen = buf.readUInt16LE(offset + 28);
      const extraLen = buf.readUInt16LE(offset + 30);
      const commentLen = buf.readUInt16LE(offset + 32);
      const localOffset = buf.readUInt32LE(offset + 42);
      const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen);

      const localNameLen = buf.readUInt16LE(localOffset + 26);
      const localExtraLen = buf.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      const fileData = buf.subarray(dataStart, dataStart + size);

      const targetPath = path.join(destDir, name);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, fileData);
      offset += 46 + nameLen + extraLen + commentLen;
    } else {
      offset++;
    }
  }
}

describe('F10: Streaming Vault ZIP Export', () => {
  let tempDir: string;
  let vaultDir: string;
  let zipFile: string;
  let extractDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doks-f10-zip-'));
    vaultDir = path.join(tempDir, 'vault');
    zipFile = path.join(tempDir, 'export.zip');
    extractDir = path.join(tempDir, 'extracted');

    fs.mkdirSync(vaultDir, { recursive: true });
    fs.mkdirSync(path.join(vaultDir, 'subfolder'), { recursive: true });
    fs.mkdirSync(path.join(vaultDir, 'attachments'), { recursive: true });
    fs.mkdirSync(extractDir, { recursive: true });

    // Populate files
    fs.writeFileSync(path.join(vaultDir, 'Заметка 1.md'), '# Заголовок 1\nПривет мир!', 'utf8');
    fs.writeFileSync(path.join(vaultDir, 'subfolder', 'Вложенная.md'), 'Вложенный текст', 'utf8');
    fs.writeFileSync(path.join(vaultDir, 'attachments', 'binary.bin'), Buffer.alloc(10000, 42));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('streams directory as valid ZIP without execSync and preserves all files and paths', async () => {
    const outStream = fs.createWriteStream(zipFile);
    await streamDirectoryAsZip(vaultDir, outStream);
    outStream.end();

    await new Promise<void>((res) => outStream.on('finish', () => res()));

    expect(fs.existsSync(zipFile)).toBe(true);
    expect(fs.statSync(zipFile).size).toBeGreaterThan(100);

    // Extract cross-platform without external binary dependencies
    extractStoreZip(zipFile, extractDir);

    expect(fs.existsSync(path.join(extractDir, 'Заметка 1.md'))).toBe(true);
    expect(fs.readFileSync(path.join(extractDir, 'Заметка 1.md'), 'utf8')).toContain('Привет мир!');

    expect(fs.existsSync(path.join(extractDir, 'subfolder', 'Вложенная.md'))).toBe(true);
    expect(fs.readFileSync(path.join(extractDir, 'subfolder', 'Вложенная.md'), 'utf8')).toBe('Вложенный текст');

    expect(fs.existsSync(path.join(extractDir, 'attachments', 'binary.bin'))).toBe(true);
    expect(fs.readFileSync(path.join(extractDir, 'attachments', 'binary.bin')).length).toBe(10000);
  });
});
