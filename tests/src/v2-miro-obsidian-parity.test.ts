import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  buildEdgeSvgPath,
  getEdgeMidpoint,
  type PortSide
} from '../../web/src/utils/connectorGeometry.js';
import {
  matchShortcut,
  createBoardUndoManager,
  CANVAS_UNDO_ORIGIN
} from '../../web/src/utils/hotkeysAndUndo.js';
import {
  nodeMapToData,
  setNodeProperties,
  type BoardNodeData,
  type BoardEdgeData
} from '@doks/shared';
import { findBacklinks } from '../../web/src/components/notes/wikilinks-extension.js';

describe('Doks v2.0 Miro + Obsidian Parity Suite', () => {
  describe('1. Physical Layout-Independent Hotkeys (Russian RU & English EN)', () => {
    it('matches Ctrl+Z on Russian (RU) layout where e.key is "я" and e.code is "KeyZ"', () => {
      const ruEvent = {
        key: 'я',
        code: 'KeyZ',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false
      } as unknown as KeyboardEvent;

      expect(matchShortcut(ruEvent, 'mod+z')).toBe(true);
      expect(matchShortcut(ruEvent, 'mod+shift+z')).toBe(false);
    });

    it('matches Redo (Ctrl+Y or Ctrl+Shift+Z) on Russian (RU) layout', () => {
      const ruShiftZ = {
        key: 'Я',
        code: 'KeyZ',
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
        altKey: false
      } as unknown as KeyboardEvent;

      const ruY = {
        key: 'н',
        code: 'KeyY',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false
      } as unknown as KeyboardEvent;

      expect(matchShortcut(ruShiftZ, 'mod+shift+z')).toBe(true);
      expect(matchShortcut(ruY, 'mod+y')).toBe(true);
    });

    it('matches Copy (Ctrl+C), Paste (Ctrl+V), Duplicate (Ctrl+D), Group (Ctrl+G), Select All (Ctrl+A) on Russian (RU) layout', () => {
      const makeRuEvent = (code: string, cyrillicKey: string) => ({
        key: cyrillicKey,
        code,
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false
      } as unknown as KeyboardEvent);

      expect(matchShortcut(makeRuEvent('KeyC', 'с'), 'mod+c')).toBe(true);
      expect(matchShortcut(makeRuEvent('KeyV', 'м'), 'mod+v')).toBe(true);
      expect(matchShortcut(makeRuEvent('KeyD', 'в'), 'mod+d')).toBe(true);
      expect(matchShortcut(makeRuEvent('KeyG', 'п'), 'mod+g')).toBe(true);
      expect(matchShortcut(makeRuEvent('KeyA', 'ф'), 'mod+a')).toBe(true);
    });

    it('matches identical shortcuts on English (EN) layout', () => {
      const enEvent = {
        key: 'z',
        code: 'KeyZ',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false
      } as unknown as KeyboardEvent;

      expect(matchShortcut(enEvent, 'mod+z')).toBe(true);
    });
  });

  describe('2. Multi-Curve SVG Edge Generation & Midpoint Inspector Calculation', () => {
    const x1 = 100, y1 = 100, s1: PortSide = 'right';
    const x2 = 300, y2 = 250, s2: PortSide = 'left';

    it('generates a direct SVG line for "straight" curveType', () => {
      const path = buildEdgeSvgPath(x1, y1, s1, x2, y2, s2, 'straight');
      expect(path).toBe('M 100 100 L 300 250');
    });

    it('generates a 3-segment right-angle path for "orthogonal" curveType', () => {
      const path = buildEdgeSvgPath(x1, y1, s1, x2, y2, s2, 'orthogonal');
      expect(path).toContain('M 100 100');
      expect(path).toContain('L 200 100');
      expect(path).toContain('L 200 250');
      expect(path).toContain('L 300 250');
    });

    it('generates a smooth cubic bezier for "bezier" curveType', () => {
      const path = buildEdgeSvgPath(x1, y1, s1, x2, y2, s2, 'bezier');
      expect(path.startsWith('M 100 100 C')).toBe(true);
    });

    it('calculates accurate midpoint for positioning floating edge inspectors', () => {
      const straightMid = getEdgeMidpoint(x1, y1, s1, x2, y2, s2, 'straight');
      expect(straightMid.x).toBe(200);
      expect(straightMid.y).toBe(175);

      const orthoMid = getEdgeMidpoint(x1, y1, s1, x2, y2, s2, 'orthogonal');
      expect(orthoMid.x).toBe(200);
      expect(orthoMid.y).toBe(175);

      const bezierMid = getEdgeMidpoint(x1, y1, s1, x2, y2, s2, 'bezier');
      expect(bezierMid.x).toBeGreaterThan(100);
      expect(bezierMid.x).toBeLessThan(300);
      expect(bezierMid.y).toBeGreaterThan(100);
      expect(bezierMid.y).toBeLessThan(250);
    });
  });

  describe('3. Extended Edge & Node Schema (Color, Curve, Shapes)', () => {
    it('serializes and deserializes shapeVariant on BoardNodeData', () => {
      const doc = new Y.Doc();
      const nodesMap = doc.getMap('nodes');
      const nodeMap = new Y.Map();
      nodesMap.set('node-shape-1', nodeMap);
      setNodeProperties(nodeMap, {
        id: 'node-shape-1',
        type: 'shape',
        x: 50,
        y: 80,
        w: 120,
        h: 120,
        text: 'Diamond Decision',
        color: '3',
        author: 'Architect',
        shapeVariant: 'diamond',
        z: 1,
        deleted: false
      });

      const data = nodeMapToData('node-shape-1', nodeMap);
      expect(data.shapeVariant).toBe('diamond');
      expect(data.type).toBe('shape');
    });

    it('supports custom color, thickness, and curveType on BoardEdgeData', () => {
      const edge: BoardEdgeData = {
        id: 'edge-custom-1',
        from: 'node-1',
        to: 'node-2',
        fromSide: 'right',
        toSide: 'left',
        color: '#e06c75',
        curveType: 'orthogonal',
        thickness: 3,
        style: 'dashed',
        direction: 'both',
        label: 'Flow Decision',
        deleted: false
      };

      expect(edge.color).toBe('#e06c75');
      expect(edge.curveType).toBe('orthogonal');
      expect(edge.thickness).toBe(3);
      expect(edge.style).toBe('dashed');
      expect(edge.direction).toBe('both');
    });
  });

  describe('4. Scoped Y.UndoManager for Board Nodes & Edges', () => {
    it('undoes and redoes node position modifications made under canvas-edit origin', () => {
      const doc = new Y.Doc();
      const yNodes = doc.getMap('nodes');
      const yEdges = doc.getMap('edges');

      const controller = createBoardUndoManager(doc, yNodes, yEdges);

      // 1. Initial node creation
      const nodeMap = new Y.Map();
      doc.transact(() => {
        yNodes.set('n1', nodeMap);
        setNodeProperties(nodeMap, {
          id: 'n1',
          type: 'sticky',
          x: 100,
          y: 100,
          w: 200,
          h: 120,
          text: 'Initial Text',
          color: '1',
          author: 'Tester',
          z: 1,
          deleted: false
        });
      }, CANVAS_UNDO_ORIGIN);

      expect(yNodes.get('n1').get('x')).toBe(100);

      // Stop capturing so next move is a separate undo transaction
      controller.undoManager.stopCapturing();

      // 2. Drag move to (400, 500)
      doc.transact(() => {
        nodeMap.set('x', 400);
        nodeMap.set('y', 500);
      }, CANVAS_UNDO_ORIGIN);

      expect(yNodes.get('n1').get('x')).toBe(400);
      expect(yNodes.get('n1').get('y')).toBe(500);

      // 3. Undo drag move
      controller.undo();
      expect(yNodes.get('n1').get('x')).toBe(100);
      expect(yNodes.get('n1').get('y')).toBe(100);

      // 4. Redo drag move
      controller.redo();
      expect(yNodes.get('n1').get('x')).toBe(400);
      expect(yNodes.get('n1').get('y')).toBe(500);

      controller.destroy();
    });
  });

  describe('5. Obsidian [[Wikilinks]] Backlinks Discovery', () => {
    it('discovers notes that contain [[targetTitle]] references', () => {
      const sampleNotes = [
        { id: '1', title: 'Architecture', text: 'See [[Project Plan]] and [[Database Schema]].' },
        { id: '2', title: 'Roadmap', text: 'Depends on [[Project Plan]].' },
        { id: '3', title: 'Unrelated', text: 'No links here.' },
        { id: '4', title: 'Project Plan', text: 'Self reference [[Project Plan]] should be excluded.' }
      ];

      const backlinks = findBacklinks('Project Plan', sampleNotes);
      expect(backlinks.length).toBe(2);
      expect(backlinks.map((b) => b.title)).toEqual(['Architecture', 'Roadmap']);
    });
  });
});
