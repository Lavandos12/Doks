export interface GeneratedDiagramNode {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  shapeType: 'rounded' | 'diamond' | 'rectangle' | 'pill';
}

export interface GeneratedDiagramEdge {
  id: string;
  fromNode: string;
  fromSide: 'right' | 'bottom';
  toNode: string;
  toSide: 'left' | 'top';
  color: string;
}

export const DIAGRAM_PALETTE = ['#818cf8', '#38bdf8', '#34d399', '#facc15', '#fb7185', '#c084fc'];

export const DIAGRAM_PRESETS: Record<string, { title: string; content: string }> = {
  mindmap_product: {
    title: 'Mindmap: Разработка продукта',
    content: `Архитектура Doks
  Клиент (React + Canvas)
    Бесконечный холст
    Редактор заметок
    Векторные стрелки
  Сервер (Node + Yjs)
    Хранилище SQLite
    Синхронизация P2P
    Парсер документов
  Безопасность
    Шифрование ChaCha20
    Ed25519 ключи`
  },
  flowchart_auth: {
    title: 'Блок-схема: Алгоритм авторизации',
    content: `Старт -> Ввод логина и пароля -> Проверка данных?
Проверка данных? -> Успешно -> Главная страница
Проверка данных? -> Ошибка -> Восстановление доступа -> Ввод логина и пароля`
  },
  kanban_board: {
    title: 'Kanban: Доска задач',
    content: `Бэклог -> В работе -> Ревью кода -> Готово к релизу`
  },
  swot_analysis: {
    title: 'SWOT-анализ проекта',
    content: `Сильные стороны (Strengths) -> Возможности (Opportunities)
Слабые стороны (Weaknesses) -> Угрозы (Threats)`
  },
  roadmap: {
    title: 'Дорожная карта (Roadmap)',
    content: `Q1: Архитектура P2P -> Q2: Canvas и Заметки -> Q3: Безопасность и VPN -> Q4: Релиз v1.0`
  }
};

/**
 * Parses either Flowchart syntax ("A -> B -> C") or indented Mindmap lists
 * and computes a non-overlapping hierarchical layout centered at (originX, originY).
 */
