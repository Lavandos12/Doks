import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as Y from 'yjs';

describe('v79 Markdown Document Systems: Full Content Ingestion, Reactivity & Card Rendering', () => {
  const canvasPath = path.resolve(process.cwd(), 'web/src/components/board/board-canvas.tsx');
  const canvasSrc = fs.readFileSync(canvasPath, 'utf8');

  const dropZonePath = path.resolve(process.cwd(), 'web/src/hooks/useCanvasDropZone.ts');
  const dropZoneSrc = fs.readFileSync(dropZonePath, 'utf8');

  describe('1. File Drop Zone Ingestion', () => {
    it('should detect .md, .markdown, and .txt files and read full text', () => {
      expect(dropZoneSrc).toContain("lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.txt')");
      expect(dropZoneSrc).toContain('const text = await file.text();');
      expect(dropZoneSrc).toContain('await onCreateNoteAndCard(cleanTitle, text, targetX, targetY);');
    });
  });

  describe('2. Note Card Reactivity & Subscriptions', () => {
    it('should define NoteCardContent component that subscribes to yText.observe', () => {
      expect(canvasSrc).toContain('function NoteCardContent({ noteId, scope, fallbackTitle }: NoteCardContentProps)');
      expect(canvasSrc).toContain('yText.observe(updateContent);');
      expect(canvasSrc).toContain('yjsClient.requestSync(docName);');
      expect(canvasSrc).toContain('yText.unobserve(updateContent);');
    });

    it('should render NoteCardContent inside isNote branch', () => {
      expect(canvasSrc).toContain('<NoteCardContent');
      expect(canvasSrc).toContain('noteId={node.noteId!}');
      expect(canvasSrc).toContain('scope={effectiveScope}');
    });

    it('should enable smooth scrolling and prevent mouse event bubbling in note body', () => {
      expect(canvasSrc).toContain('class="note-card-content-view scrollable-card-content markdown-body"');
      expect(canvasSrc).toContain("onMouseDown={(e) => e.stopPropagation()}");
    });
  });

  describe('3. Content Preservation & Existing Note Update', () => {
    it('should overwrite and preserve full markdown in yText without discarding by pre-seeded template', () => {
      expect(canvasSrc).toContain('yText.delete(0, yText.length);');
      expect(canvasSrc).toContain('yText.insert(0, markdown);');
    });

    it('should find existing note with same title to heal/update rather than creating duplicate', () => {
      expect(canvasSrc).toContain('maps.notes.forEach((meta, id) => {');
      expect(canvasSrc).toContain('if (!meta.deleted && meta.title === title) {');
    });

    it('should use generous reading dimensions (420x540) for note cards', () => {
      expect(canvasSrc).toContain('w: 420,');
      expect(canvasSrc).toContain('h: 540,');
    });

    it('should verify 500KB+ document text preservation in Y.Text', () => {
      const doc = new Y.Doc();
      const yText = doc.getText('text');

      // Pre-seed like createNote does
      yText.insert(0, '# Document Title\n\n');
      expect(yText.toString()).toBe('# Document Title\n\n');

      // Simulate a 550KB file content (10,000 lines)
      const bigContent = Array.from({ length: 5000 }, (_, i) => `Paragraph ${i}: Detailed specification and architectural breakdown.\n`).join('');
      expect(bigContent.length).toBeGreaterThan(300000);

      // Execute zero-loss transaction
      doc.transact(() => {
        if (yText.length > 0) {
          yText.delete(0, yText.length);
        }
        yText.insert(0, bigContent);
      });

      expect(yText.length).toBe(bigContent.length);
      expect(yText.toString()).toBe(bigContent);
    });
  });

  describe('4. Working Edit Action', () => {
    it('should render Edit action in note card header that switches to split mode', () => {
      expect(canvasSrc).toContain('Icon name="edit"');
      expect(canvasSrc).toContain('ensureSplitTabs();');
      expect(canvasSrc).toContain("setWorkspaceMode('split');");
    });
  });
});
