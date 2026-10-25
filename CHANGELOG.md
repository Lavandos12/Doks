# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-10-25

### Added
- **Two-Tier Workspace Scope (`solo` vs `team`):**
  - **Solo Scope (`solo`):** Completely private local workspace with zero network transmission, stored in `vault/solo/` and scoped docs (`solo:*`).
  - **Team Scope (`team`):** Collaborative workspace synchronized in real-time across the P2P mesh, stored in `vault/` and scoped docs (`team:*`).
  - **Cross-Scope Promotion & Fork Bridge:** Single-click "Promote to Team" and "Fork to Solo" (`POST /api/bridge/transfer`) with deep canvas node cloning, automatic linked note cloning, enclosing frame generation, and connector endpoint remapping.
  - Quick scope switcher in tab bar with `Alt+1` (Solo, amber) and `Alt+2` (Team, cyan) keyboard shortcuts.
- **True P2P Decentralization & Transport Encryption:**
  - **Ed25519 Node Identities:** Automatic cryptographic keypair generation in `.doks/node-identity.json` with Base58 node IDs.
  - **AEAD AES-256-GCM Transport:** Monotonic 12-byte nonces, 16-byte authentication tags, and HKDF-SHA256 session key derivation with sorted symmetric nonces.
  - **UDP Auto-Discovery Beacon:** Broadcast discovery on port 41234 across local LAN and Radmin VPN (`26.0.0.0/8`) with team workspace hash filtering and deduplication.
  - **Dual-Queue Backpressure Prioritization:** Separated queues for real-time CRDT/Awareness updates vs bulk binary attachments with a 256 KB threshold.
- **Core Security & File Hardening:**
  - Strict `new URL(origin)` validation against allowed loopback and configured bind interfaces.
  - `X-Doks-Token` and HTTP-only session cookie enforcement on all mutating API endpoints and WebSocket upgrades.
  - Attachment security: CSP sandbox, `nosniff`, and forced attachment download on SVG, XML, HTML, and executables.
  - Human-readable Obsidian attachment filenames (`<sanitized-name>-<hash8>.<ext>`) with metadata indexing.
  - Granular Y.Text character diffing (`applyStringDiffToYText`) to eliminate concurrent text overwrites on sticky notes.
  - FileWatcher loopback prevention via in-memory SHA-256 cache and 150ms event coalescing.

## [0.2.0] - 2026-10-25

### Changed
- **Unified Branding:** Renamed internal identifiers, files, and directories from `Eluma` to `Doks`.
- **Default Directories:** Data directory is now `~/Doks` with internal state at `.doks`.
- **Migration System:** Added automatic schema v3 migration from `~/Eluma` / `.eluma` to `~/Doks` / `.doks` while preserving `backup-v1`.
- **Neutral Templates:** Replaced specific roadmap with neutral template seeds (Roadmap, Kanban, Retro) and neutral authors (Alice, Bob, Charlie).
- **Dead Code Removal:** Removed `Doks.lnk` and cleaned up unused timers in `StateStore`.
- **Structured Logging:** Replaced raw `console.log` calls with configurable leveled `logger` (`DOKS_LOG=info|debug`).
- **Version Alignment:** Standardized version `0.2.0` across all package manifests.
