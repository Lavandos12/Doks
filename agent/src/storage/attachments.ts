import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface AttachmentInfo {
  hash: string;
  fileName: string;
  size: number;
  filePath: string;
  mimeType: string;
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
  '.txt': 'text/plain'
};

export class AttachmentManager {
  private attachmentsDir: string;
  private blobsDir: string;
  private incomingChunks = new Map<string, { totalChunks: number; chunks: Map<number, Buffer>; originalName: string }>();

  constructor(vaultPath: string, blobsDir?: string) {
    this.attachmentsDir = path.join(vaultPath, 'attachments');
    this.blobsDir = blobsDir || path.join(path.dirname(vaultPath), '.doks', 'blobs');
    fs.mkdirSync(this.attachmentsDir, { recursive: true });
    fs.mkdirSync(this.blobsDir, { recursive: true });
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
   * and mirrors into vault/attachments/<originalName> (readable mirror with collision resolution).
   */
  public saveAttachment(buffer: Buffer, originalName = 'attachment.bin'): AttachmentInfo {
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');

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

    return {
      hash,
      fileName: candidateName,
      size: buffer.length,
      filePath: blobPath,
      mimeType: this.getMimeType(candidateName)
    };
  }

  /**
   * Resolves attachment by SHA-256 hash or filename.
   */
  public getAttachment(hashOrName: string): AttachmentInfo | null {
    // 1. Check primary blob store (.doks/blobs/<sha256>)
    const directBlob = path.join(this.blobsDir, hashOrName);
    if (fs.existsSync(directBlob) && !fs.statSync(directBlob).isDirectory()) {
      const stat = fs.statSync(directBlob);
      // Try to find original filename in mirror
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

    // If all chunks received, assemble and verify hash
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
