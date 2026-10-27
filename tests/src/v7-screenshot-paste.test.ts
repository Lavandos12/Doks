import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as Y from 'yjs';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  nodeMapToData,
  setNodeProperties,
  boardToJSONCanvas,
  jsonCanvasToBoard,
  type BoardNodeData,
  type BoardEdgeData
} from '@doks/shared';
import { AttachmentManager } from '../../agent/src/storage/attachments.js';
import { getPortCoordinates, findMagneticTargetPort, type BoxNode } from '../../web/src/utils/connectorGeometry.js';

describe('V7 Screenshot & Image Pasting Suite', () => {
  let tmpDir: string;
  let attachmentManager: AttachmentManager;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doks-screenshot-test-'));
    attachmentManager = new AttachmentManager(tmpDir);
  });

  afterAll(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('1. AttachmentManager saves screenshot binary and identifies image/png MIME type', () => {
    // 1x1 transparent PNG buffer
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
      0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
      0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
      0x42, 0x60, 0x82
    ]);

    const info = attachmentManager.saveAttachment(pngHeader, 'screenshot.png');
    expect(info.hash).toBeDefined();
    expect(info.hash.length).toBe(64);
    expect(info.mimeType).toBe('image/png');
    expect(info.fileName).toBe('screenshot.png');
    expect(fs.existsSync(info.filePath)).toBe(true);

    const retrieved = attachmentManager.getAttachment(info.hash);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.mimeType).toBe('image/png');
  });

  it('2. Image node schema preserves screenshot fields without data loss', () => {
    const yDoc = new Y.Doc();
    const yNodes = yDoc.getMap('nodes');
    const nodeMap = new Y.Map();
    const id = 'screenshot-node-1';
    yNodes.set(id, nodeMap);

    const screenshotData: Partial<BoardNodeData> = {
      id,
      type: 'image',
      x: 320,
      y: 240,
      w: 480,
      h: 270,
      text: 'screenshot.png',
      fileName: 'screenshot.png',
      fileHash: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
      fileDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      imageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      uploaderOrigin: 'http://127.0.0.1:4747',
      author: 'Tester',
      z: 2,
      deleted: false,
      locked: false
    };

    setNodeProperties(nodeMap, screenshotData);

    const restored = nodeMapToData(id, nodeMap);
    expect(restored.type).toBe('image');
    expect(restored.x).toBe(320);
    expect(restored.y).toBe(240);
    expect(restored.w).toBe(480);
    expect(restored.h).toBe(270);
    expect(restored.fileName).toBe('screenshot.png');
    expect(restored.fileHash).toBe('a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90');
    expect(restored.fileDataUrl).toContain('data:image/png;base64');
    expect(restored.imageUrl).toContain('data:image/png;base64');
    expect(restored.uploaderOrigin).toBe('http://127.0.0.1:4747');
    expect(restored.z).toBe(2);
  });

  it('3. JSONCanvas export round-trips screenshot image nodes with doks_custom metadata', () => {
    const node: BoardNodeData = {
      id: 'img-node-1',
      type: 'image',
      x: 200,
      y: 150,
      w: 400,
      h: 300,
      text: 'diagram-screenshot.png',
      fileName: 'diagram-screenshot.png',
      fileHash: 'feedbeef12345678feedbeef12345678feedbeef12345678feedbeef12345678',
      fileDataUrl: 'data:image/png;base64,sample',
      imageUrl: '/api/attachments/feedbeef12345678feedbeef12345678feedbeef12345678feedbeef12345678',
      uploaderOrigin: 'http://localhost:3000',
      color: 'default',
      author: 'Author',
      done: false,
      z: 2,
      deleted: false,
      locked: false
    };

    const jsonCanvas = boardToJSONCanvas([node], []);
    expect(jsonCanvas.nodes).toHaveLength(1);
    const canvasNode = jsonCanvas.nodes[0] as any;
    expect(canvasNode.doks_custom).toBeDefined();
    expect(canvasNode.doks_custom.fileName).toBe('diagram-screenshot.png');
    expect(canvasNode.doks_custom.fileHash).toBe('feedbeef12345678feedbeef12345678feedbeef12345678feedbeef12345678');
    expect(canvasNode.doks_custom.imageUrl).toBe('/api/attachments/feedbeef12345678feedbeef12345678feedbeef12345678feedbeef12345678');

    const roundTrip = jsonCanvasToBoard(jsonCanvas);
    expect(roundTrip.nodes).toHaveLength(1);
    const restoredNode = roundTrip.nodes[0];
    expect(restoredNode.fileName).toBe('diagram-screenshot.png');
    expect(restoredNode.fileHash).toBe('feedbeef12345678feedbeef12345678feedbeef12345678feedbeef12345678');
    expect(restoredNode.imageUrl).toBe('/api/attachments/feedbeef12345678feedbeef12345678feedbeef12345678feedbeef12345678');
  });

  it('4. Magnetic ports geometry and connection calculation supports image node type', () => {
    const imgBox: BoxNode = {
      id: 'img-node-1',
      x: 100,
      y: 100,
      width: 300,
      height: 200
    };

    // Verify all 4 magnetic ports are correctly computed for image node
    const topPort = getPortCoordinates(imgBox, 'top');
    expect(topPort).toEqual({ x: 250, y: 100 });

    const rightPort = getPortCoordinates(imgBox, 'right');
    expect(rightPort).toEqual({ x: 400, y: 200 });

    const bottomPort = getPortCoordinates(imgBox, 'bottom');
    expect(bottomPort).toEqual({ x: 250, y: 300 });

    const leftPort = getPortCoordinates(imgBox, 'left');
    expect(leftPort).toEqual({ x: 100, y: 200 });

    // Target snapping when dragging an arrow towards an image node
    const candidates: BoxNode[] = [imgBox];
    const snapToRight = findMagneticTargetPort(candidates, 'source-node-id', 410, 205, 28);
    expect(snapToRight).not.toBeNull();
    expect(snapToRight?.nodeId).toBe('img-node-1');
    expect(snapToRight?.side).toBe('right');
    expect(snapToRight?.point).toEqual({ x: 400, y: 200 });

    const snapToLeft = findMagneticTargetPort(candidates, 'source-node-id', 92, 198, 28);
    expect(snapToLeft).not.toBeNull();
    expect(snapToLeft?.nodeId).toBe('img-node-1');
    expect(snapToLeft?.side).toBe('left');
    expect(snapToLeft?.point).toEqual({ x: 100, y: 200 });

    // Verify Yjs edge creation from image node to another node
    const yDoc = new Y.Doc();
    const yEdges = yDoc.getMap<BoardEdgeData>('edges');
    const edgeId = 'edge-img-to-sticky';
    yEdges.set(edgeId, {
      id: edgeId,
      from: 'img-node-1',
      to: 'sticky-target-1',
      fromSide: 'right',
      toSide: 'left',
      direction: 'forward',
      style: 'solid',
      curveType: 'bezier',
      color: '#38bdf8',
      deleted: false
    });

    const edge = yEdges.get(edgeId);
    expect(edge).toBeDefined();
    expect(edge?.from).toBe('img-node-1');
    expect(edge?.to).toBe('sticky-target-1');
    expect(edge?.fromSide).toBe('right');
    expect(edge?.toSide).toBe('left');
  });

  it('5. Responsive scaling: corner resize preserves aspect ratio to eliminate letterbox gaps', () => {
    // Helper function reproducing the proportional resize algorithm
    function computeProportionalResize(
      startW: number,
      startH: number,
      startX: number,
      startY: number,
      handle: string,
      dx: number,
      dy: number,
      isImage: boolean,
      shiftKey: boolean
    ) {
      let newW = startW;
      let newH = startH;
      let newX = startX;
      let newY = startY;

      const isCorner = handle === 'nw' || handle === 'ne' || handle === 'se' || handle === 'sw';
      const keepProportional = isImage && !shiftKey;

      if (keepProportional && isCorner) {
        const ratio = (startW > 0 && startH > 0) ? (startW / startH) : 1;
        if (handle === 'se') {
          if (Math.abs(dx) >= Math.abs(dy * ratio)) {
            newW = Math.max(60, startW + dx);
            newH = Math.max(40, Math.round(newW / ratio));
          } else {
            newH = Math.max(40, startH + dy);
            newW = Math.max(60, Math.round(newH * ratio));
          }
        } else if (handle === 'sw') {
          if (Math.abs(-dx) >= Math.abs(dy * ratio)) {
            newW = Math.max(60, startW - dx);
            newH = Math.max(40, Math.round(newW / ratio));
          } else {
            newH = Math.max(40, startH + dy);
            newW = Math.max(60, Math.round(newH * ratio));
          }
          newX = startX + (startW - newW);
        } else if (handle === 'ne') {
          if (Math.abs(dx) >= Math.abs(-dy * ratio)) {
            newW = Math.max(60, startW + dx);
            newH = Math.max(40, Math.round(newW / ratio));
          } else {
            newH = Math.max(40, startH - dy);
            newW = Math.max(60, Math.round(newH * ratio));
          }
          newY = startY + (startH - newH);
        } else if (handle === 'nw') {
          if (Math.abs(-dx) >= Math.abs(-dy * ratio)) {
            newW = Math.max(60, startW - dx);
            newH = Math.max(40, Math.round(newW / ratio));
          } else {
            newH = Math.max(40, startH - dy);
            newW = Math.max(60, Math.round(newH * ratio));
          }
          newX = startX + (startW - newW);
          newY = startY + (startH - newH);
        }
      }

      return { newX, newY, newW, newH };
    }

    const startW = 320;
    const startH = 180; // 16:9 ratio
    const originalRatio = startW / startH;

    // Corner SE drag - horizontal dominant
    const res1 = computeProportionalResize(startW, startH, 100, 100, 'se', 160, 40, true, false);
    expect(res1.newW).toBe(480);
    expect(res1.newH).toBe(270);
    expect(res1.newW / res1.newH).toBeCloseTo(originalRatio, 2);

    // Corner SE drag - vertical dominant (pulling frame downward)
    const res2 = computeProportionalResize(startW, startH, 100, 100, 'se', 50, 180, true, false);
    expect(res2.newH).toBe(360);
    expect(res2.newW).toBe(640);
    expect(res2.newW / res2.newH).toBeCloseTo(originalRatio, 2);

    // Corner NW drag (top-left) - adjusts position and dimensions together
    const res3 = computeProportionalResize(startW, startH, 200, 200, 'nw', -80, -45, true, false);
    expect(res3.newW).toBe(400);
    expect(res3.newH).toBe(225);
    expect(res3.newX).toBe(120);
    expect(res3.newY).toBe(155);
    expect(res3.newW / res3.newH).toBeCloseTo(originalRatio, 2);
  });
});
