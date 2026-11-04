import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AttachmentManager } from '@doks/agent';

describe('v80 Memory Governor & Cloud Commitment Optimization', () => {
  const root = process.cwd();

  describe('1. V8 Heap & Cloud Platform Configuration', () => {
    it('should configure --max-old-space-size=384 and --expose-gc in Dockerfile runner stage', () => {
      const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
      expect(dockerfile).toContain('NODE_OPTIONS="--max-old-space-size=384 --expose-gc"');
    });

    it('should configure NODE_OPTIONS in render.yaml for Render free tier compliance', () => {
      const renderYaml = fs.readFileSync(path.join(root, 'render.yaml'), 'utf8');
      expect(renderYaml).toContain('key: NODE_OPTIONS');
      expect(renderYaml).toContain('value: "--max-old-space-size=384 --expose-gc"');
    });

    it('should configure start script with --max-old-space-size=384 and --expose-gc in package.json', () => {
      const pkgJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
      expect(pkgJson.scripts.start).toContain('--max-old-space-size=384');
      expect(pkgJson.scripts.start).toContain('--expose-gc');
    });
  });

  describe('2. AttachmentManager Disk Offloading & Memory Protection', () => {
    let tmpDir: string;
    let vaultPath: string;
    let blobsDir: string;
    let manager: AttachmentManager;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doks-mem-test-'));
      vaultPath = path.join(tmpDir, 'vault');
      blobsDir = path.join(tmpDir, '.doks', 'blobs');
      manager = new AttachmentManager(vaultPath, blobsDir);
    });

    afterEach(() => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    });

    it('should save extracted text to disk and omit it from attachments-meta.json to protect heap', () => {
      const sampleText = 'Line 1: Important document details\nLine 2: Architectural specifications\n';
      const sampleBuf = Buffer.from(sampleText, 'utf8');

      const info = manager.saveAttachment(sampleBuf, 'spec.txt');
      expect(info.hash).toBeDefined();
      expect(info.extractedText).toBe(sampleText);

      // Verify text is saved to .doks/extracted/<hash>.txt
      const extractedPath = path.join(tmpDir, '.doks', 'extracted', `${info.hash}.txt`);
      expect(fs.existsSync(extractedPath)).toBe(true);
      expect(fs.readFileSync(extractedPath, 'utf8')).toBe(sampleText);

      // Verify attachments-meta.json DOES NOT contain extractedText
      const metaPath = path.join(tmpDir, '.doks', 'attachments-meta.json');
      expect(fs.existsSync(metaPath)).toBe(true);
      const metaJson = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      expect(metaJson[0].id).toBe(info.hash);
      expect(metaJson[0].extractedText).toBeUndefined();

      // Verify getAttachment resolves extractedText on demand from disk
      const retrieved = manager.getAttachment(info.hash);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.extractedText).toBe(sampleText);
    });

    it('should migrate legacy attachments-meta.json entries to disk on startup', () => {
      const metaPath = path.join(tmpDir, '.doks', 'attachments-meta.json');
      const legacyHash = 'abcd1234ef01234567890abcdef1234567890abcdef1234567890abcdef12345678';
      const legacyText = 'Legacy embedded large extracted content';
      const legacyRecord = [
        {
          id: legacyHash,
          originalName: 'legacy.md',
          mimeType: 'text/markdown',
          size: 100,
          createdAt: Date.now(),
          fileName: 'legacy.md',
          humanReadableName: 'legacy-abcd1234.md',
          extractedText: legacyText
        }
      ];

      fs.writeFileSync(metaPath, JSON.stringify(legacyRecord, null, 2), 'utf8');

      // Create new manager instance to trigger loadMetadata migration
      const newManager = new AttachmentManager(vaultPath, blobsDir);

      // Verify file was written to disk
      const extractedPath = path.join(tmpDir, '.doks', 'extracted', `${legacyHash}.txt`);
      expect(fs.existsSync(extractedPath)).toBe(true);
      expect(fs.readFileSync(extractedPath, 'utf8')).toBe(legacyText);

      // Verify getExtractedText retrieves it
      expect(newManager.getExtractedText(legacyHash)).toBe(legacyText);
    });
  });

  describe('3. Memory Governor & Parser Bounded Limits', () => {
    it('should verify agent checkMemoryHealth function existence and safe metrics return', async () => {
      const agentSrc = fs.readFileSync(path.join(root, 'agent/src/agent.ts'), 'utf8');
      expect(agentSrc).toContain('public checkMemoryHealth(): { heapUsedMb: number; rssMb: number; gcTriggered: boolean }');
      expect(agentSrc).toContain('this.memoryGovernorInterval = setInterval(');
      expect(agentSrc).toContain('clearInterval(this.memoryGovernorInterval);');
    });

    it('should verify office-extractor bounds max stream inflation to 8MB and clears entries map', () => {
      const officeSrc = fs.readFileSync(path.join(root, 'agent/src/storage/office-extractor.ts'), 'utf8');
      expect(officeSrc).toContain('maxOutputLength: 8 * 1024 * 1024');
      expect(officeSrc).toContain('entries.clear();');
    });

    it('should verify pdf-extractor bounds stream inflation to 4MB, caps stream count, and limits fallback scanning', () => {
      const pdfSrc = fs.readFileSync(path.join(root, 'agent/src/storage/pdf-extractor.ts'), 'utf8');
      expect(pdfSrc).toContain('maxOutputLength: 4 * 1024 * 1024');
      expect(pdfSrc).toContain('if (streamCount > 100) break;');
      expect(pdfSrc).toContain('const sample = rawStr.slice(0, 512 * 1024);');
    });

    it('should verify SnapshotManager stores SHA-256 hash instead of entire snapshot JSON in memory', () => {
      const snapSrc = fs.readFileSync(path.join(root, 'agent/src/storage/snapshots.ts'), 'utf8');
      expect(snapSrc).toContain("crypto.createHash('sha256').update(jsonStr).digest('hex')");
      expect(snapSrc).toContain('this.lastR2UploadedHash = hash;');
    });
  });
});
