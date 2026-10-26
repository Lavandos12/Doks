import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {
  classifyInterface,
  isRadminTunnelOperational,
  type NetworkInterfaceInfo
} from '../../agent/src/network.js';
import { extractTextFromDocxBuffer } from '../../agent/src/storage/docx-extractor.js';
import { AttachmentManager } from '../../agent/src/storage/attachments.js';
import { pointsToSmoothSvgPath, computeBoundingBox } from '../../web/src/utils/strokeSmoother.js';
import { getPortAngle, computeArrowheadPolygon } from '../../web/src/utils/connectorGeometry.js';
import {
  generateDiagramFromText,
  DIAGRAM_PRESETS,
  computeAutoLayout
} from '../../web/src/utils/diagramGenerator.js';

function createSyntheticDocxBuffer(xmlContent: string, deflate = true): Buffer {
  const fileName = 'word/document.xml';
  const fileNameBuf = Buffer.from(fileName, 'utf8');
  let dataBuf = Buffer.from(xmlContent, 'utf8');
  let compressionMethod = 0;

  if (deflate) {
    compressionMethod = 8;
    dataBuf = zlib.deflateRawSync(dataBuf);
  }

  const uncompressedSize = Buffer.byteLength(xmlContent);
  const compressedSize = dataBuf.length;

  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0); // signature
  header.writeUInt16LE(20, 4); // version needed
  header.writeUInt16LE(0, 6); // general flags
  header.writeUInt16LE(compressionMethod, 8); // compression method (0 or 8)
  header.writeUInt16LE(0, 10); // mod time
  header.writeUInt16LE(0, 12); // mod date
  header.writeUInt32LE(0, 14); // crc32
  header.writeUInt32LE(compressedSize, 18);
  header.writeUInt32LE(uncompressedSize, 22);
  header.writeUInt16LE(fileNameBuf.length, 26);
  header.writeUInt16LE(0, 28); // extra field len

  return Buffer.concat([header, fileNameBuf, dataBuf]);
}

function createBit3WordDocxBuffer(xmlContent: string): Buffer {
  const fileName = 'word/document.xml';
  const fileNameBuf = Buffer.from(fileName, 'utf8');
  const rawData = Buffer.from(xmlContent, 'utf8');
  const compressedData = zlib.deflateRawSync(rawData);

  // 1. Local file header with Bit 3 flag (Data Descriptor): compressedSize & uncompressedSize === 0
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0x0008, 6); // Bit 3 flag
  localHeader.writeUInt16LE(8, 8); // Deflate
  localHeader.writeUInt16LE(0, 10);
  localHeader.writeUInt16LE(0, 12);
  localHeader.writeUInt32LE(0, 14);
  localHeader.writeUInt32LE(0, 18); // 0 in local header (streaming format)
  localHeader.writeUInt32LE(0, 22); // 0 in local header
  localHeader.writeUInt16LE(fileNameBuf.length, 26);
  localHeader.writeUInt16LE(0, 28);

  const localEntry = Buffer.concat([localHeader, fileNameBuf, compressedData]);

  // 2. Central Directory Header
  const cdHeader = Buffer.alloc(46);
  cdHeader.writeUInt32LE(0x02014b50, 0);
  cdHeader.writeUInt16LE(20, 4);
  cdHeader.writeUInt16LE(20, 6);
  cdHeader.writeUInt16LE(0x0008, 8);
  cdHeader.writeUInt16LE(8, 10);
  cdHeader.writeUInt16LE(0, 12);
  cdHeader.writeUInt16LE(0, 14);
  cdHeader.writeUInt32LE(0, 16);
  cdHeader.writeUInt32LE(compressedData.length, 20); // Real compressed size in Central Directory!
  cdHeader.writeUInt32LE(rawData.length, 24); // Real uncompressed size in Central Directory!
  cdHeader.writeUInt16LE(fileNameBuf.length, 28);
  cdHeader.writeUInt16LE(0, 30);
  cdHeader.writeUInt16LE(0, 32);
  cdHeader.writeUInt16LE(0, 34);
  cdHeader.writeUInt16LE(0, 36);
  cdHeader.writeUInt32LE(0, 38);
  cdHeader.writeUInt32LE(0, 42); // localHeaderOffset = 0

  const cdEntry = Buffer.concat([cdHeader, fileNameBuf]);

  // 3. End of Central Directory
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdEntry.length, 12);
  eocd.writeUInt32LE(localEntry.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localEntry, cdEntry, eocd]);
}

