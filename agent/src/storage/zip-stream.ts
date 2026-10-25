import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

interface ZipEntry {
  nameBuf: Buffer;
  crc: number;
  size: number;
  offset: number;
}

export async function streamDirectoryAsZip(dirPath: string, out: NodeJS.WritableStream): Promise<void> {
  const files: { fullPath: string; relativePath: string }[] = [];
  function walk(current: string, base: string) {
    if (!fs.existsSync(current)) return;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(current, ent.name);
      const rel = path.join(base, ent.name);
      if (ent.isDirectory()) {
        walk(full, rel);
      } else if (ent.isFile()) {
        files.push({ fullPath: full, relativePath: rel });
      }
    }
  }
  walk(dirPath, '');

  let currentOffset = 0;
  const centralEntries: ZipEntry[] = [];

  for (const file of files) {
    const entryOffset = currentOffset;
    const nameBuf = Buffer.from(file.relativePath.replace(/\\/g, '/'), 'utf8');

    // Local Header (30 bytes + name)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local file header signature
    localHeader.writeUInt16LE(20, 4);         // Version needed: 2.0
    localHeader.writeUInt16LE(0x0808, 6);     // Flags: Bit 3 (data descriptor) + Bit 11 (UTF-8)
    localHeader.writeUInt16LE(0, 8);          // Compression method: 0 (Store)
    localHeader.writeUInt16LE(0, 10);         // Last mod time
    localHeader.writeUInt16LE(0, 12);         // Last mod date
    localHeader.writeUInt32LE(0, 14);         // CRC-32 (0 because bit 3 is set)
    localHeader.writeUInt32LE(0, 18);         // Compressed size (0 because bit 3)
    localHeader.writeUInt32LE(0, 22);         // Uncompressed size (0 because bit 3)
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);         // Extra field length

    out.write(localHeader);
    out.write(nameBuf);
    currentOffset += localHeader.length + nameBuf.length;

    let crc = 0;
    let size = 0;

    // Stream file in 64KB chunks directly to output
    const fd = fs.openSync(file.fullPath, 'r');
    const chunkBuf = Buffer.alloc(64 * 1024);
    let bytesRead = 0;
    while ((bytesRead = fs.readSync(fd, chunkBuf, 0, chunkBuf.length, null)) > 0) {
      const slice = chunkBuf.subarray(0, bytesRead);
      crc = zlib.crc32(slice, crc);
      size += bytesRead;
      currentOffset += bytesRead;
      out.write(slice);
    }
    fs.closeSync(fd);

    // Data Descriptor (16 bytes)
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0); // Data descriptor signature
    descriptor.writeUInt32LE(crc >>> 0, 4);
    descriptor.writeUInt32LE(size >>> 0, 8);
    descriptor.writeUInt32LE(size >>> 0, 12);

    out.write(descriptor);
    currentOffset += descriptor.length;

    centralEntries.push({
      nameBuf,
      crc: crc >>> 0,
      size: size >>> 0,
      offset: entryOffset
    });
  }

  // Central Directory
  const cdOffset = currentOffset;
  let cdSize = 0;

  for (const entry of centralEntries) {
    const cdHeader = Buffer.alloc(46);
    cdHeader.writeUInt32LE(0x02014b50, 0); // Central directory file header signature
    cdHeader.writeUInt16LE(20, 4);         // Version made by: 2.0
    cdHeader.writeUInt16LE(20, 6);         // Version needed: 2.0
    cdHeader.writeUInt16LE(0x0808, 8);     // Flags: Bit 3 + UTF-8
    cdHeader.writeUInt16LE(0, 10);         // Compression method: 0 (Store)
    cdHeader.writeUInt16LE(0, 12);         // Last mod time
    cdHeader.writeUInt16LE(0, 14);         // Last mod date
    cdHeader.writeUInt32LE(entry.crc, 16);
    cdHeader.writeUInt32LE(entry.size, 20);
    cdHeader.writeUInt32LE(entry.size, 24);
    cdHeader.writeUInt16LE(entry.nameBuf.length, 28);
    cdHeader.writeUInt16LE(0, 30);         // Extra field length
    cdHeader.writeUInt16LE(0, 32);         // File comment length
    cdHeader.writeUInt16LE(0, 34);         // Disk number start
    cdHeader.writeUInt16LE(0, 36);         // Internal file attributes
    cdHeader.writeUInt32LE(0, 38);         // External file attributes
    cdHeader.writeUInt32LE(entry.offset, 42);

    out.write(cdHeader);
    out.write(entry.nameBuf);
    const entryLen = cdHeader.length + entry.nameBuf.length;
    cdSize += entryLen;
    currentOffset += entryLen;
  }

  // End of Central Directory Record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);       // EOCD signature
  eocd.writeUInt16LE(0, 4);                // Number of this disk
  eocd.writeUInt16LE(0, 6);                // Disk where CD starts
  eocd.writeUInt16LE(centralEntries.length, 8);  // Number of CD entries on this disk
  eocd.writeUInt16LE(centralEntries.length, 10); // Total number of CD entries
  eocd.writeUInt32LE(cdSize, 12);          // Size of central directory
  eocd.writeUInt32LE(cdOffset, 16);        // Offset of CD with respect to starting disk
  eocd.writeUInt16LE(0, 20);               // Comment length

  out.write(eocd);
}
