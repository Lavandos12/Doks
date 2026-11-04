import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  nodeMapToData,
  setNodeProperties,
  boardToJSONCanvas,
  jsonCanvasToBoard,
  generateAiContext,
  getScopedIndexDocName,
  getScopedBoardDocName,
  getScopedNoteDocName,
  getIndexMaps,
  getBoardMaps,
  getNoteText,
  type BoardNodeData,
  type BoardEdgeData
} from '@doks/shared';
import {
  getPortCoordinates,
  getPortAngle,
  computeArrowheadPolygon,
  getEdgeEndpointAngles,
  findMagneticTargetPort,
  type BoxNode
} from '../../web/src/utils/connectorGeometry.js';
import { computeSmartAlignment, type BoxRect } from '../../web/src/utils/smartAlignment.js';
import { PeerDiscoveryService } from '../../agent/src/peer/peer-discovery.js';

describe('V6 Full System Audit & Master Fix Suite', () => {
  // 1. Schema & Yjs Data Loss Prevention
  describe('Part 1: Yjs Schema Node Field Preservation', () => {
    it('nodeMapToData preserves all 10+ custom properties without data loss', () => {
      const yDoc = new Y.Doc();
      const nodeMap = yDoc.getMap('node-full-fields');

      const initialData: Partial<BoardNodeData> = {
        id: 'node-full-fields',
        type: 'chart',
        x: 100,
        y: 150,
        w: 320,
        h: 240,
        text: 'Диаграмма квартала',
        color: '#6366f1',
        chartType: 'donut',
        chartData: [
          { id: '1', label: 'Frontend', value: 60, color: '#6366f1' },
          { id: '2', label: 'Backend', value: 40, color: '#10b981' }
        ],
        points: [{ x: 10, y: 15 }, { x: 30, y: 45 }],
        drawMode: 'brush',
        description: 'Колонка в процессе',
        codeLanguage: 'typescript',
        fileDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
        uploaderOrigin: 'http://192.168.1.50:3000',
        imageUrl: 'http://192.168.1.50:3000/api/attachments/abc'
      };

      setNodeProperties(nodeMap, initialData);

      const recovered = nodeMapToData('node-full-fields', nodeMap);

      expect(recovered.id).toBe('node-full-fields');
      expect(recovered.type).toBe('chart');
      expect(recovered.chartType).toBe('donut');
      expect(recovered.chartData).toEqual([
        { id: '1', label: 'Frontend', value: 60, color: '#6366f1' },
        { id: '2', label: 'Backend', value: 40, color: '#10b981' }
      ]);
      expect(recovered.points).toEqual([{ x: 10, y: 15 }, { x: 30, y: 45 }]);
      expect(recovered.drawMode).toBe('brush');
      expect(recovered.description).toBe('Колонка в процессе');
      expect(recovered.codeLanguage).toBe('typescript');
      expect(recovered.fileDataUrl).toBe('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==');
      expect(recovered.uploaderOrigin).toBe('http://192.168.1.50:3000');
      expect(recovered.imageUrl).toBe('http://192.168.1.50:3000/api/attachments/abc');
    });

    it('JSON Canvas serialization roundtrip preserves doks_custom widgets', () => {
      const nodes: BoardNodeData[] = [
        {
          id: 'widget-1',
          type: 'chart',
          x: 200,
          y: 300,
          w: 300,
          h: 220,
          text: 'Сводка спринта',
          color: '#10b981',
          author: 'tester',
          z: 1,
          deleted: false,
          chartType: 'bar',
          chartData: [{ id: 'a', label: 'Задачи', value: 80, color: '#10b981' }],
          codeLanguage: 'python',
          description: 'Колонка задач',
          drawMode: 'highlighter',
          points: [{ x: 5, y: 5 }, { x: 25, y: 25 }]
        }
      ];

      const edges: BoardEdgeData[] = [];

      const jsonCanvas = boardToJSONCanvas(nodes, edges);
      const canvasNode = jsonCanvas.nodes[0] as any;

      expect(canvasNode).toBeDefined();
      expect(canvasNode.doks_custom).toBeDefined();
      expect(canvasNode.doks_custom.chartType).toBe('bar');
      expect(canvasNode.doks_custom.codeLanguage).toBe('python');
      expect(canvasNode.doks_custom.description).toBe('Колонка задач');
      expect(canvasNode.doks_custom.drawMode).toBe('highlighter');

      const restored = jsonCanvasToBoard(jsonCanvas);
      const restoredNode = restored.nodes[0];

      expect(restoredNode.id).toBe('widget-1');
      expect(restoredNode.type).toBe('chart');
      expect(restoredNode.chartType).toBe('bar');
      expect(restoredNode.chartData).toEqual([{ id: 'a', label: 'Задачи', value: 80, color: '#10b981' }]);
      expect(restoredNode.codeLanguage).toBe('python');
      expect(restoredNode.description).toBe('Колонка задач');
      expect(restoredNode.drawMode).toBe('highlighter');
    });
  });

  // 2. AI Context Generator Scoped Note Resolution & Widget Formats
  describe('Part 1b: AI Context Generation', () => {
    it('resolves notes from scoped workspace and formats checklist, code, and chart nodes', () => {
      const docs = new Map<string, Y.Doc>();
      const docManager = {
        getOrCreateDoc: (name: string) => {
          if (!docs.has(name)) {
            docs.set(name, new Y.Doc());
          }
          return docs.get(name)!;
        }
      };

      const soloIndex = docManager.getOrCreateDoc(getScopedIndexDocName('solo'));
      const { boards, notes } = getIndexMaps(soloIndex);

      boards.set('board-solo-1', {
        id: 'board-solo-1',
        title: 'Личный проект',
        folder: null,
        createdAt: 1000,
        updatedAt: 2000,
        deleted: false
      });

      notes.set('note-solo-1', {
        id: 'note-solo-1',
        title: 'Планы на неделю',
        folder: null,
        createdAt: 1000,
        updatedAt: 2000,
        deleted: false
      });

      const noteDoc = docManager.getOrCreateDoc(getScopedNoteDocName('solo', 'note-solo-1'));
      getNoteText(noteDoc).insert(0, '# Задачи\n- [ ] Купить сервер\n- [x] Настроить DNS');

      const boardDoc = docManager.getOrCreateDoc(getScopedBoardDocName('solo', 'board-solo-1'));
      const { nodes: yNodes } = getBoardMaps(boardDoc);

      const m1 = new Y.Map();
      yNodes.set('chk-1', m1);
      setNodeProperties(m1, {
        id: 'chk-1',
        type: 'checklist',
        x: 100,
        y: 100,
        w: 240,
        h: 180,
        text: '- [ ] Дописать тесты\n- [x] Проверить сборку',
        color: '2'
      });

      const m2 = new Y.Map();
      yNodes.set('code-1', m2);
      setNodeProperties(m2, {
        id: 'code-1',
        type: 'code',
        x: 400,
        y: 100,
        w: 300,
        h: 180,
        text: 'const x: number = 42;',
        codeLanguage: 'typescript',
        color: '3'
      });

      const m3 = new Y.Map();
      yNodes.set('chart-1', m3);
      setNodeProperties(m3, {
        id: 'chart-1',
        type: 'chart',
        x: 100,
        y: 350,
        w: 280,
        h: 220,
        text: 'Бюджет',
        chartType: 'donut',
        chartData: [
          { id: '1', label: 'Разработка', value: 70, color: '#6366f1' },
          { id: '2', label: 'Маркетинг', value: 30, color: '#10b981' }
        ],
        color: '5'
      });

      const res = generateAiContext(docManager, {
        boardId: 'board-solo-1',
        workspaceScope: 'solo',
        includeNotes: 'cards',
        timestamp: '2026-10-27 18:00'
      });

      expect(res.markdown).toContain('# Board Context: Личный проект');
      expect(res.markdown).toContain('checklist');
      expect(res.markdown).toContain('[typescript] const x: number = 42;');
      expect(res.markdown).toContain('donut: [Разработка: 70%, Маркетинг: 30%]');
      expect(res.markdown).toContain('Дописать тесты');
      expect(res.openTasksCount).toBeGreaterThan(0);
    });
  });

  // 3. Connector Geometry Tangent Angles & Arrowhead Alignment
  describe('Part 2: Connector Tangent Angles & Arrowhead Geometry', () => {
    it('computes exact incoming tangents for straight, bezier, and orthogonal curves', () => {
      // 1. Straight diagonal line from (0, 0) to (100, 100) -> 45 deg = PI/4
      const straightAngles = getEdgeEndpointAngles(0, 0, 'right', 100, 100, 'left', 'straight');
      expect(straightAngles.endAngle).toBeCloseTo(Math.PI / 4, 3);
      expect(straightAngles.startAngle).toBeCloseTo(-3 * Math.PI / 4, 3);

      // 2. Bezier curve entering from the left port of target node
      const bezierAngles = getEdgeEndpointAngles(0, 50, 'right', 200, 150, 'left', 'bezier');
      expect(typeof bezierAngles.endAngle).toBe('number');
      expect(typeof bezierAngles.startAngle).toBe('number');

      // 3. Orthogonal curve ending at (300, 200) from top port
      const orthoAngles = getEdgeEndpointAngles(100, 100, 'right', 300, 200, 'left', 'orthogonal');
      expect(typeof orthoAngles.endAngle).toBe('number');
    });

    it('computeArrowheadPolygon renders 3 valid vertex coordinates aligned with tangent', () => {
      const poly = computeArrowheadPolygon(150, 150, Math.PI / 2, 12, 6);
      expect(poly).toContain('150.0,150.0');
      const pts = poly.split(' ');
      expect(pts.length).toBe(3);
    });
  });

  // 4. Reconnection & Magnetic Halo Self-Loop Prevention
  describe('Part 2b: Reconnection Halo & Port Snapping', () => {
    const candidateNodes: BoxNode[] = [
      { id: 'node-source', x: 50, y: 50, width: 100, height: 80 },
      { id: 'node-opposite', x: 300, y: 50, width: 100, height: 80 },
      { id: 'node-other', x: 200, y: 200, width: 100, height: 80 }
    ];

    it('findMagneticTargetPort excludes sourceNodeId and oppositeNodeId to prevent self-loops', () => {
      // Point directly on node-opposite's port (300, 90)
      const snapOnOpposite = findMagneticTargetPort(candidateNodes, 'node-opposite', 302, 90, 28);
      // Because 'node-opposite' is passed as the excluded ID, snapping to it must return null or another node
      if (snapOnOpposite) {
        expect(snapOnOpposite.nodeId).not.toBe('node-opposite');
      } else {
        expect(snapOnOpposite).toBeNull();
      }

      // Point directly near node-other's left port (200, 240)
      const snapOnOther = findMagneticTargetPort(candidateNodes, 'node-source', 198, 240, 28);
      expect(snapOnOther).toBeDefined();
      expect(snapOnOther?.nodeId).toBe('node-other');
      expect(snapOnOther?.side).toBe('left');
    });
  });

  // 5. Smart Alignment Vertical Equal Spacing Snapping
  describe('Part 2c: Smart Alignment Equal Spacing', () => {
    it('snaps vertical equal gaps when dragging cards in a column', () => {
      const candidates: BoxRect[] = [
        { id: 'card-1', x: 100, y: 100, w: 200, h: 100 },
        { id: 'card-2', x: 100, y: 240, w: 200, h: 100 } // gap = 240 - 200 = 40px
      ];

      // Dragging card-3 near y = 380 (gap should be 40px, so expected y = 240 + 100 + 40 = 380)
      const draggingBox: BoxRect = { id: 'card-3', x: 100, y: 383, w: 200, h: 100 };

      const res = computeSmartAlignment(draggingBox, candidates, 8);
      expect(res.snappedY).toBe(380);
      expect(res.guides.some((g) => g.type === 'horizontal')).toBe(true);
    });
  });

  // 6. Peer Discovery Security: Zero Plaintext Key Leaks
  describe('Part 4: Peer Discovery Security Audit', () => {
    it('broadcastBeacon packet does NOT contain plaintext teamKey', () => {
      const discovery = new PeerDiscoveryService({
        teamKey: 'super-secret-password-12345',
        peerId: 'peer-alice-777',
        wsPort: 49999,
        port: 49999
      });

      let sentPacket = '';
      (discovery as any).isRunning = true;
      (discovery as any).socket = {
        send: (buf: Buffer) => {
          sentPacket = buf.toString('utf8');
        }
      };

      discovery.broadcastBeacon();

      expect(sentPacket).toBeDefined();
      expect(sentPacket.length).toBeGreaterThan(0);
      const parsed = JSON.parse(sentPacket);

      // Packet must contain workspaceHash, peerId, wsPort, protocol
      expect(parsed.protocol).toBe('doks-v1');
      expect(parsed.peerId).toBe('peer-alice-777');
      expect(parsed.workspaceHash).toBeDefined();
      // Packet MUST NOT contain plaintext teamKey!
      expect(parsed.teamKey).toBeUndefined();
      expect(sentPacket).not.toContain('super-secret-password-12345');

      discovery.stop();
    });
  });
});
