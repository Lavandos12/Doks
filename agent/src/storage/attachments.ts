import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { extractTextFromDocxBuffer } from './docx-extractor.js';
import { extractTextFromPdfBuffer } from './pdf-extractor.js';

export interface AttachmentInfo {
  hash: string;
  fileName: string;
  size: number;
  filePath: string;
  mimeType: string;
  humanReadableName?: string;
  extractedText?: string;
}

export interface AttachmentMetadataRecord {
  id: string; // sha256
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: number;
  fileName: string;
  humanReadableName: string;
  extractedText?: string;
}

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown',
  '.canvas': 'application/json',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.zip': 'application/zip',
  '.txt': 'text/plain',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg'
};

export class AttachmentManager {
  private attachmentsDir: string;
  private blobsDir: string;
  private metadataPath: string;
  private metadata = new Map<string, AttachmentMetadataRecord>();
  private incomingChunks = new Map<string, { totalChunks: number; chunks: Map<number, Buffer>; originalName: string }>();

  constructor(vaultPath: string, blobsDir?: string) {
    this.attachmentsDir = path.join(vaultPath, 'attachments');
    this.blobsDir = blobsDir || path.join(path.dirname(vaultPath), '.doks', 'blobs');
    this.metadataPath = path.join(path.dirname(this.blobsDir), 'attachments-meta.json');

    fs.mkdirSync(this.attachmentsDir, { recursive: true });
    fs.mkdirSync(this.blobsDir, { recursive: true });

    this.loadMetadata();
  }

  private loadMetadata(): void {
    if (fs.existsSync(this.metadataPath)) {
      try {
        const raw = fs.readFileSync(this.metadataPath, 'utf8');
        const list: AttachmentMetadataRecord[] = JSON.parse(raw);
        for (const item of list) {
          this.metadata.set(item.id, item);
        }
      } catch {}
    }
  }

  private saveMetadata(): void {
    try {
      const list = Array.from(this.metadata.values());
      fs.writeFileSync(this.metadataPath, JSON.stringify(list, null, 2), 'utf8');
    } catch {}
  }

  public getAttachmentsDir(): string {
    return this.attachmentsDir;
  }

  public getBlobsDir(): string {
    return this.blobsDir;
  }

