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
  private incomingChunks = new Map<string, { totalChunks: number; chunks: Map<number, Buffer>; ext: string }>();

  constructor(vaultPath: string) {
    this.attachmentsDir = path.join(vaultPath, 'attachments');
    fs.mkdirSync(this.attachmentsDir, { recursive: true });
  }

  public getAttachmentsDir(): string {
    return this.attachmentsDir;
  }

  public getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    return MIME_TYPES[ext] || 'application/octet-stream';
  }

  /**
   * Saves buffer into attachments/ with its SHA-256 hash as the name.
   */
  public saveAttachment(buffer: Buffer, originalName = 'file'): AttachmentInfo {
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const ext = path.extname(originalName).toLowerCase() || '.bin';
    const fileName = `${hash}${ext}`;
    const filePath = path.join(this.attachmentsDir, fileName);

    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, buffer);
    }

    return {
      hash,
      fileName,
      size: buffer.length,
      filePath,
      mimeType: this.getMimeType(filePath)
    };
  }

  /**
   * Resolves attachment by SHA-256 hash or filename.
   */
  public getAttachment(hashOrName: string): AttachmentInfo | null {
    const files = fs.readdirSync(this.attachmentsDir);
    const found = files.find((f) => f === hashOrName || f.startsWith(hashOrName));
    if (!found) return null;

    const filePath = path.join(this.attachmentsDir, found);
    const stat = fs.statSync(filePath);
    const ext = path.extname(found);
    const hash = path.basename(found, ext);

    return {
      hash,
      fileName: found,
      size: stat.size,
      filePath,
      mimeType: this.getMimeType(filePath)
    };
  }

  /**
   * Splits attachment into 256 KB chunks for P2P mesh sync.
   */
  public getChunk(hash: string, chunkIndex: number, chunkSize = 256 * 1024): { data: Buffer; totalChunks: number } | null {
    const att = this.getAttachment(hash);
    if (!att) return null;

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
    ext = '.bin'
  ): AttachmentInfo | null {
    let entry = this.incomingChunks.get(hash);
    if (!entry) {
      entry = { totalChunks, chunks: new Map(), ext };
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
        return this.saveAttachment(fullBuffer, `${hash}${entry.ext}`);
      } else {
        console.error(`[AttachmentManager] SHA-256 mismatch for ${hash}, computed: ${computedHash}`);
        return null;
      }
    }

    return null;
  }
}
