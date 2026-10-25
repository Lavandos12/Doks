import * as Y from 'yjs';
import type { BoardNodeData, BoardEdgeData } from './types.js';
import {
  DOC_INDEX,
  getIndexMaps,
  getBoardMaps,
  getNoteDocName,
  getBoardDocName,
  getScopedIndexDocName,
  getScopedBoardDocName,
  getNoteText,
  nodeMapToData
} from './schema.js';

export interface AiExportOptions {
  boardId: string;
  scope?: 'all' | 'selection' | 'frame';
  selectedNodeIds?: string[];
  frameId?: string;
  includeNotes?: 'none' | 'cards' | 'linked';
  includeAttachments?: 'none' | 'list' | 'text';
  anonymizeMembers?: boolean;
  compactNotes?: boolean;
  maxNoteLength?: number;
  timestamp?: string; // Deterministic timestamp for testing
  workspaceScope?: 'solo' | 'team';
}

export interface AiExportResult {
  markdown: string;
  charCount: number;
  estimatedTokens: number;
  openTasksCount: number;
}

const COLOR_HEX_MAP: Record<string, string> = {
  '#fef08a': 'жёлтый',
  '#fef9c3': 'жёлтый',
  '#fde047': 'жёлтый',
  '#bbf7d0': 'зелёный',
  '#dcfce7': 'зелёный',
  '#86efac': 'зелёный',
  '#bae6fd': 'синий',
  '#e0f2fe': 'синий',
  '#7dd3fc': 'синий',
  '#fecaca': 'красный',
  '#fee2e2': 'красный',
  '#fca5a5': 'красный',
  '#e9d5ff': 'фиолетовый',
  '#f3e8ff': 'фиолетовый',
  '#d8b4fe': 'фиолетовый',
  '#fed7aa': 'оранжевый',
  '#ffedd5': 'оранжевый',
  '#fdba74': 'оранжевый',
  '#99f6e4': 'бирюзовый',
  '#ccfbf1': 'бирюзовый',
  '#5eead4': 'бирюзовый',
  '#e2e8f0': 'серый',
  '#f1f5f9': 'серый',
  '#cbd5e1': 'серый',
  '#f5f5f5': 'серый',
  '#ffffff': 'без цвета',
  'none': 'без цвета',
  'default': 'без цвета'
};

const COLOR_NAMES: Record<string, string> = {
  '1': 'жёлтый',
  '2': 'зелёный',
  '3': 'синий',
  '4': 'красный',
  '5': 'фиолетовый',
  '6': 'серый',
  ...COLOR_HEX_MAP
};

export function resolveColorName(color: string | undefined): string {
  if (!color || color === 'none' || color === 'default') return 'без цвета';
  const c = color.trim().toLowerCase();
  if (COLOR_NAMES[c]) return COLOR_NAMES[c];
  if (c.startsWith('#') && (c.length === 7 || c.length === 4)) {
    let r = 0, g = 0, b = 0;
    if (c.length === 7) {
      r = parseInt(c.slice(1, 3), 16);
      g = parseInt(c.slice(3, 5), 16);
      b = parseInt(c.slice(5, 7), 16);
    } else {
      r = parseInt(c[1] + c[1], 16);
      g = parseInt(c[2] + c[2], 16);
      b = parseInt(c[3] + c[3], 16);
    }
    const standardColors = [
      { name: 'жёлтый', r: 254, g: 240, b: 138 },
      { name: 'зелёный', r: 187, g: 247, b: 208 },
      { name: 'синий', r: 186, g: 230, b: 253 },
      { name: 'красный', r: 254, g: 202, b: 202 },
      { name: 'фиолетовый', r: 233, g: 213, b: 255 },
      { name: 'оранжевый', r: 254, g: 215, b: 170 },
      { name: 'бирюзовый', r: 153, g: 246, b: 228 },
      { name: 'серый', r: 226, g: 232, b: 240 }
    ];
    let closest = standardColors[0];
    let minDist = Infinity;
    for (const sc of standardColors) {
      const dist = (r - sc.r) ** 2 + (g - sc.g) ** 2 + (b - sc.b) ** 2;
      if (dist < minDist) {
        minDist = dist;
        closest = sc;
      }
    }
    return closest.name;
  }
  return color;
}

