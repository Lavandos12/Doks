<div align="center">

  <a href="https://github.com/Lavandos12/Doks">
    <img src="assets/logo.svg" alt="Doks Logo" width="100" height="100" />
  </a>

  <h1>Doks</h1>
  <p><b>Collaborative Workspace & Infinite Canvas</b></p>
  <p><i>The modern, local-first open-source alternative to Miro & Obsidian. Real-time CRDT sync, Markdown vault & 24/7 cloud deployment.</i></p>

  <p align="center">
    <a href="https://github.com/Lavandos12/Doks/actions/workflows/ci.yml">
      <img src="https://img.shields.io/github/actions/workflow/status/Lavandos12/Doks/ci.yml?branch=main&style=for-the-badge&logo=githubactions&logoColor=white&label=CI%20BUILD" alt="CI Status" />
    </a>
    <a href="https://opensource.org/licenses/Apache-2.0">
      <img src="https://img.shields.io/badge/LICENSE-APACHE%202.0-blue?style=for-the-badge&logo=apache&logoColor=white" alt="License" />
    </a>
    <a href="https://nodejs.org/">
      <img src="https://img.shields.io/badge/NODE.JS-%3E%3D20.0-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js" />
    </a>
    <a href="https://hub.docker.com/">
      <img src="https://img.shields.io/badge/DOCKER%20IMAGE-%3C120MB-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker Size" />
    </a>
  </p>

  <p align="center">
    <a href="README.ru.md">📖 <b>Русская версия</b></a> •
    <a href="#-1-click-cloud-deployment">🚀 <b>1-Click Deploy</b></a> •
    <a href="#-quickstart">⚡ <b>Quickstart</b></a> •
    <a href="#1-feature-matrix">✨ <b>Feature Matrix</b></a> •
    <a href="#2-benchmarks">📊 <b>Benchmarks</b></a>
  </p>


</div>

---

## ✨ Feature Highlights

<table>
  <tr>
    <td width="50%">
      <h3>🎨 Miro-Style Infinite Canvas</h3>
      <ul>
        <li><b>60 FPS Pan & Zoom</b>: Silky smooth infinite viewport with dot grid matrix.</li>
        <li><b>Smart Connectors</b>: Magnetic Bézier, orthogonal, and straight lines that follow cards.</li>
        <li><b>Rich Widgets</b>: Color-coded stickies, Checklists, Kanban boards, and Tables.</li>
      </ul>
    </td>
    <td width="50%">
      <h3>📝 Obsidian-Compatible Vault</h3>
      <ul>
        <li><b>Standard Markdown</b>: Bidirectional <code>[[Wikilinks]]</code> and live backlinks.</li>
        <li><b>Split-Screen Workspace</b>: Work simultaneously with Markdown notes and infinite canvas.</li>
        <li><b>Universal Importer</b>: Import <code>.canvas</code>, <code>.md</code>, Word <code>.docx</code>, and <code>.csv</code>.</li>
      </ul>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <h3>⚡ Real-Time CRDT Multiplayer</h3>
      <ul>
        <li><b>Zero Conflicts</b>: State resolution managed by conflict-free replicated data types (Yjs).</li>
        <li><b>Live Awareness</b>: Neon collaborator cursors, selections, and presence indicator.</li>
        <li><b>Dynamic Links</b>: Share collaborative rooms with private <code>/b/:boardId</code> UUIDs.</li>
      </ul>
    </td>
    <td width="50%">
      <h3>☁️ Flexible 24/7 Deployment</h3>
      <ul>
        <li><b>Northflank</b>: Free Sandbox with persistent volume and zero sleeping.</li>
        <li><b>Render + Cloudflare R2</b>: Free compute paired with 10 GB free S3 snapshot storage.</li>
        <li><b>Docker Compose</b>: Self-host on any VPS with a single command.</li>
      </ul>
    </td>
  </tr>
</table>

---

