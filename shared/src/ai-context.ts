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
  getScopedNoteDocName,
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
  '#fef08a': 'yellow',
  '#fef9c3': 'yellow',
  '#fde047': 'yellow',
  '#bbf7d0': 'green',
  '#dcfce7': 'green',
  '#86efac': 'green',
  '#bae6fd': 'blue',
  '#e0f2fe': 'blue',
  '#7dd3fc': 'blue',
  '#fecaca': 'red',
  '#fee2e2': 'red',
  '#fca5a5': 'red',
  '#e9d5ff': 'purple',
  '#f3e8ff': 'purple',
  '#d8b4fe': 'purple',
  '#fed7aa': 'orange',
  '#ffedd5': 'orange',
  '#fdba74': 'orange',
  '#99f6e4': 'teal',
  '#ccfbf1': 'teal',
  '#5eead4': 'teal',
  '#e2e8f0': 'gray',
  '#f1f5f9': 'gray',
  '#cbd5e1': 'gray',
  '#f5f5f5': 'gray',
  '#ffffff': 'colorless',
  'none': 'colorless',
  'default': 'colorless'
};

const COLOR_NAMES: Record<string, string> = {
  '1': 'yellow',
  '2': 'green',
  '3': 'blue',
  '4': 'red',
  '5': 'purple',
  '6': 'gray',
  ...COLOR_HEX_MAP
};