export function generateAiContext(
  docManager: { getOrCreateDoc: (name: string) => Y.Doc },
  options: AiExportOptions
): AiExportResult {
  const wsScope = options.workspaceScope || 'team';
  const indexDoc = docManager.getOrCreateDoc(getScopedIndexDocName(wsScope));
  const { notes, boards } = getIndexMaps(indexDoc);

  let boardMeta = boards.get(options.boardId);
  if (!boardMeta && wsScope !== 'team') {
    const fallbackIndex = docManager.getOrCreateDoc(DOC_INDEX);
    boardMeta = getIndexMaps(fallbackIndex).boards.get(options.boardId);
  }
  const boardTitle = boardMeta?.title || 'Без названия';

  const boardDoc = docManager.getOrCreateDoc(getScopedBoardDocName(wsScope, options.boardId));
  const { nodes: yNodes, edges: yEdges } = getBoardMaps(boardDoc);

  // 1. Collect all non-deleted nodes
  const rawNodes: BoardNodeData[] = [];
  yNodes.forEach((nodeMap, id) => {
    const data = nodeMapToData(id, nodeMap);
    if (!data.deleted) {
      // Privacy filter
      if (data.text && data.text.includes('#private')) return;
      rawNodes.push(data);
    }
  });

  // Sort nodes deterministically: frames first, then top-to-bottom, left-to-right
  rawNodes.sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    if (a.x !== b.x) return a.x - b.x;
    return a.id.localeCompare(b.id);
  });

  // Scope filtering
  let filteredNodes = rawNodes;
  if (options.scope === 'selection' && options.selectedNodeIds) {
    const set = new Set(options.selectedNodeIds);
    filteredNodes = rawNodes.filter((n) => set.has(n.id));
  } else if (options.scope === 'frame' && options.frameId) {
    const targetFrame = rawNodes.find((n) => n.id === options.frameId && n.type === 'frame');
    if (targetFrame) {
      filteredNodes = rawNodes.filter((n) => {
        if (n.id === targetFrame.id) return true;
        return (
          n.x >= targetFrame.x &&
          n.x + n.w <= targetFrame.x + targetFrame.w &&
          n.y >= targetFrame.y &&
          n.y + n.h <= targetFrame.y + targetFrame.h
        );
      });
    }
  }

  // Map IDs to short deterministic identifiers: n_xxxxxx or n1, n2 if seq is present
  const idToShort = new Map<string, string>();
  filteredNodes.forEach((n) => {
    if ((n as any).seq !== undefined && (n as any).seq !== null) {
      idToShort.set(n.id, `n${(n as any).seq}`);
    } else {
      const clean = n.id.replace(/[^a-zA-Z0-9]/g, '');
      const prefix = clean.length >= 6 ? clean.slice(0, 6) : clean.padEnd(6, '0');
      idToShort.set(n.id, `n_${prefix}`);
    }
  });

  // Separate frames and elements
  const frames = filteredNodes.filter((n) => n.type === 'frame');
  const nonFrames = filteredNodes.filter((n) => n.type !== 'frame');

  // Map elements into frames (spatial containment)
  const frameContents = new Map<string, BoardNodeData[]>();
  frames.forEach((f) => frameContents.set(f.id, []));
  const unassigned: BoardNodeData[] = [];

  for (const n of nonFrames) {
    let placed = false;
    for (const f of frames) {
      if (n.x >= f.x && n.x + n.w <= f.x + f.w && n.y >= f.y && n.y + n.h <= f.y + f.h) {
        frameContents.get(f.id)!.push(n);
        placed = true;
        break;
      }
    }
    if (!placed) {
      unassigned.push(n);
    }
  }

  // Author anonymization map
  const authorMap = new Map<string, string>();
  let authorCounter = 1;
  const getAuthor = (name: string) => {
    if (!name) return 'Неизвестный';
    if (!options.anonymizeMembers) return name;
    if (!authorMap.has(name)) {
      authorMap.set(name, `Участник ${authorCounter++}`);
    }
    return authorMap.get(name)!;
  };

  // Connected notes collection
  interface ConnectedNote {
    id: string;
    title: string;
    content: string;
  }
  const connectedNotes: ConnectedNote[] = [];
  if (options.includeNotes !== 'none') {
    const noteIdsToInclude = new Set<string>();
    filteredNodes.forEach((n) => {
      if (n.noteId) noteIdsToInclude.add(n.noteId);
      if (options.includeNotes === 'linked' || options.includeNotes === undefined) {
        const wikiMatches = n.text.matchAll(/\[\[(.*?)\]\]/g);
        for (const m of wikiMatches) {
          const title = m[1].split('|')[0].trim();
          notes.forEach((meta, id) => {
            if (!meta.deleted && meta.title === title) {
              noteIdsToInclude.add(id);
            }
          });
        }
      }
    });

    for (const nId of noteIdsToInclude) {
      const meta = notes.get(nId);
      if (!meta || meta.deleted) continue;

      const noteDoc = docManager.getOrCreateDoc(getNoteDocName(nId));
      const content = getNoteText(noteDoc).toString();

      // Privacy check
      if (content.includes('#private')) continue;

      connectedNotes.push({
        id: nId,
        title: meta.title,
        content
      });
    }
  }

  // Stats calculation
  const totalObjects = filteredNodes.length;
  let stickiesCount = 0;
  let textsCount = 0;
  let notesCount = 0;
  let doneCount = 0;
  const openTasks: { shortId: string; text: string; author: string }[] = [];

  filteredNodes.forEach((n) => {
    if (n.type === 'sticky') stickiesCount++;
    if (n.type === 'text') textsCount++;
    if (n.type === 'note') notesCount++;
    if (n.done) {
      doneCount++;
    } else if (n.type === 'sticky') {
      openTasks.push({
        shortId: idToShort.get(n.id)!,
        text: n.text.replace(/\r?\n/g, ' '),
        author: getAuthor(n.author)
      });
    }
  });

  // Open checkboxes from connected notes
  for (const cn of connectedNotes) {
    const noteLines = cn.content.split(/\r?\n/);
    for (const line of noteLines) {
      const match = line.match(/^\s*-\s*\[ \]\s*(.+)$/);
      if (match) {
        const taskText = match[1].trim();
        openTasks.push({
          shortId: '',
          text: `[${cn.title}] ${taskText}`,
          author: ''
        });
      }
    }
  }

  // Check for Color Legend
  let legendText = '';
  const legendFrame = frames.find((f) => f.text.toLowerCase().includes('легенда'));
  if (legendFrame) {
    const items = frameContents.get(legendFrame.id) || [];
    if (items.length > 0) {
      legendText = `Легенда цветов: ${items.map((it) => `${resolveColorName(it.color)} = ${it.text}`).join('; ')}.`;
    }
  }

  // Timestamp
  const nowStr = options.timestamp || new Date().toISOString().replace('T', ' ').slice(0, 16);

  // Markdown output builder
  const lines: string[] = [];
  lines.push(`# Контекст доски: ${boardTitle}`);
  lines.push(`Формат: doks-ai/1. Экспорт: ${nowStr}.`);
  lines.push(`Это выгрузка рабочей доски команды. Объекты имеют короткие id (n_xxxxxx или n1, n2...).`);
  if (legendText) {
    lines.push(legendText);
  } else {
    lines.push(`Цвет сам по себе смысла не несёт, если ниже не задана легенда.`);
  }
  lines.push('');

  // 2. Сводка
  lines.push(`## Сводка`);
  const typeParts: string[] = [];
  if (stickiesCount > 0) typeParts.push(`стикеров ${stickiesCount}`);
  if (textsCount > 0) typeParts.push(`текстов ${textsCount}`);
  if (notesCount > 0) typeParts.push(`карточек заметок ${notesCount}`);
  if (frames.length > 0) typeParts.push(`рамок ${frames.length}`);
  lines.push(`Объектов: ${totalObjects} (${typeParts.join(', ')}).`);
  if (stickiesCount > 0) {
    lines.push(`Выполнено: ${doneCount} из ${stickiesCount} стикеров.`);
  }
  lines.push('');

  // 3. Структура и содержимое по рамкам
  const formatNode = (n: BoardNodeData) => {
    const sid = idToShort.get(n.id)!;
    const typeLabel = n.type === 'sticky' ? 'стикер' : n.type === 'note' ? 'заметка' : n.type === 'frame' ? 'рамка' : n.type;
    const colorLabel = resolveColorName(n.color);
    const authorLabel = `автор: ${getAuthor(n.author)}`;
    const statusLabel = n.done ? '[x]' : '[ ]';
    const textLabel = n.text.replace(/\r?\n/g, ' ');
    return `- ${sid} | ${typeLabel} | ${colorLabel} | ${authorLabel} | ${statusLabel} | ${textLabel}`;
  };

  for (const f of frames) {
    const fid = idToShort.get(f.id)!;
    lines.push(`## Рамка «${f.text || 'Рамка'}» (${fid})`);
    const children = frameContents.get(f.id) || [];
    if (children.length === 0) {
      lines.push(`*(пусто)*`);
    } else {
      children.forEach((c) => lines.push(formatNode(c)));
    }
    lines.push('');
  }

  if (unassigned.length > 0) {
    lines.push(`## Объекты вне рамок`);
    unassigned.forEach((u) => lines.push(formatNode(u)));
    lines.push('');
  }

  // 4. Связи (Edges)
  const edgesOutput: string[] = [];
  yEdges.forEach((edge) => {
    if (edge.deleted) return;
    const fromSid = idToShort.get(edge.from);
    const toSid = idToShort.get(edge.to);
    if (fromSid && toSid) {
      const label = edge.label ? ` («${edge.label}»)` : '';
      edgesOutput.push(`${fromSid} → ${toSid}${label}`);
    }
  });

  if (edgesOutput.length > 0) {
    lines.push(`## Связи`);
    edgesOutput.forEach((e) => lines.push(e));
    lines.push('');
  }

  // 5. Пространственная карта (Spatial Map)
  lines.push(`## Пространственная карта`);
  filteredNodes.forEach((n) => {
    const sid = idToShort.get(n.id)!;
    lines.push(`${sid}: x=${Math.round(n.x)}, y=${Math.round(n.y)}, w=${Math.round(n.w)}, h=${Math.round(n.h)}`);
  });
  lines.push('');

  // 6. Подключённые заметки
  if (connectedNotes.length > 0) {
    lines.push(`## Подключённые заметки`);
    for (const cn of connectedNotes) {
      let content = cn.content;
      if (options.compactNotes && content.length > (options.maxNoteLength || 500)) {
        content = content.slice(0, options.maxNoteLength || 500) + `\n... [обрезано: ${content.length} симв.]`;
      }
      lines.push(`### Заметка: ${cn.title}`);
      lines.push(content);
      lines.push('');
    }
  }

  // 7. Открытые задачи
  if (openTasks.length > 0) {
    lines.push(`## Открытые задачи`);
    openTasks.forEach((t) => {
      if (t.shortId) {
        lines.push(`- [ ] ${t.shortId} (${t.author}): ${t.text}`);
      } else {
        lines.push(`- [ ] ${t.text}`);
      }
    });
    lines.push('');
  }

  // 8. Подсказка в конце
  lines.push(`## Подсказка для ИИ`);
  lines.push(`Если предлагаешь изменения, ссылайся на id объектов (\`n_xxxxxx\` или \`n1\`...) и названия заметок.`);

  const markdown = lines.join('\n');
  const charCount = markdown.length;
  const estimatedTokens = Math.ceil(charCount / 3.5);

  return {
    markdown,
    charCount,
    estimatedTokens,
    openTasksCount: openTasks.length
  };
}
