import { useState, useCallback } from 'preact/hooks';
import type { JSX } from 'preact';

export interface DropGhostState {
  worldX: number;
  worldY: number;
  label: string;
  count: number;
}

interface UseCanvasDropZoneOptions {
  screenToWorld: (clientX: number, clientY: number) => { x: number; y: number };
  onCreateNoteAndCard: (title: string, markdown: string, x: number, y: number) => Promise<void>;
  onLinkExistingNoteToCanvas: (noteId: string, x: number, y: number) => void;
  onUploadAndCreateMediaCard: (file: File, x: number, y: number, previewUrl?: string) => Promise<void>;
}

export function useCanvasDropZone({
  screenToWorld,
  onCreateNoteAndCard,
  onLinkExistingNoteToCanvas,
  onUploadAndCreateMediaCard,
}: UseCanvasDropZoneOptions) {
  const [dropGhost, setDropGhost] = useState<DropGhostState | null>(null);

  const handleDragOver = useCallback(
    (e: JSX.TargetedDragEvent<HTMLElement> | DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }

      const pt = screenToWorld(e.clientX, e.clientY);
      const isInternalNote = e.dataTransfer ? (
        e.dataTransfer.types.includes('application/x-doks-note') ||
        e.dataTransfer.types.includes('application/doks-note-id')
      ) : false;
      const itemCount = e.dataTransfer?.items ? e.dataTransfer.items.length : 1;

      setDropGhost({
        worldX: pt.x,
        worldY: pt.y,
        label: isInternalNote
          ? 'Разместить карточку заметки здесь'
          : itemCount > 1
          ? `Разместить файлы (${itemCount} шт.) здесь`
          : 'Разместить документ на холсте',
        count: Math.max(1, itemCount),
      });
    },
    [screenToWorld]
  );

  const handleDragLeave = useCallback((e: JSX.TargetedDragEvent<HTMLElement> | DragEvent) => {
    if (e.currentTarget && (e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return;
    setDropGhost(null);
  }, []);

  const handleDrop = useCallback(
    async (e: JSX.TargetedDragEvent<HTMLElement> | DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const basePt = screenToWorld(e.clientX, e.clientY);
      setDropGhost(null);

      if (!e.dataTransfer) return;

      // 1. Check if user dragged an existing note from the Doks sidebar
      const internalNoteId = e.dataTransfer.getData('application/x-doks-note') || e.dataTransfer.getData('application/doks-note-id');
      if (internalNoteId) {
        onLinkExistingNoteToCanvas(internalNoteId, basePt.x - 140, basePt.y - 90);
        return;
      }

      // 2. Handle files dropped from OS Folder (Windows Explorer / Finder / Linux)
      const files = Array.from(e.dataTransfer.files || []);
      if (files.length === 0) return;

      const COLS = 3;
      const CARD_W = 280;
      const CARD_H = 200;
      const GAP = 28;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const targetX = Math.round(basePt.x - CARD_W / 2 + col * (CARD_W + GAP));
        const targetY = Math.round(basePt.y - CARD_H / 2 + row * (CARD_H + GAP));

        const lower = file.name.toLowerCase();
        if (lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.txt')) {
          const text = await file.text();
          const cleanTitle = file.name.replace(/\.(md|markdown|txt)$/i, '');
          await onCreateNoteAndCard(cleanTitle, text, targetX, targetY);
        } else if (file.type.startsWith('image/')) {
          const instantBlobUrl = URL.createObjectURL(file);
          await onUploadAndCreateMediaCard(file, targetX, targetY, instantBlobUrl);
        } else {
          await onUploadAndCreateMediaCard(file, targetX, targetY);
        }
      }
    },
    [screenToWorld, onCreateNoteAndCard, onLinkExistingNoteToCanvas, onUploadAndCreateMediaCard]
  );

  return {
    dropGhost,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}