export function generateDiagramFromText(
  input: string,
  originX = 200,
  originY = 200
): { nodes: GeneratedDiagramNode[]; edges: GeneratedDiagramEdge[] } {
  const lines = input
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.trim().length > 0);

  const nodesByLabel = new Map<string, GeneratedDiagramNode>();
  const edges: GeneratedDiagramEdge[] = [];
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  const getOrCreateNode = (rawLabel: string, depthHint = 0): GeneratedDiagramNode => {
    let clean = rawLabel.trim().replace(/^[-*•]\s*/, '');
    const isCondition = clean.endsWith('?');

    let shapeType: 'rounded' | 'diamond' | 'rectangle' | 'pill' = isCondition
      ? 'diamond'
      : depthHint === 0
      ? 'pill'
      : 'rounded';

    const shapeMatch = clean.match(/^(.*?)\s*\[(diamond|rectangle|rect|circle|pill|rounded)\]$/i);
    if (shapeMatch) {
      clean = shapeMatch[1].trim();
      const variant = shapeMatch[2].toLowerCase();
      if (variant === 'rect' || variant === 'rectangle') shapeType = 'rectangle';
      else if (variant === 'diamond') shapeType = 'diamond';
      else if (variant === 'circle' || variant === 'pill') shapeType = 'pill';
      else shapeType = 'rounded';
    }

    if (nodesByLabel.has(clean)) {
      const existing = nodesByLabel.get(clean)!;
      if (shapeMatch) existing.shapeType = shapeType;
      return existing;
    }

    const id = `diag-node-${nodesByLabel.size + 1}-${Math.random().toString(36).slice(2, 6)}`;
    const node: GeneratedDiagramNode = {
      id,
      text: clean,
      x: originX,
      y: originY,
      width: 210,
      height: 84,
      color: DIAGRAM_PALETTE[depthHint % DIAGRAM_PALETTE.length],
      shapeType,
    };
    nodesByLabel.set(clean, node);
    if (!adj.has(id)) adj.set(id, []);
    if (!inDegree.has(id)) inDegree.set(id, 0);
    return node;
  };

  const hasArrows = lines.some((l) => l.includes('->') || l.includes('→'));

  if (hasArrows) {
    // Parse Flowchart chains: "Шаг 1 -> Шаг 2 -> Шаг 3"
    for (const line of lines) {
      const parts = line.split(/->|→/).map((s) => s.trim()).filter(Boolean);
      for (let i = 0; i < parts.length; i++) {
        const curr = getOrCreateNode(parts[i], i);
        if (i > 0) {
          const prev = getOrCreateNode(parts[i - 1], i - 1);
          adj.get(prev.id)!.push(curr.id);
          inDegree.set(curr.id, (inDegree.get(curr.id) || 0) + 1);
          edges.push({
            id: `diag-edge-${edges.length + 1}-${Math.random().toString(36).slice(2, 6)}`,
            fromNode: prev.id,
            fromSide: 'right',
            toNode: curr.id,
            toSide: 'left',
            color: curr.color,
          });
        }
      }
    }
  } else {
    // Parse Indented Mindmap Tree
    const stack: { indent: number; node: GeneratedDiagramNode }[] = [];
    for (const line of lines) {
      const indent = line.search(/\S/);
      const depth = Math.max(0, Math.floor(indent / 2));
      const node = getOrCreateNode(line, depth);

      while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }
      if (stack.length > 0) {
        const parent = stack[stack.length - 1].node;
        adj.get(parent.id)!.push(node.id);
        inDegree.set(node.id, (inDegree.get(node.id) || 0) + 1);
        edges.push({
          id: `diag-edge-${edges.length + 1}-${Math.random().toString(36).slice(2, 6)}`,
          fromNode: parent.id,
          fromSide: 'right',
          toNode: node.id,
          toSide: 'left',
          color: node.color,
        });
      }
      stack.push({ indent, node });
    }
  }

  // Compute Layered Tree / DAG coordinates (Left-to-Right)
  const allNodes = Array.from(nodesByLabel.values());
  const roots = allNodes.filter((n) => (inDegree.get(n.id) || 0) === 0);
  if (roots.length === 0 && allNodes.length > 0) roots.push(allNodes[0]);

  const layerMap = new Map<string, number>();
  const queue = roots.map((r) => ({ id: r.id, layer: 0 }));
  while (queue.length > 0) {
    const { id, layer } = queue.shift()!;
    if ((layerMap.get(id) ?? -1) < layer) {
      layerMap.set(id, layer);
      for (const nextId of adj.get(id) || []) {
        if (layer < 20) queue.push({ id: nextId, layer: layer + 1 });
      }
    }
  }

  const columns = new Map<number, GeneratedDiagramNode[]>();
  for (const node of allNodes) {
    const col = layerMap.get(node.id) ?? 0;
    if (!columns.has(col)) columns.set(col, []);
    columns.get(col)!.push(node);
  }

  const X_STEP = 280;
  const Y_STEP = 120;

  for (const [col, colNodes] of columns.entries()) {
    const totalHeight = (colNodes.length - 1) * Y_STEP;
    colNodes.forEach((node, idx) => {
      node.x = Math.round(originX + col * X_STEP);
      node.y = Math.round(originY - totalHeight / 2 + idx * Y_STEP);
      node.color = DIAGRAM_PALETTE[col % DIAGRAM_PALETTE.length];
    });
  }

  return { nodes: allNodes, edges };
}

/**
 * Computes a clean topological DAG/grid layout for an existing graph of nodes & edges.
 */
export function computeAutoLayout(
  nodes: Array<{ id: string; x: number; y: number; width: number; height: number }>,
  edges: Array<{ from: string; to: string }>,
  originX = 120,
  originY = 120
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return result;

  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const n of nodes) {
    adj.set(n.id, []);
    inDegree.set(n.id, 0);
  }

  for (const e of edges) {
    if (adj.has(e.from) && inDegree.has(e.to)) {
      adj.get(e.from)!.push(e.to);
      inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1);
    }
  }

  const roots = nodes.filter((n) => inDegree.get(n.id) === 0);
  if (roots.length === 0) roots.push(nodes[0]);

  const layerMap = new Map<string, number>();
  const queue = roots.map((r) => ({ id: r.id, layer: 0 }));
  while (queue.length > 0) {
    const { id, layer } = queue.shift()!;
    if ((layerMap.get(id) ?? -1) < layer) {
      layerMap.set(id, layer);
      for (const nextId of adj.get(id) || []) {
        if (layer < 30) queue.push({ id: nextId, layer: layer + 1 });
      }
    }
  }

  const columns = new Map<number, typeof nodes>();
  for (const node of nodes) {
    const col = layerMap.get(node.id) ?? 0;
    if (!columns.has(col)) columns.set(col, []);
    columns.get(col)!.push(node);
  }

  const X_GAP = 280;
  const Y_GAP = 130;

  for (const [col, colNodes] of columns.entries()) {
    const totalHeight = (colNodes.length - 1) * Y_GAP;
    colNodes.forEach((node, idx) => {
      result.set(node.id, {
        x: Math.round(originX + col * X_GAP),
        y: Math.round(originY - totalHeight / 2 + idx * Y_GAP)
      });
    });
  }

  return result;
}
