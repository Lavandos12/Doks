<p align="center">
  <a href="https://github.com/Lavandos12/Doks">
    <img src="assets/logo.svg" alt="Doks Logo" width="104" height="104">
  </a>
</p>

<h1 align="center">Doks</h1>

<p align="center">
  <strong>Collaborative Workspace & Infinite Canvas</strong><br>
  <em>Local-first Markdown notes & Miro-style whiteboard canvas powered by Yjs CRDT real-time sync.</em>
</p>

<p align="center">
  <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-%3E%3D20.0.0-green.svg" alt="Node.js"></a>
  <a href="tests"><img src="https://img.shields.io/badge/Tests-235%20passed-brightgreen.svg" alt="Tests"></a>
  <a href="Dockerfile"><img src="https://img.shields.io/badge/Docker%20Size-%3C120MB-blue.svg" alt="Docker Size"></a>
</p>

<p align="center">
  <a href="README.ru.md">📖 Русская версия</a> •
  <a href="#1-click-cloud-deployment">1-Click Deploy</a> •
  <a href="#quickstart">Quickstart</a> •
  <a href="#1-feature-matrix">Features</a> •
  <a href="#6-architecture--documentation">Architecture</a>
</p>

---

**Doks** is an open-source, local-first collaborative workspace combining Obsidian-compatible Markdown notes and Miro-style infinite canvas whiteboards. Powered by **Yjs** CRDT synchronization, Doks enables real-time collaborative editing, 60 FPS live player cursors, and zero-friction URL sharing (`/b/:boardId`) across local networks, Docker containers, and cloud deployments.

---

## 🚀 24/7 Cloud Deployment (Free & Self-Hostable)

### Option 1: Deploy to Northflank (Free, No Credit Card Required)

Deploy Doks to the cloud with 24/7 uptime, persistent storage, and WebSockets:

1. Sign up on [Northflank](https://northflank.com) with your GitHub account.
2. Click **Create Project** $\rightarrow$ **Combined Service**.
3. Select **Build from Git repository** and pick `Lavandos12/Doks`.
4. Under **Ports**, expose port `4780` (HTTP/WebSocket).
5. Under **Volumes**, mount a persistent volume to `/app/data`.
6. Click **Deploy** and get your permanent HTTPS domain!

> **Universal Cloud & PaaS Support:** While Northflank offers an instant free tier with persistent storage volumes, Doks is 100% container-native. You can deploy it seamlessly on any modern cloud platform or PaaS host (Zeabur, Coolify, Fly.io, CapRover, DigitalOcean, Hetzner, AWS, or any Linux VPS running Docker).

### Option 2: Self-Host with Docker Compose (Universal)

Run Doks anywhere with zero vendor lock-in:

```bash
git clone https://github.com/Lavandos12/Doks.git
cd Doks
docker compose up -d
```

Open `http://localhost:4780` in your web browser. All notes, canvas files, and attachments persist to the `doks_data` volume.

### Option 3: Standalone Production Server

Build the self-contained server bundle:

```bash
# Build standalone protected bundle
npm run pack:release

# Start server
npm start
```

### Option 4: Local Development

```bash
# Install dependencies
npm install

# Start development servers
npm run dev
```

---

## 1. Feature Matrix

| Feature | Status | Description |
|---|---|---|
| **Local-First Architecture** | Supported | 100% offline-resilient, connects to `127.0.0.1` or cloud host, direct disk persistence to standard `.md` and `.canvas` files |
| **Universal Board Sharing** | Supported | Share boards instantly via `/b/:boardId` links; guests join real-time canvas with zero registration |
| **Real-Time Canvas Collaboration** | Supported | Sticky notes, frames, note cards, connector arrows, shapes, 60 FPS live player cursors via Yjs CRDT |
| **Obsidian-Level Notes** | Supported | CodeMirror 6, Live Preview, callouts (`[!note]`, `[!warning]`), frontmatter properties, outline panel, `[[wikilinks]]` |
| **Phone Bridge** | Supported | High-contrast vector QR code for instant mobile viewing via local Wi-Fi or secure Cloudflare Tunnel |
| **Full-Text Search** | Supported | MiniSearch engine for instantaneous title, body, and hashtag search (`Ctrl+Shift+F`) |
| **AI Context Export (`doks-ai/1`)** | Supported | Deterministic board context generation for Claude, Gemini, and ChatGPT in < 20 ms; short IDs `n_xxxx`, task extraction |
| **Snapshots & Trash** | Supported | Soft deletion with 30-day retention, point-in-time state snapshots, memory-efficient streaming `.zip` export |
| **Container & Cloud Native** | Supported | Multi-stage Docker build (< 120MB), dynamic `$PORT` detection, 1-click Northflank / Docker Compose templates |

---

## 2. Benchmarks

Automated end-to-end and integration benchmarks measured across Vitest and Playwright test suites:

- **1,000 Objects Rendering:** 398 ms initial render time, responsive panning and dragging (~28 fps under 1,000 concurrent canvas nodes).
- **CRDT Synchronization Latency:** Under 50 ms on local loopback/LAN between distinct collaborative clients.
- **AI Context Compilation (`doks-ai/1`):** Complete board export with 1,000 nodes, frames, and connected notes executes in under 20 ms.
- **Streaming Vault ZIP Export:** Zero MB memory spike (pure streaming Store-mode pipeline without buffering whole archives in RAM).
- **End-to-End Suite:** All full multi-agent collaborative browser scenarios pass in ~8.8 seconds.

---

## 3. Known Limitations

- **Desktop Scripts (`doks.bat` / `doks.sh`):** Previous versions used local shell launch scripts `doks.bat` and `doks.sh`. Doks has transitioned to modern, platform-agnostic cloud standards using Docker and `npm start`.
- **Peer Discovery:** Auto-discovery works over LAN subnets via UDP beacon on port `41234`. Cross-network connections utilize universal URL sharing (`/b/:boardId`) or the Phone Bridge.
- **Cloud Persistence:** When deploying on ephemeral cloud providers without mounted persistent volumes, boards reset on container restarts. Always configure persistent storage (such as Northflank Volumes, Docker volumes, or any persistent cloud disk).

---

## 4. Configuration & Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4780` | Port for the HTTP and WebSocket server (dynamically overridden by cloud environments) |
| `DOKS_HOST` | `0.0.0.0` | Network host address to bind (`0.0.0.0` for Docker/cloud, `127.0.0.1` for loopback only) |
| `DOKS_DATA_DIR` | `./data` | Directory path where Markdown notes, boards, and attachments are stored |
| `WORKSPACE_PASSWORD` | *(none)* | Optional team passphrase for board write access |

---

## 5. Keyboard Shortcuts

| Shortcut | Action |
|---|---|
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
