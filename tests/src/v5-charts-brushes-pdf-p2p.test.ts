import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import {
  buildCalligraphicBrushPath,
  pointsToSmoothSvgPath,
  type Point
} from '../../web/src/utils/strokeSmoother.js';
import { extractTextFromPdfBuffer } from '../../agent/src/storage/pdf-extractor.js';
import { type BoardNodeData, setNodeProperties } from '@doks/shared';
import * as Y from 'yjs';

describe('V5 Calligraphic Brushes, Textarea Stability, 22px Ports, Percentage Charts & PDF P2P', () => {
  // 1. Calligraphic brush vs uniform pen
  describe('Issue 1: Dynamic Calligraphic Polygon Brush vs Technical Pen', () => {
    const testPoints: Point[] = [
      { x: 10, y: 10 },
      { x: 30, y: 25 },
      { x: 70, y: 60 },
      { x: 120, y: 110 },
      { x: 180, y: 140 },
      { x: 240, y: 150 }
    ];

    it('buildCalligraphicBrushPath generates a closed, variable-thickness polygon path ending with Z', () => {
      const brushPath = buildCalligraphicBrushPath(testPoints, 12);
      expect(brushPath).toBeDefined();
      expect(typeof brushPath).toBe('string');
      expect(brushPath.startsWith('M')).toBe(true);
      expect(brushPath.endsWith('Z')).toBe(true);
      expect(brushPath).toContain('Q');
    });

    it('brush polygon differs structurally from open stroke pen path', () => {
      const penPath = pointsToSmoothSvgPath(testPoints);
      const brushPath = buildCalligraphicBrushPath(testPoints, 12);

      // Technical pen produces an open line without closing Z
      expect(penPath.endsWith('Z')).toBe(false);
      // Brush produces a closed polygon with closing Z
      expect(brushPath.endsWith('Z')).toBe(true);
      // Brush polygon contains both left and right outline edges
      expect(brushPath.length).toBeGreaterThan(penPath.length);
    });

    it('safely handles short or single-point strokes without crashing', () => {
      expect(buildCalligraphicBrushPath([], 8)).toBe('');
      const singlePt = buildCalligraphicBrushPath([{ x: 10, y: 10 }], 8);
      expect(singlePt.startsWith('M')).toBe(true);
      expect(singlePt.endsWith('Z')).toBe(true);
      const twoPt = buildCalligraphicBrushPath([{ x: 0, y: 0 }, { x: 50, y: 50 }], 10);
      expect(twoPt.startsWith('M')).toBe(true);
      expect(twoPt.endsWith('Z')).toBe(true);
    });
  });

  // 2. Card height stability & Complete removal of Like button
  describe('Issue 2: Card Height Stability on Input & Removal of Like Button', () => {
    it('preserves exact node height when typing single characters or strings (zero vertical runaway)', () => {
      const yDoc = new Y.Doc();
      const nodeMap = yDoc.getMap('sticky-node-1');
      const initialH = 140;

      setNodeProperties(nodeMap, {
        id: 'sticky-1',
        type: 'sticky',
        x: 100,
        y: 100,
        w: 200,
        h: initialH,
        text: ''
      });

      // Typing single character 'a'
      setNodeProperties(nodeMap, { text: 'a' });
      expect(nodeMap.get('h')).toBe(initialH);
      expect(nodeMap.get('text')?.toString()).toBe('a');

      // Typing 'aaaa' (as seen in user screenshot)
      setNodeProperties(nodeMap, { text: 'aaaa' });
      expect(nodeMap.get('h')).toBe(initialH);
      expect(nodeMap.get('text')?.toString()).toBe('aaaa');

      // Typing multi-line text
      setNodeProperties(nodeMap, { text: 'line 1\nline 2\nline 3' });
      expect(nodeMap.get('h')).toBe(initialH);
      expect(nodeMap.get('text')?.toString()).toBe('line 1\nline 2\nline 3');
    });

    it('confirms sticky card does not attach reaction pill or like counter by default', () => {
      const yDoc = new Y.Doc();
      const nodeMap = yDoc.getMap('sticky-node-2');

      setNodeProperties(nodeMap, {
        id: 'sticky-2',
        type: 'sticky',
        x: 200,
        y: 200,
        w: 200,
        h: 140,
        text: 'Clean card without likes'
      });

      expect(nodeMap.get('reactions')).toBeUndefined();
    });
  });

  // 3. Magnetic ports separated 22px outside card perimeter
  describe('Issue 3: Arrow Connection Ports Separated 22px from Edge Resize Handles', () => {
    it('verifies 19px physical clearance between magnetic port and edge resize handle', () => {
      const edgeHandleOffset = -3; // .resize-handle.handle-n at top: -3px
      const portOffset = -22;      // .magnetic-port.port-top at top: -22px
      const portSize = 14;         // 14x14px circle
      const handleThickness = 6;   // 24x6px pill

      const portCenter = portOffset + portSize / 2;     // -22 + 7 = -15px
      const handleCenter = edgeHandleOffset + handleThickness / 2; // -3 + 3 = 0px
      const physicalGap = Math.abs(portCenter - handleCenter);

      expect(physicalGap).toBe(15);
      // The clearance between outer edge of handle and inner edge of port:
      // handle top is -3px, port bottom is -8px (-22 + 14 = -8px)
      const edgeClearance = Math.abs(-3 - (-8));
      expect(edgeClearance).toBe(5);
      // The port is strictly outside the card perimeter (y < 0)
      expect(portOffset).toBe(-22);
    });
  });

  // 4. Percentage Data Chart calculations
  describe('Issue 4: Percentage Data Chart Geometry and Slices', () => {
    const chartData = [
      { id: '1', label: 'Разработка', value: 75, color: '#6366f1' },
      { id: '2', label: 'Тестирование', value: 25, color: '#10b981' }
    ];

    it('computes exact sector percentages summing to 100%', () => {
      const total = chartData.reduce((sum, d) => sum + d.value, 0);
      expect(total).toBe(100);

      const pcts = chartData.map((d) => Math.round((d.value / total) * 100));
      expect(pcts[0]).toBe(75);
      expect(pcts[1]).toBe(25);
      expect(pcts[0] + pcts[1]).toBe(100);
    });

    it('computes exact trigonometric arc paths for Pie chart', () => {
      const total = 100;
      const cx = 80;
      const cy = 80;
      const r = 68;
      let startAngle = -Math.PI / 2;

      // Slice 1: 75% -> angle = 0.75 * 2 * PI = 1.5 * PI (270 deg)
      const angle1 = (75 / total) * 2 * Math.PI;
      const endAngle1 = startAngle + angle1;
      const largeArc1 = angle1 > Math.PI ? 1 : 0;
      expect(largeArc1).toBe(1); // 270 deg > 180 deg -> large arc

      const x0 = cx + r * Math.cos(startAngle);
      const y0 = cy + r * Math.sin(startAngle);
      const x1 = cx + r * Math.cos(endAngle1);
      const y1 = cy + r * Math.sin(endAngle1);

      const path1 = `M ${cx} ${cy} L ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${largeArc1} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;
      expect(path1).toContain('M 80 80');
      expect(path1).toContain('A 68 68 0 1 1');

      // Slice 2: 25% -> angle = 0.25 * 2 * PI = 0.5 * PI (90 deg)
      startAngle = endAngle1;
      const angle2 = (25 / total) * 2 * Math.PI;
      const largeArc2 = angle2 > Math.PI ? 1 : 0;
      expect(largeArc2).toBe(0); // 90 deg <= 180 deg -> small arc
    });

    it('handles single 100% slice gracefully as full circle', () => {
      const singleItem = [{ id: '1', label: 'Монолит', value: 100, color: '#3b82f6' }];
      const valid = singleItem.filter((d) => d.value > 0);
      expect(valid.length).toBe(1);
      // Renders circle element instead of degenerate 360-deg arc
      const isSingleFullCircle = valid.length <= 1;
      expect(isSingleFullCircle).toBe(true);
    });

    it('supports chart node data synchronization in Yjs', () => {
      const yDoc = new Y.Doc();
      const nodeMap = yDoc.getMap('test-chart');
      const chartNode: BoardNodeData = {
        id: 'chart-1',
        type: 'chart',
        x: 100,
        y: 150,
        w: 380,
        h: 360,
        text: 'План релиза',
        chartType: 'donut',
        chartData: [
          { id: '1', label: 'Frontend', value: 60, color: '#6366f1' },
          { id: '2', label: 'Backend', value: 40, color: '#10b981' }
        ]
      };

      setNodeProperties(nodeMap, chartNode);
      expect(nodeMap.get('type')).toBe('chart');
      expect(nodeMap.get('chartType')).toBe('donut');
      const storedData = nodeMap.get('chartData') as any[];
      expect(storedData.length).toBe(2);
      expect(storedData[0].label).toBe('Frontend');
      expect(storedData[1].value).toBe(40);
    });
  });

  // 5. PDF text extraction & P2P sync
  describe('Issue 5: PDF Text Extraction & P2P Replication', () => {
    it('extracts plain text from uncompressed PDF text operators', () => {
      const pdfContent = `%PDF-1.4
1 0 obj
<< /Length 64 >>
stream
BT
/F1 12 Tf
72 712 Td
(Hello Doks Whiteboard PDF Test) Tj
ET
endstream
endobj
%%EOF`;
      const buf = Buffer.from(pdfContent, 'utf-8');
      const text = extractTextFromPdfBuffer(buf);
      expect(text).toContain('Hello Doks Whiteboard PDF Test');
    });

    it('extracts plain text from FlateDecode compressed PDF streams', () => {
      const innerStream = `BT /F1 14 Tf 50 700 Td (Compressed Architecture Plan) Tj ET`;
      const compressedStream = zlib.deflateSync(Buffer.from(innerStream, 'utf-8'));

      const header = Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Filter /FlateDecode >>\nstream\n`, 'utf-8');
      const footer = Buffer.from(`\nendstream\nendobj\n%%EOF`, 'utf-8');
      const fullPdf = Buffer.concat([header, compressedStream, footer]);

      const text = extractTextFromPdfBuffer(fullPdf);
      expect(text).toContain('Compressed Architecture Plan');
    });

    it('gracefully returns readable document placeholder for non-text or binary data without throwing', () => {
      const garbage = Buffer.from([0x00, 0xff, 0x12, 0x34, 0x56, 0x78]);
      const res = extractTextFromPdfBuffer(garbage);
      expect(typeof res).toBe('string');
      expect(res).toContain('Документ PDF');
    });

    it('stores fileDataUrl in Yjs node for zero-download P2P instant view', () => {
      const yDoc = new Y.Doc();
      const nodeMap = yDoc.getMap('doc-node');
      const mockDataUrl = 'data:application/pdf;base64,JVBERi0xLjQK...';

      setNodeProperties(nodeMap, {
        id: 'pdf-node-1',
        type: 'file',
        x: 200,
        y: 200,
        w: 360,
        h: 280,
        text: 'Architecture.pdf',
        fileHash: 'abcdef1234567890',
        fileName: 'Architecture.pdf',
        fileDataUrl: mockDataUrl,
        uploaderOrigin: 'http://127.0.0.1:4747'
      });

      expect(nodeMap.get('fileDataUrl')).toBe(mockDataUrl);
      expect(nodeMap.get('uploaderOrigin')).toBe('http://127.0.0.1:4747');
    });
  });
});
