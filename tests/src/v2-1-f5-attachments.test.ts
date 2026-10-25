import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AttachmentManager } from '../../agent/src/storage/attachments.js';

describe('F5: Attachment names, blobs store & vault mirror', () => {
  let tempDir: string;
  let vaultDir: string;
  let blobsDir: string;
  let manager: AttachmentManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doks-f5-'));
    vaultDir = path.join(tempDir, 'vault');
    blobsDir = path.join(tempDir, '.doks', 'blobs');
    fs.mkdirSync(vaultDir, { recursive: true });

    manager = new AttachmentManager(vaultDir, blobsDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('stores binary in .doks/blobs/<sha256> without extension and mirrors original filename in vault/attachments/', () => {
    const originalName = 'Договор аренды.pdf';
    const content = Buffer.from('PDF sample contract content 12345');

    const info = manager.saveAttachment(content, originalName);

    // 1. Source of truth: .doks/blobs/<sha256>
    const blobPath = path.join(blobsDir, info.hash);
    expect(fs.existsSync(blobPath)).toBe(true);
    expect(fs.readFileSync(blobPath)).toEqual(content);

    // 2. Mirror in vault/attachments/<originalName>
    const mirrorPath = path.join(vaultDir, 'attachments', originalName);
    expect(fs.existsSync(mirrorPath)).toBe(true);
    expect(fs.readFileSync(mirrorPath)).toEqual(content);

    // 3. Info metadata preserves original filename
    expect(info.fileName).toBe(originalName);
    expect(info.mimeType).toBe('application/pdf');
  });

  it('handles filename collisions by adding (2), (3) suffixes in mirror while sharing identical blob', () => {
    const content1 = Buffer.from('First document version');
    const content2 = Buffer.from('Second different document');

    const info1 = manager.saveAttachment(content1, 'Отчет.pdf');
    const info2 = manager.saveAttachment(content2, 'Отчет.pdf');

    expect(info1.hash).not.toBe(info2.hash);
    expect(info1.fileName).toBe('Отчет.pdf');
    expect(info2.fileName).toBe('Отчет (2).pdf');

    expect(fs.existsSync(path.join(vaultDir, 'attachments', 'Отчет.pdf'))).toBe(true);
    expect(fs.existsSync(path.join(vaultDir, 'attachments', 'Отчет (2).pdf'))).toBe(true);
  });

  it('sanitizes illegal Windows characters in mirrored filenames', () => {
    const dirtyName = 'План: "Развитие" <2026>?.pdf';
    const content = Buffer.from('Plan content');

    const info = manager.saveAttachment(content, dirtyName);
    expect(info.fileName).not.toMatch(/[<>:"/\\|?*]/);
    expect(fs.existsSync(path.join(vaultDir, 'attachments', info.fileName))).toBe(true);
  });
});
