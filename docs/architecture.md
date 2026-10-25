# Doks Architecture Overview

Doks is a peer-to-peer, local-first collaborative workspace designed for small teams (up to 4–8 peers). It unites Obsidian-style Markdown notes with bidirectional `[[wikilinks]]` and Miro-style infinite boards with JSON Canvas support.

---

## 1. Core Principles

1. **Local-First & Offline Resilience:**
   - Every peer maintains an identical, complete copy of all documents and metadata.
   - The user interface connects exclusively to the local agent running on `127.0.0.1`.
   - Edits can be performed entirely offline; reconnecting automatically reconciles state vectors without data loss.

2. **Decentralized Multi-Master Mesh:**
   - There is no central database or mandatory cloud server.
   - Agents establish direct mutual WebSocket connections over a private virtual network (such as Radmin VPN `26.0.0.0/8` or local LAN).
   - Mesh relay ensures that if Agent A connects to B, and B connects to C, updates made by A automatically propagate to C through B.

3. **Readable Disk Mirroring:**
   - State is persisted as standard human-readable `.md` notes and `.canvas` files inside the `vault/` directory.
   - Binary Yjs state vectors are safely stored in `.doks/state/`.
   - External file edits (e.g. from Obsidian, VS Code, or Git) are monitored via `chokidar` and automatically parsed back into the Yjs CRDT model.

---

## 2. Process Architecture

```
[ Browser Client ]
       │ HTTP / WebSocket (127.0.0.1:3000)
       ▼
[ Local Doks Agent ]
       ├── DocManager & Dual Scopes
       │     ├── Solo Scope (100% Private, Local Only)
       │     └── Team Scope (Collaborative Mesh Synced)
       ├── Cross-Scope Bridge (/api/bridge/transfer)
       ├── Readable Disk Mirror (vault/*.md, vault/boards/*.canvas)
       ├── Blob Storage (.doks/blobs/ & vault/attachments/)
       ├── Local Search Index (MiniSearch)
       └── PeerService (Port 4747 on 26.x.x.x / LAN)
              ├── UDP Beacon Discovery (Port 41234)
              ├── Ed25519 Identity Handshake
              ├── AEAD AES-256-GCM Encrypted Transport
              └── Dual-Queue Backpressure Prioritization
                     ▲
                     │ P2P Encrypted Mesh
                     ▼
[ Remote Peer Agent (26.x.x.x:4747) ]
```

---

## 3. Two-Tier Workspace Architecture (`solo` vs `team`)

Doks enforces a clean, deterministic separation between personal private thoughts and team collaboration:

### 3.1. Scope Isolation Model
- **Solo Scope (`solo`):**
  - Stored locally under `vault/solo/` and document identifiers prefix `solo:*` (e.g., `solo:doks-index`, `solo:doks-board-main`, `solo:doks-note-...`).
  - **Hard Network Barrier:** In `DocManager`, `assertNotSoloForPeer(docName)` guarantees that solo documents cannot be accessed by remote peers. In `PeerService`, all outbound sync and relay messages for `solo` documents are dropped immediately, and inbound requests targeting `solo` documents are rejected.
  - Active presence in Solo mode emits no cursor or state vectors across the network.
- **Team Scope (`team`):**
  - Stored under standard `vault/` paths and document identifiers prefix `team:*` (e.g., `team:doks-index`, `team:doks-board-main`, `team:doks-note-...`).
  - Synced in real-time across all connected peers in the mesh.

### 3.2. Cross-Scope Bridge (`POST /api/bridge/transfer`)
Users can seamlessly promote local draft notes/cards into the team workspace or fork shared team boards into their personal vault:
1. **Deep Node Cloning:** Clones selected canvas cards, stickies, text nodes, and shapes.
2. **Connector Remapping:** Edge connectors between selected nodes are preserved and mapped to the newly generated node IDs.
3. **Linked Note Migration:** Referenced Markdown notes are read from the source scope, cloned into the target scope with fresh IDs, and title wikilinks are preserved.
4. **Visual Grouping:** Imported nodes are grouped inside a dedicated framing box (e.g. `"📦 Promoted from Solo (YYYY-MM-DD)"`).

---

## 4. Communication Protocols & P2P Layer

### Local Browser to Agent (`127.0.0.1`)
- **Transport:** HTTP REST endpoints + WebSocket (`/ws`).
- **Security:**
  - Strict `new URL(origin)` parsing validating against `127.0.0.1`, `localhost`, and configured bind IP/port.
  - Session cookie (`doks_session`) and `X-Doks-Token` header validation on all API endpoints and WebSocket upgrades.
  - Strict Content Security Policy (CSP) with sandbox for user-uploaded SVG and HTML content.
  - `X-Content-Type-Options: nosniff` header on all responses.

### Peer-to-Peer Agent Mesh (`26.x.x.x:4747`)
- **Node Identities & Authentication:**
  - Persistent Ed25519 keypair per agent stored in `.doks/node-identity.json`.
  - Node ID derived as `Base58(SHA256(PublicKey))`.
  - Cryptographic challenge-response handshake signed with Ed25519 and verified with pre-shared `teamKey`.
- **Wire Framing & AEAD Encryption (AES-256-GCM):**
  - Symmetrically derived traffic keys using HKDF-SHA256 from `teamKey` and sorted peer nonces: `[localNonce, remoteNonce].sort().join(':')`.
  - Wire Frame format:
    - 4 bytes magic: `DOKS`
    - 1 byte frame type: `0` (Sync), `1` (Awareness), `2` (Blob chunk)
    - 12 bytes monotonic initialization vector (nonce)
    - 16 bytes GCM authentication tag
    - Variable length encrypted ciphertext payload
- **UDP Auto-Discovery Beacon:**
  - Listens on UDP port `41234` broadcasting beacons across LAN and Radmin VPN (`26.0.0.0/8`).
  - Contains `workspaceHash` (`sha256(teamKey).slice(0, 16)`), `peerId`, and peer port.
  - Automatic connection deduplication prevents reconnection loops when peers are reachable via multiple interfaces.
- **Dual-Queue Backpressure Prioritization:**
  - Real-time priority queue for interactive CRDT updates and Awareness cursor positions.
  - Bulk queue for chunked binary attachments (256 KB slices) paused when socket buffer exceeds 256 KB.