describe('V3 Audit Fixes & Polish Suite', () => {
  let tmpDir: string;
  let attachmentManager: AttachmentManager;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `doks-v3-audit-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    attachmentManager = new AttachmentManager(path.join(tmpDir, 'attachments'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  describe('1. Network Interface Classification & Operational Radmin Check', () => {
    it('accurately classifies network adapters', () => {
      // Radmin standard 26.x.x.x
      expect(classifyInterface('Ethernet 3', '26.12.34.56')).toBe('radmin');
      expect(classifyInterface('Radmin VPN Adapter', '192.168.1.10')).toBe('radmin');

      // LAN private networks
      expect(classifyInterface('Wi-Fi', '192.168.1.50')).toBe('lan');
      expect(classifyInterface('Ethernet', '10.0.0.5')).toBe('lan');
      expect(classifyInterface('Ethernet', '172.20.1.10')).toBe('lan');

      // Tailscale / CGNAT
      expect(classifyInterface('tailscale0', '100.64.1.20')).toBe('tailscale');

      // Filtered loopback and link-local
      expect(classifyInterface('lo', '127.0.0.1')).toBeNull();
      expect(classifyInterface('Auto-IP', '169.254.12.34')).toBeNull();

      // Proxy / VPN TUN interfaces (FakeIP / sing-box / clash / hiddify)
      expect(classifyInterface('sing-tun', '172.19.0.1')).toBe('vpn-tun');
      expect(classifyInterface('Hiddify Tunnel', '198.18.0.1')).toBe('vpn-tun');
      expect(classifyInterface('clash', '198.19.1.5')).toBe('vpn-tun');
    });

    it('isRadminTunnelOperational returns boolean without throwing on any OS', () => {
      const isRunning = isRadminTunnelOperational();
      expect(typeof isRunning).toBe('boolean');
    });
  });

  describe('2. Pure Node.js .docx Extraction & Text Ingestion', () => {
    it('extracts formatted text and paragraphs from deflate-compressed docx', () => {
      const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r><w:t>Doks Architecture Overview</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>Section 1: Local-first P2P sync with CRDT.</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>Symbols: &amp; &lt; &gt; &quot;</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;

      const docxBuf = createSyntheticDocxBuffer(sampleXml, true);
      const text = extractTextFromDocxBuffer(docxBuf);

      expect(text).toContain('Doks Architecture Overview');
      expect(text).toContain('Section 1: Local-first P2P sync with CRDT.');
      expect(text).toContain('Symbols: & < > "');
      expect(text).toMatch(/Doks Architecture Overview\n\nSection 1/);
    });

    it('extracts formatted text from uncompressed docx', () => {
      const sampleXml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Uncompressed Title</w:t></w:r></w:p>
  </w:body>
</w:document>`;

      const docxBuf = createSyntheticDocxBuffer(sampleXml, false);
      const text = extractTextFromDocxBuffer(docxBuf);
      expect(text).toBe('Uncompressed Title');
    });

    it('extracts Russian text from Microsoft Word Bit-3 Data Descriptor streaming docx', () => {
      const russianText = 'Дисперсные системы и коллоидные растворы в фармации';
      const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>${russianText}</w:t></w:r></w:p>
  </w:body>
</w:document>`;

      const docxBuf = createBit3WordDocxBuffer(sampleXml);
      const text = extractTextFromDocxBuffer(docxBuf);
      expect(text).toBe(russianText);
    });

    it('gracefully returns empty string for corrupted or non-docx buffers', () => {
      expect(extractTextFromDocxBuffer(Buffer.from('not a zip file'))).toBe('');
      expect(extractTextFromDocxBuffer(Buffer.alloc(0))).toBe('');
      expect(extractTextFromDocxBuffer(Buffer.alloc(100))).toBe('');
    });

    it('ingests text and docx files into AttachmentManager with extractedText', async () => {
      // 1. Text file upload
      const textContent = 'Hello World\nLine 2';
      const textInfo = await attachmentManager.saveAttachment(
        Buffer.from(textContent, 'utf8'),
        'readme.txt'
      );
      expect(textInfo.extractedText).toBe(textContent);

      // 2. Docx file upload
      const sampleXml = `<w:body><w:p><w:r><w:t>Docx in Manager</w:t></w:r></w:p></w:body>`;
      const docxBuf = createSyntheticDocxBuffer(sampleXml, true);
      const docxInfo = await attachmentManager.saveAttachment(
        docxBuf,
        'spec.docx'
      );
      expect(docxInfo.extractedText).toBe('Docx in Manager');
    });
  });

  describe('3. Freehand Drawing & Quadratic Bezier Smoothing', () => {
    it('handles point edge cases smoothly', () => {
      expect(pointsToSmoothSvgPath([])).toBe('');
      expect(pointsToSmoothSvgPath([{ x: 10, y: 20 }])).toBe('M 10.0 20.0 L 10.2 20.2');
      expect(pointsToSmoothSvgPath([{ x: 10, y: 20 }, { x: 30, y: 40 }])).toBe('M 10.0 20.0 L 30.0 40.0');
    });

    it('generates quadratic bezier curves Q for multi-point paths', () => {
      const points = [
        { x: 10, y: 10 },
        { x: 50, y: 80 },
        { x: 100, y: 20 },
        { x: 150, y: 90 }
      ];
      const pathStr = pointsToSmoothSvgPath(points);

      expect(pathStr.startsWith('M 10.0 10.0')).toBe(true);
      expect(pathStr).toContain('Q');
      expect(pathStr).toMatch(/Q\s+\d+(\.\d+)?\s+\d+(\.\d+)?\s+\d+(\.\d+)?\s+\d+(\.\d+)?/);
    });

    it('computes tight bounding box with padding', () => {
      const points = [
        { x: 100, y: 200 },
        { x: 300, y: 400 },
        { x: 200, y: 250 }
      ];
      const bbox = computeBoundingBox(points, 20);

      expect(bbox.x).toBe(80); // 100 - 20
      expect(bbox.y).toBe(180); // 200 - 20
      expect(bbox.width).toBe(240); // 300 - 100 + 40
      expect(bbox.height).toBe(240); // 400 - 200 + 40
    });

    it('calculates explicit arrowhead polygon points accurately', () => {
      // Pointing right (into left port, angle 0)
      const pointsRight = computeArrowheadPolygon(100, 100, 0, 12, 6);
      expect(pointsRight).toBe('100.0,100.0 88.0,94.0 88.0,106.0');

      // Port angles: left is 0, top is PI/2, right is PI, bottom is -PI/2
      expect(getPortAngle('left')).toBe(0);
      expect(getPortAngle('top')).toBe(Math.PI / 2);
      expect(getPortAngle('right')).toBe(Math.PI);
      expect(getPortAngle('bottom')).toBe(-Math.PI / 2);
    });
  });

  describe('4. Auto-Diagrams, Mindmaps & Auto-Layout', () => {
    it('generates flowchart nodes and directed edges from arrow syntax', () => {
      const text = `
Start [circle] -> Validate [diamond]
Validate -> Approve [rect]
Validate -> Reject [rect]
`;
      const result = generateDiagramFromText(text, 100, 100);

      expect(result.nodes.length).toBe(4);
      expect(result.edges.length).toBe(3);

      const startNode = result.nodes.find((n) => n.text === 'Start');
      expect(startNode).toBeDefined();
      expect(startNode?.shapeType).toBe('pill');

      const validateNode = result.nodes.find((n) => n.text === 'Validate');
      expect(validateNode).toBeDefined();
      expect(validateNode?.shapeType).toBe('diamond');

      for (const edge of result.edges) {
        expect(edge.fromNode).toBeDefined();
        expect(edge.toNode).toBeDefined();
      }
    });

    it('generates hierarchical mindmap tree from indented outline', () => {
      const outline = `
Doks v3.0
  Canvas Engine
    Freehand Drawing
    Auto-Layout
  Local-First
    Solo Mode
    Team Mesh
`;
      const result = generateDiagramFromText(outline, 200, 200);

      expect(result.nodes.length).toBe(7);
      expect(result.edges.length).toBe(6);

      const rootNode = result.nodes.find((n) => n.text === 'Doks v3.0');
      expect(rootNode).toBeDefined();
    });

    it('validates all 5 built-in presets produce rich diagrams', () => {
      const presetKeys = Object.keys(DIAGRAM_PRESETS);
      expect(presetKeys.length).toBe(5);

      for (const key of presetKeys) {
        const preset = (DIAGRAM_PRESETS as any)[key];
        expect(preset.title).toBeDefined();
        expect(preset.content).toBeDefined();

        const generated = generateDiagramFromText(preset.content, 100, 100);
        expect(generated.nodes.length).toBeGreaterThan(2);
        expect(generated.edges.length).toBeGreaterThan(1);
      }
    });

    it('computes clean auto-layout positions for connected graph', () => {
      const nodes = [
        { id: '1', x: 0, y: 0, w: 100, h: 50 },
        { id: '2', x: 0, y: 0, w: 100, h: 50 },
        { id: '3', x: 0, y: 0, w: 100, h: 50 }
      ];
      const edges = [
        { from: '1', to: '2' },
        { from: '2', to: '3' }
      ];

      const positioned = computeAutoLayout(nodes as any, edges as any, 100, 100);

      expect(positioned.size).toBe(3);
      const n1 = positioned.get('1')!;
      const n2 = positioned.get('2')!;
      const n3 = positioned.get('3')!;

      // In left-to-right DAG layout: x1 < x2 < x3
      expect(n1.x).toBeLessThan(n2.x);
      expect(n2.x).toBeLessThan(n3.x);
    });
  });

  describe('5. Zero-Emoji Compliance Across All Codebases', () => {
    it('guarantees 0 Unicode emojis in modified and new components', () => {
      const targetDirs = [
        path.resolve(process.cwd(), 'agent/src'),
        path.resolve(process.cwd(), 'shared/src'),
        path.resolve(process.cwd(), 'web/src'),
        path.resolve(process.cwd(), 'tests/src')
      ];

      const emojiRegex = /[\p{Extended_Pictographic}\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;

      function scanDir(dir: string): string[] {
        let violations: string[] = [];
        if (!fs.existsSync(dir)) return violations;
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            violations = violations.concat(scanDir(fullPath));
          } else if (entry.isFile() && /\.(ts|tsx|css|html)$/.test(entry.name)) {
            const content = fs.readFileSync(fullPath, 'utf8');
            const lines = content.split('\n');
            lines.forEach((line, lineIndex) => {
              if (emojiRegex.test(line)) {
                violations.push(`${fullPath}:${lineIndex + 1}: ${line.trim()}`);
              }
            });
          }
        }
        return violations;
      }

      const allViolations: string[] = [];
      for (const d of targetDirs) {
        allViolations.push(...scanDir(d));
      }

      expect(allViolations).toEqual([]);
    });
  });
});
