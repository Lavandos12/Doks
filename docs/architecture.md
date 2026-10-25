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
       │ HTTP / WebSocket
       ▼
[ Local Doks Agent (127.0.0.1:3000) ]
       ├── DocManager & Yjs Store
       ├── Readable Disk Mirror (vault/*.md, vault/boards/*.canvas)
       ├── Blob Storage (.doks/blobs/ & vault/attachments/)
       ├── Local Search Index (MiniSearch)
       └── PeerService (Port 4747 on 26.x.x.x / VPN)
              ▲
              │ P2P WebSocket Mesh (HMAC Handshake)
              ▼
[ Remote Peer Agent (26.x.x.x:4747) ]
```

---

## 3. Communication Protocols

### Local Browser to Agent (`127.0.0.1`)
- **Transport:** HTTP REST endpoints + WebSocket (`/ws`).
- **Security:**
  - Origin verification (`127.0.0.1`, `localhost`).
  - Session cookie (`doks_session`) validation on all API and WebSocket requests.
  - Strict Content Security Policy (CSP) with sandbox for user-uploaded SVG and HTML content.
  - `X-Content-Type-Options: nosniff` header on all responses.

### Peer-to-Peer Agent Mesh (`26.x.x.x:4747`)
- **Handshake Authentication:**
  - Cryptographic HMAC-SHA256 handshake.
  - Shared `teamKey` acts as the pre-shared secret.
  - Challenges are randomized with nonces and verified using `crypto.timingSafeEqual` to prevent timing attacks.
- **Wire Framing:**
  - Frame Type `0`: Sync message (SyncStep1, SyncStep2, Update).
  - Frame Type `1`: Awareness protocol (cursor positions, user profiles, active documents).
  - Frame Type `2`: Binary attachment chunk protocol (256 KB slices with SHA-256 verification).