export function resolveColorName(color: string | undefined): string {
  if (!color || color === 'none' || color === 'default') return 'colorless';
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
      { name: 'yellow', r: 254, g: 240, b: 138 },
      { name: 'green', r: 187, g: 247, b: 208 },
      { name: 'blue', r: 186, g: 230, b: 253 },
      { name: 'red', r: 254, g: 202, b: 202 },
      { name: 'purple', r: 233, g: 213, b: 255 },
      { name: 'orange', r: 254, g: 215, b: 170 },
      { name: 'teal', r: 153, g: 246, b: 228 },
      { name: 'gray', r: 226, g: 232, b: 240 }
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
  const boardTitle = boardMeta?.title || 'Untitled';

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
    if (!name) return 'Unknown';
    if (!options.anonymizeMembers) return name;
    if (!authorMap.has(name)) {
      authorMap.set(name, `Member ${authorCounter++}`);
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
        const nodeText = typeof n.text === 'string' ? n.text : '';
        const wikiMatches = nodeText.matchAll(/\[\[(.*?)\]\]/g);
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

      let noteDoc = docManager.getOrCreateDoc(getScopedNoteDocName(wsScope, nId));
      let content = getNoteText(noteDoc).toString();
      if (!content && wsScope !== 'team') {
        const fallbackDoc = docManager.getOrCreateDoc(getNoteDocName(nId));
        const fallbackContent = getNoteText(fallbackDoc).toString();
        if (fallbackContent) {
          noteDoc = fallbackDoc;
          content = fallbackContent;
        }
      }

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
        text: (n.text || '').replace(/\r?\n/g, ' '),
        author: getAuthor(n.author)
      });
    } else if (n.type === 'checklist' && n.text) {
      const items = n.text.split(/\r?\n/);
      for (const item of items) {
        const trimmed = item.trim();
        if (!trimmed) continue;
        const unchecked = trimmed.match(/^-\s*\[ \]\s*(.+)$/);
        if (unchecked) {
          openTasks.push({
            shortId: idToShort.get(n.id)!,
            text: unchecked[1],
            author: getAuthor(n.author)
          });
        }
      }
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
  const legendFrame = frames.find((f) => (f.text || '').toLowerCase().includes('legend'));
  if (legendFrame) {
    const items = frameContents.get(legendFrame.id) || [];
    if (items.length > 0) {
      legendText = `Color Legend: ${items.map((it) => `${resolveColorName(it.color)} = ${it.text}`).join('; ')}.`;
    }
  }

  // Timestamp
  const nowStr = options.timestamp || new Date().toISOString().replace('T', ' ').slice(0, 16);

  // Markdown output builder
  const lines: string[] = [];
  lines.push(`# Board Context: ${boardTitle}`);
  lines.push(`Format: doks-ai/1. Export: ${nowStr}.`);
  lines.push(`Export of team collaborative whiteboard. Elements have short ids (n_xxxxxx or n1, n2...).`);
  if (legendText) {
    lines.push(legendText);
  } else {
    lines.push(`Color carries no inherent meaning unless specified in legend below.`);
  }
  lines.push('');

  // 2. Summary
  lines.push(`## Summary`);
  const typeParts: string[] = [];
  if (stickiesCount > 0) typeParts.push(`stickies: ${stickiesCount}`);
  if (textsCount > 0) typeParts.push(`texts: ${textsCount}`);
  if (notesCount > 0) typeParts.push(`note cards: ${notesCount}`);
  if (frames.length > 0) typeParts.push(`frames: ${frames.length}`);
  lines.push(`Objects: ${totalObjects} (${typeParts.join(', ')}).`);
  if (stickiesCount > 0) {
    lines.push(`Completed: ${doneCount} of ${stickiesCount} stickies.`);
  }
  lines.push('');

  // 3. Structure and frame contents
  const formatNode = (n: BoardNodeData) => {
    const sid = idToShort.get(n.id)!;
    const typeLabel =
      n.type === 'sticky' ? 'sticky' :
      n.type === 'note' ? 'note' :
      n.type === 'frame' ? 'frame' :
      n.type === 'checklist' ? 'checklist' :
      n.type === 'table' ? 'table' :
      n.type === 'kanban' ? 'kanban' :
      n.type === 'chart' ? 'chart' :
      n.type === 'code' ? 'code' :
      n.type === 'file' ? 'file' :
      n.type === 'drawing' ? 'drawing' :
      n.type === 'shape' ? 'shape' : n.type;
    const colorLabel = resolveColorName(n.color);
    const authorLabel = `author: ${getAuthor(n.author)}`;
    const statusLabel = n.done ? '[x]' : '[ ]';
    let textLabel = (n.text || '').replace(/\r?\n/g, ' ');

    if (n.type === 'chart' && n.chartData) {
      try {
        const parsed = typeof n.chartData === 'string' ? JSON.parse(n.chartData) : n.chartData;
        if (Array.isArray(parsed)) {
          const items = parsed.map((item: any) => `${item.label || 'Untitled'}: ${item.value || 0}%`).join(', ');
          textLabel = `${n.chartType || 'pie'}: [${items}] ${textLabel}`.trim();
        }
      } catch {}
    } else if (n.type === 'code') {
      textLabel = `[${n.codeLanguage || 'text'}] ${textLabel}`.trim();
    } else if (n.type === 'kanban' && n.description) {
      textLabel = `${textLabel} (${n.description})`.trim();
    }

    return `- ${sid} | ${typeLabel} | ${colorLabel} | ${authorLabel} | ${statusLabel} | ${textLabel}`;
  };

  for (const f of frames) {
    const fid = idToShort.get(f.id)!;
    lines.push(`## Frame "${f.text || 'Frame'}" (${fid})`);
    const children = frameContents.get(f.id) || [];
    if (children.length === 0) {
      lines.push(`*(empty)*`);
    } else {
      children.forEach((c) => lines.push(formatNode(c)));
    }
    lines.push('');
  }

  if (unassigned.length > 0) {
    lines.push(`## Elements outside frames`);
    unassigned.forEach((u) => lines.push(formatNode(u)));
    lines.push('');
  }

  // 4. Connections (Edges)
  const edgesOutput: string[] = [];
  yEdges.forEach((edge) => {
    if (edge.deleted) return;
    const fromSid = idToShort.get(edge.from);
    const toSid = idToShort.get(edge.to);
    if (fromSid && toSid) {
      const label = edge.label ? ` ("${edge.label}")` : '';
      edgesOutput.push(`${fromSid} → ${toSid}${label}`);
    }
  });

  if (edgesOutput.length > 0) {
    lines.push(`## Connections`);
    edgesOutput.forEach((e) => lines.push(e));
    lines.push('');
  }

  // 5. Spatial Map
  lines.push(`## Spatial Map`);
  filteredNodes.forEach((n) => {
    const sid = idToShort.get(n.id)!;
    lines.push(`${sid}: x=${Math.round(n.x)}, y=${Math.round(n.y)}, w=${Math.round(n.w)}, h=${Math.round(n.h)}`);
  });
  lines.push('');

  // 6. Connected Notes
  if (connectedNotes.length > 0) {
    lines.push(`## Connected Notes`);
    for (const cn of connectedNotes) {
      let content = cn.content;
      if (options.compactNotes && content.length > (options.maxNoteLength || 500)) {
        content = content.slice(0, options.maxNoteLength || 500) + `\n... [truncated: ${content.length} chars]`;
      }
      lines.push(`### Note: ${cn.title}`);
      lines.push(content);
      lines.push('');
    }
  }

  // 7. Open Tasks
  if (openTasks.length > 0) {
    lines.push(`## Open Tasks`);
    openTasks.forEach((t) => {
      if (t.shortId) {
        lines.push(`- [ ] ${t.shortId} (${t.author}): ${t.text}`);
      } else {
        lines.push(`- [ ] ${t.text}`);
      }
    });
    lines.push('');
  }

  // 8. Guidance at the end
  lines.push(`## Guidance for AI`);
  lines.push(`When proposing changes, reference object IDs (\`n_xxxxxx\` or \`n1\`...) and note titles.`);

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