  public getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    return MIME_TYPES[ext] || 'application/octet-stream';
  }

  /**
   * Sanitizes a filename for Windows/cross-platform filesystem rules.
   */
  public sanitizeFileName(name: string): string {
    return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'attachment';
  }

  /**
   * Saves buffer into .doks/blobs/<sha256> (source of truth)
   * and mirrors into vault/attachments/<name> and <name>-<short-hash8>.<ext>.
   */
  public saveAttachment(buffer: Buffer, originalName = 'attachment.bin'): AttachmentInfo {
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const shortHash = hash.slice(0, 8);

    // 1. Source of truth: .doks/blobs/<sha256> (without extension)
    const blobPath = path.join(this.blobsDir, hash);
    if (!fs.existsSync(blobPath)) {
      fs.writeFileSync(blobPath, buffer);
    }

    // 2. Readable mirror: vault/attachments/<sanitized originalName>
    const cleanName = this.sanitizeFileName(originalName);
    const ext = path.extname(cleanName);
    const base = path.basename(cleanName, ext);

    let candidateName = cleanName;
    let counter = 1;

    while (fs.existsSync(path.join(this.attachmentsDir, candidateName))) {
      try {
        const existingBuf = fs.readFileSync(path.join(this.attachmentsDir, candidateName));
        const existingHash = crypto.createHash('sha256').update(existingBuf).digest('hex');
        if (existingHash === hash) {
          // Exactly the same file already mirrored
          break;
        }
      } catch {}
      counter++;
      candidateName = `${base} (${counter})${ext}`;
    }

    const mirrorPath = path.join(this.attachmentsDir, candidateName);
    if (!fs.existsSync(mirrorPath)) {
      fs.writeFileSync(mirrorPath, buffer);
    }

    // 3. Human-readable hash-tagged mirror for collision-free Obsidian links: <base>-<hash8><ext>
    const humanReadableName = `${base}-${shortHash}${ext}`;
    const hashMirrorPath = path.join(this.attachmentsDir, humanReadableName);
    if (!fs.existsSync(hashMirrorPath)) {
      try {
        fs.writeFileSync(hashMirrorPath, buffer);
      } catch {}
    }

    // 3.5 Extract text for .docx, .pdf, .txt, .md, code files
    let extractedText: string | undefined = undefined;
    const lowerName = candidateName.toLowerCase();
    if (lowerName.endsWith('.docx')) {
      extractedText = extractTextFromDocxBuffer(buffer);
    } else if (lowerName.endsWith('.pdf')) {
      extractedText = extractTextFromPdfBuffer(buffer);
    } else if (
      lowerName.endsWith('.txt') ||
      lowerName.endsWith('.md') ||
      lowerName.endsWith('.csv') ||
      lowerName.endsWith('.json') ||
      lowerName.endsWith('.js') ||
      lowerName.endsWith('.ts') ||
      lowerName.endsWith('.py') ||
      lowerName.endsWith('.html') ||
      lowerName.endsWith('.css')
    ) {
      try {
        extractedText = buffer.toString('utf8');
      } catch {}
    }

    // 4. Save metadata record
    const metaRecord: AttachmentMetadataRecord = {
      id: hash,
      originalName,
      mimeType: this.getMimeType(candidateName),
      size: buffer.length,
      createdAt: Date.now(),
      fileName: candidateName,
      humanReadableName,
      extractedText
    };
    this.metadata.set(hash, metaRecord);
    this.saveMetadata();

    return {
      hash,
      fileName: candidateName,
      humanReadableName,
      size: buffer.length,
      filePath: blobPath,
      mimeType: metaRecord.mimeType,
      extractedText
    };
  }

  public updateExtractedText(hash: string, text: string): void {
    const record = this.metadata.get(hash);
    if (record) {
      record.extractedText = text;
      this.saveMetadata();
    }
  }

  /**
   * Resolves attachment by SHA-256 hash or filename.
   */
  public getAttachment(hashOrName: string): AttachmentInfo | null {
    // 0. Check metadata map first
    const record = this.metadata.get(hashOrName);
    if (record) {
      const blobPath = path.join(this.blobsDir, record.id);
      if (fs.existsSync(blobPath)) {
        return {
          hash: record.id,
          fileName: record.fileName,
          humanReadableName: record.humanReadableName,
          size: record.size,
          filePath: blobPath,
          mimeType: record.mimeType,
          extractedText: record.extractedText
        };
      }
    }

    // 1. Check primary blob store (.doks/blobs/<sha256>)
    const directBlob = path.join(this.blobsDir, hashOrName);
    if (fs.existsSync(directBlob) && !fs.statSync(directBlob).isDirectory()) {
      const stat = fs.statSync(directBlob);
      let foundName = hashOrName;
      if (fs.existsSync(this.attachmentsDir)) {
        const mirrorFiles = fs.readdirSync(this.attachmentsDir);
        for (const f of mirrorFiles) {
          try {
            const buf = fs.readFileSync(path.join(this.attachmentsDir, f));
            if (crypto.createHash('sha256').update(buf).digest('hex') === hashOrName) {
              foundName = f;
              break;
            }
          } catch {}
        }
      }
      return {
        hash: hashOrName,
        fileName: foundName,
        size: stat.size,
        filePath: directBlob,
        mimeType: this.getMimeType(foundName)
      };
    }

    // 2. Check mirror directory (vault/attachments/)
    if (fs.existsSync(this.attachmentsDir)) {
      const files = fs.readdirSync(this.attachmentsDir);
      const found = files.find((f) => f === hashOrName || f.startsWith(hashOrName));
      if (found) {
        const filePath = path.join(this.attachmentsDir, found);
        const stat = fs.statSync(filePath);
        let hash = hashOrName;
        try {
          const buf = fs.readFileSync(filePath);
          hash = crypto.createHash('sha256').update(buf).digest('hex');
        } catch {}

        return {
          hash,
          fileName: found,
          size: stat.size,
          filePath,
          mimeType: this.getMimeType(filePath)
        };
      }
    }

    return null;
  }

  public getMetadataRecord(hash: string): AttachmentMetadataRecord | undefined {
    return this.metadata.get(hash);
  }

  /**
   * Splits attachment into 256 KB chunks for P2P mesh sync.
   */
  public getChunk(hash: string, chunkIndex: number, chunkSize = 256 * 1024): { data: Buffer; totalChunks: number } | null {
    const att = this.getAttachment(hash);
    if (!att || !fs.existsSync(att.filePath)) return null;

    const fd = fs.openSync(att.filePath, 'r');
    const totalChunks = Math.ceil(att.size / chunkSize) || 1;
    const buffer = Buffer.alloc(chunkSize);
    const bytesRead = fs.readSync(fd, buffer, 0, chunkSize, chunkIndex * chunkSize);
    fs.closeSync(fd);

    return {
      data: buffer.subarray(0, bytesRead),
      totalChunks
    };
  }

  /**
   * Receives a chunk and reconstructs the file when all chunks arrive.
   */
  public receiveChunk(
    hash: string,
    chunkIndex: number,
    totalChunks: number,
    chunkData: Buffer,
    originalName = 'attachment.bin'
  ): AttachmentInfo | null {
    let entry = this.incomingChunks.get(hash);
    if (!entry) {
      entry = { totalChunks, chunks: new Map(), originalName };
      this.incomingChunks.set(hash, entry);
    }

    entry.chunks.set(chunkIndex, chunkData);

    if (entry.chunks.size === totalChunks) {
      const parts: Buffer[] = [];
      for (let i = 0; i < totalChunks; i++) {
        const p = entry.chunks.get(i);
        if (p) parts.push(p);
      }
      const fullBuffer = Buffer.concat(parts);
      const computedHash = crypto.createHash('sha256').update(fullBuffer).digest('hex');

      this.incomingChunks.delete(hash);

      if (computedHash === hash) {
        return this.saveAttachment(fullBuffer, entry.originalName);
      } else {
        console.error(`[AttachmentManager] SHA-256 mismatch for ${hash}, computed: ${computedHash}`);
        return null;
      }
    }

    return null;
  }
}
