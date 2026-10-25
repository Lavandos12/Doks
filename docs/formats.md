# Doks Data Formats Specification

Doks uses open, standardized, human-readable file formats to prevent vendor lock-in. Vaults created in Doks can be opened and edited directly in Obsidian, VS Code, or any text editor.

---

## 1. Markdown Notes (`.md`)

Notes are stored as standard CommonMark / GitHub Flavored Markdown files with YAML frontmatter headers.

### Frontmatter Schema
```markdown
---
id: "3fa85f64-5717-4562-b3fc-2c963f66afa6"
title: "Архитектурный план"
folder: "Разработка"
tags: ["core", "p2p"]
status: "in-progress"
aliases: ["Arch Plan", "V2 Spec"]
createdAt: 1714000000000
updatedAt: 1714005000000
---

# Архитектурный план

Текст заметки с поддержкой вики-ссылок: [[Другая заметка]] или [[Другая заметка|Кастомный алиас]].

> [!note] Callout Block
> Блоки внимания оформляются по стандартной спецификации Obsidian Callouts.

- [ ] Открытая задача
- [x] Выполненная задача
```

---

## 2. Boards (`.canvas`) — JSON Canvas Spec v1.0

Board documents follow the official [JSON Canvas 1.0 Specification](https://jsoncanvas.org/spec/1.0/).

### Example `.canvas` Document
```json
{
  "nodes": [
    {
      "id": "node-1",
      "type": "text",
      "text": "Стикер задачи",
      "x": 100,
      "y": 100,
      "width": 200,
      "height": 200,
      "color": "3",
      "author": "Alice",
      "done": false
    },
    {
      "id": "node-2",
      "type": "file",
      "file": "Архитектурный план.md",
      "x": 400,
      "y": 100,
      "width": 260,
      "height": 220
    }
  ],
  "edges": [
    {
      "id": "edge-1",
      "fromNode": "node-1",
      "fromSide": "right",
      "toNode": "node-2",
      "toSide": "left",
      "color": "1"
    }
  ]
}
```

---

## 3. AI Context Export Format (`doks-ai/1`)

When exporting board context for LLMs (via `Ctrl+Shift+E` or `POST /api/export/ai`), Doks compiles a deterministic Markdown document with:
- Specification header `FORMAT: doks-ai/1`.
- Summary statistics and legend of board colors.
- Frames hierarchy with child sticky notes mapped to stable short IDs (`n1`, `n2`...).
- Spatial map of coordinates and sizes.
- Full text of linked note cards (with optional truncation).
- Aggregated checklist of open tasks (`- [ ]`).
