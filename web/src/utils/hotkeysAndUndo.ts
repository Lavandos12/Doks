import * as Y from 'yjs';

/**
 * Checks whether the currently focused element is an interactive text input
 * or editor (where single-key or text editing hotkeys should not trigger canvas actions).
 */
export function isEditableElementFocused(): boolean {
  const active = document.activeElement;
  if (!active) return false;

  const tag = active.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    return true;
  }

  if ((active as HTMLElement).isContentEditable) {
    return true;
  }

  if (active.closest('.cm-editor') || active.closest('[contenteditable="true"]')) {
    return true;
  }

  return false;
}

/**
 * Matches a physical keyboard event against a normalized shortcut string.
 * Uses `e.code` (hardware key position) so hotkeys work identically regardless
 * of active keyboard layout (Russian RU, English EN, German, etc.).
 *
 * Supported shortcut patterns:
 * - 'mod+z' (Ctrl+Z or Cmd+Z)
 * - 'mod+shift+z' or 'mod+y' (Redo)
 * - 'mod+c' (Copy)
 * - 'mod+v' (Paste)
 * - 'mod+x' (Cut)
 * - 'mod+d' (Duplicate)
 * - 'mod+a' (Select All)
 * - 'mod+g' (Group / Wrap in Frame)
 * - 'key:s', 'key:t', 'key:f', 'key:n', 'key:l', 'key:r' (Tool shortcuts)
 * - 'delete', 'backspace', 'escape'
 */
export function matchShortcut(e: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.toLowerCase().split('+');
  const key = parts[parts.length - 1];

  const requiresMod = parts.includes('mod') || parts.includes('ctrl');
  const requiresShift = parts.includes('shift');
  const requiresAlt = parts.includes('alt');

  const hasMod = e.ctrlKey || e.metaKey;
  const hasShift = e.shiftKey;
  const hasAlt = e.altKey;

  if (requiresMod !== hasMod) return false;
  if (requiresShift !== hasShift) return false;
  if (requiresAlt !== hasAlt) return false;

  // Code-based matching map for physical hardware keys
  const codeMap: Record<string, string[]> = {
    z: ['KeyZ'],
    y: ['KeyY'],
    c: ['KeyC'],
    v: ['KeyV'],
    x: ['KeyX'],
    d: ['KeyD'],
    a: ['KeyA'],
    s: ['KeyS'],
    t: ['KeyT'],
    f: ['KeyF'],
    n: ['KeyN'],
    l: ['KeyL'],
    r: ['KeyR'],
    e: ['KeyE'],
    g: ['KeyG'],
    h: ['KeyH'],
    k: ['KeyK'],
    p: ['KeyP'],
    b: ['KeyB'],
    m: ['KeyM'],
    w: ['KeyW'],
    q: ['KeyQ'],
    u: ['KeyU'],
    i: ['KeyI'],
    o: ['KeyO'],
    j: ['KeyJ'],
    backslash: ['Backslash', 'IntlBackslash'],
    delete: ['Delete'],
    backspace: ['Backspace'],
    escape: ['Escape']
  };

  // Russian keyboard layout fallback map (Russian standard QWERTY phonetic mapping)
  const ruKeyMap: Record<string, string> = {
    q: 'й', w: 'ц', e: 'у', r: 'к', t: 'е', y: 'н', u: 'г', i: 'ш', o: 'щ', p: 'з',
    a: 'ф', s: 'ы', d: 'в', f: 'а', g: 'п', h: 'р', j: 'о', k: 'л', l: 'д',
    z: 'я', x: 'ч', c: 'с', v: 'м', b: 'и', n: 'т', m: 'ь'
  };

  const expectedCodes = codeMap[key] || (key.length === 1 && key >= 'a' && key <= 'z' ? [`Key${key.toUpperCase()}`] : undefined);
  if (expectedCodes && e.code) {
    if (expectedCodes.includes(e.code)) return true;
  }

  // Fallback to e.key for non-alphabetic keys or if e.code is undefined in headless environments
  if (key === 'delete' && e.key === 'Delete') return true;
  if (key === 'backspace' && e.key === 'Backspace') return true;
  if (key === 'escape' && (e.key === 'Escape' || e.key === 'Esc')) return true;
  if (e.key) {
    const lk = e.key.toLowerCase();
    if (lk === key) return true;
    if (ruKeyMap[key] && lk === ruKeyMap[key]) return true;
  }

  return false;
}

export const CANVAS_UNDO_ORIGIN = 'canvas-edit';

export interface BoardUndoManagerController {
  undoManager: Y.UndoManager;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  destroy: () => void;
}

/**
 * Creates a scoped Y.UndoManager instance for a specific board's nodes and edges maps.
 * Tracks changes made under the CANVAS_UNDO_ORIGIN or undefined local origins.
 */
export function createBoardUndoManager(
  _boardDoc: Y.Doc,
  yNodes: Y.Map<any>,
  yEdges: Y.Map<any>
): BoardUndoManagerController {
  const scope: Array<Y.Map<any> | Y.Array<any> | Y.Text> = [yNodes, yEdges];

  const undoManager = new Y.UndoManager(scope, {
    trackedOrigins: new Set([CANVAS_UNDO_ORIGIN, null, undefined]),
    captureTimeout: 400
  });

  return {
    undoManager,
    undo: () => {
      if (undoManager.canUndo()) {
        undoManager.undo();
      }
    },
    redo: () => {
      if (undoManager.canRedo()) {
        undoManager.redo();
      }
    },
    canUndo: () => undoManager.canUndo(),
    canRedo: () => undoManager.canRedo(),
    destroy: () => {
      undoManager.destroy();
    }
  };
}