## 🚀 1-Click Cloud Deployment

### Option 1: Northflank (Recommended — Always On + Persistent Disk)

Northflank's free developer Sandbox tier provides an always-on service with a **1 GB persistent volume** without sleep cycles or credit card requirements:

1. Sign up on [Northflank](https://northflank.com/) with your GitHub account.
2. Click **Create Project** $\rightarrow$ **Combined Service**.
3. Select **Build from Git repository** and pick `Lavandos12/Doks`.
4. Under **Ports**, expose port `4780` (HTTP/WebSocket).
5. Under **Volumes**, mount a persistent volume to `/app/data`.
6. Click **Deploy** and get your permanent HTTPS domain!

### Option 2: Render + Cloudflare R2 (Free Hosting + S3 Snapshots)

Deploy on Render's free tier and pair it with Cloudflare R2 for permanent snapshots across sleep cycles:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

1. Deploy the 100% free Docker service on Render via the button above.
2. In the Render Dashboard under **Environment**, add the Cloudflare R2 / AWS S3 credentials:
   - `R2_ENDPOINT`: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
   - `R2_BUCKET`: `doks-vault`
   - `R2_ACCESS_KEY_ID`: `<your_access_key>`
   - `R2_SECRET_ACCESS_KEY`: `<your_secret_key>`
3. Doks automatically restores state from R2 on container startup and synchronizes periodic snapshots.
4. **Local-First Resilience:** In addition to cloud storage, boards are backed up directly in the browser's native IndexedDB (`doks_local_vault`).

---

## ⚡ Quickstart

### Option 1: Docker Compose (Universal & Recommended)

Run Doks anywhere with zero vendor lock-in:

```bash
git clone https://github.com/Lavandos12/Doks.git
cd Doks
docker compose up -d
```

Open `http://localhost:4780` in your web browser. All notes, canvas files, and attachments persist to the `doks_data` volume.

### Option 2: Standalone Production Server

Build the self-contained server bundle:

```bash
# Build standalone protected bundle
npm run pack:release

# Start server
npm start
```

### Option 3: Local Development

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
| **Local-First Architecture** | Supported | 100% offline-resilient with browser IndexedDB (`doks_local_vault`) backing and direct disk persistence to standard `.md` and `.canvas` files |
| **Universal Board Sharing** | Supported | Share boards instantly via `/b/:boardId` links; guests join real-time canvas with zero registration |
| **Real-Time Canvas Collaboration** | Supported | Sticky notes, frames, note cards, connector arrows, shapes, 60 FPS live player cursors via Yjs CRDT |
| **Obsidian-Level Notes** | Supported | CodeMirror 6, Live Preview, callouts (`[!note]`, `[!warning]`), frontmatter properties, outline panel, `[[wikilinks]]` |
| **Phone Bridge** | Supported | High-contrast vector QR code for instant mobile viewing via local Wi-Fi or secure Cloudflare Tunnel |
| **Full-Text Search** | Supported | MiniSearch engine for instantaneous title, body, and hashtag search (`Ctrl+Shift+F`) |
| **AI Context Export (`doks-ai/1`)** | Supported | Deterministic board context generation for Claude, Gemini, and ChatGPT in < 20 ms; short IDs `n_xxxx`, task extraction |
| **Snapshots & Trash** | Supported | Soft deletion with 30-day retention, point-in-time state snapshots, memory-efficient streaming `.zip` export |
| **Container & Cloud Native** | Supported | Multi-stage Docker build (< 120MB), dynamic `$PORT` detection, 1-click Render free-tier & Docker Compose |

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
- **Cloud Persistence & Local-First Resilience:** On ephemeral cloud tiers without mounted persistent volumes, container restarts reset in-memory server state. However, Doks automatically re-hydrates boards from collaborators' browser IndexedDB storage (`doks_local_vault`) upon reconnection.

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

Distributed under the **Apache License 2.0**. See [LICENSE](LICENSE) for details.
