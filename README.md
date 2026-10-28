# Doks — Decentralized Collaborative Workspace

> [!NOTE]
> Read this documentation in Russian: [README.ru.md](README.ru.md).

**Doks** is a decentralized, local-first collaborative workspace designed for teams of 4–8 people. It combines Obsidian-compatible Markdown notes with bidirectional `[[wikilinks]]`, Miro-style infinite boards using standard JSON Canvas (`.canvas`), P2P CRDT synchronization over virtual private networks (Radmin VPN / LAN) using **Yjs**, chunked attachment transfers, and deterministic AI context exports (`doks-ai/1`).

---

## 1. Feature Matrix

| Feature | Status | Description |
|---|---|---|
| **Local-First Architecture** | Supported | 100% offline-ready, connects exclusively to `127.0.0.1`, mirrors directly to standard `.md` and `.canvas` files |
| **Two-Tier Workspaces (Solo & Team)** | Supported | Private personal workspace (`solo`, zero network leakage) and collaborative mesh workspace (`team`) with single-click promotion bridge |
| **Miro-Level Canvas & Boards** | Supported | Sticky notes, frames, note cards, arrow connectors, multi-selection, Tab-chaining, minimap, grid snap (16px) |
| **Obsidian-Level Notes** | Supported | CodeMirror 6, Live Preview, callouts (`[!note]`, `[!warning]`), frontmatter properties, outline panel, `[[wikilinks]]` refactoring |
| **True P2P Decentralized Mesh** | Supported | Mutual WebSocket mesh over Radmin VPN/LAN, Ed25519 peer identities, AEAD AES-256-GCM encryption, UDP beacon discovery |
| **Backpressure & Large Media** | Supported | Dual-queue transmission prioritizing CRDT/Awareness over chunked 256 KB binary attachments |
| **Full-Text Search** | Supported | MiniSearch with Russian normalization (`ё` = `е`), title, body, and hashtag search (`Ctrl+Shift+F`) |
| **AI Context Export (`doks-ai/1`)** | Supported | Generates structured, deterministic board context for Claude, Gemini, or ChatGPT in < 0.5s; short IDs `n_xxxx`, open tasks |
| **Snapshots & Trash** | Supported | Soft deletion with 30-day retention, scoped point-in-time state snapshots, memory-efficient streaming `.zip` export |
| **Bilingual UI** | Supported | Instant English/Russian switching with reactive state persistence in localStorage |
| **Dedicated Hub Mode** | Planned | Headless agent deployment on a VPS as a persistent peer (mesh architecture already supports this) |

---

## 2. Benchmarks

Automated end-to-end and integration benchmarks measured across Vitest and Playwright test suites:
- **1,000 Objects Rendering:** 398 ms initial render time, responsive panning and dragging (~28 fps under 1,000 concurrent canvas nodes).
- **CRDT P2P Sync Latency:** Under 50 ms on local loopback/LAN and < 120 ms over Radmin VPN between distinct peer processes.
- **AI Context Compilation (`doks-ai/1`):** Complete board export with 1,000 nodes, frames, and connected notes executes in under 20 ms.
- **Streaming Vault ZIP Export:** Zero MB memory spike (pure streaming Store-mode pipeline without buffering whole archives in RAM).
- **End-to-End Suite:** All 10 full multi-agent collaborative browser scenarios (including dual-scope cross-promotion, tool auto-return, frame parenting, and workspace mode switcher) pass in ~8.8 seconds.

---

## 3. Known Limitations

- **Platform Focus (v1):** Windows 10/11 and Radmin VPN (`26.0.0.0/8`). Cross-platform support (`doks.sh`) is provided for Linux/macOS, but automatic network adapter probing is optimized for Windows Radmin in version 1.
- **Mobile Support:** Mobile clients (iOS/Android) are not supported in version 1.
- **Peer Discovery:** Auto-discovery works over LAN and Radmin VPN subnets via UDP beacon on port `41234`. Cross-NAT internet connections require manual invite links (`doks://addr1,addr2#teamKey`).
- **Local Agent Process:** Requires running the lightweight local Doks Node.js background agent on each peer machine.

---

## 4. Quickstart

### Prerequisites
- [Node.js 20+](https://nodejs.org/) installed.
- Radmin VPN or virtual LAN network connection.

### Windows 10/11
Run the launch script:
```cmd
doks.bat
```
This automatically verifies dependencies, starts the background agent, and opens your browser at `http://127.0.0.1:3000`.

### Linux / macOS
Run the shell script:
```bash
chmod +x doks.sh
./doks.sh
```

---

## 5. Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Alt+1` | Switch to **Solo Workspace** (private local vault) |
| `Alt+2` | Switch to **Team Workspace** (collaborative mesh) |
| `Ctrl+P` | Command palette |
| `Ctrl+O` | Quick note/board switcher |
| `Ctrl+Shift+F` | Global full-text search |
| `Ctrl+E` | Toggle Live Preview / Markdown editor |
| `Ctrl+Shift+E` | Export board context for AI (`doks-ai/1`) |
| `S` / `N` / `T` / `F` / `C` / `R` / `I` | Board tools: Sticky, Note, Text, Frame, Connector, Shape, Attach |
| `Tab` *(inside sticky)* | Create connected sticky note to the right |
| `Ctrl+Enter` *(inside sticky)* | Create connected sticky note below |
| `Delete` / `Backspace` | Soft-delete selected item to Trash |
| `Ctrl+Z` / `Ctrl+Y` | Undo / Redo actions |

---

## 6. Architecture & Documentation

- [Architecture Overview](docs/architecture.md)
- [Data Formats & Standards](docs/formats.md)
- [Threat Model & Security](docs/threat-model.md)
- [Frequently Asked Questions](docs/faq.md)

---

## 7. License

Distributed under the **Apache License 2.0**.
See [LICENSE](LICENSE) for the full license text.
Third-party component acknowledgements are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
