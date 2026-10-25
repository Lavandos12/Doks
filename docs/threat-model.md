# Doks Threat Model & Security Architecture

Doks operates as a local-first application where each user runs a local agent communicating both with the user's browser and with trusted peers over a VPN network (such as Radmin VPN).

---

## 1. Trust Boundaries

```
[ Untrusted Web / Public Internet ]
                 │ (Blocked / No External Network Calls)
                 ▼
[ Browser Session (Origin: 127.0.0.1:3000) ]
                 │ (Session Cookie + Origin Validation)
                 ▼
[ Local Agent Process ] ─── (Filesystem ACLs) ───► [ Local Vault / Disk ]
                 │ (HMAC-SHA256 Handshake + Pre-shared Team Key)
                 ▼
[ P2P Mesh (Radmin VPN 26.0.0.0/8) ]
```

---

## 2. Threat Scenarios & Mitigations

### 2.1. DNS Rebinding & Cross-Origin Requests
- **Threat:** A malicious website visited in the user's browser attempts to query `http://127.0.0.1:3000/api` or establish a WebSocket connection to exfiltrate vault notes.
- **Mitigation:**
  - Strict `new URL(origin)` parsing rejects all requests where the origin host does not strictly match `127.0.0.1`, `localhost`, or the configured bind IP, or where the port does not match the configured HTTP port.
  - Cryptographic session cookie (`doks_session`) and `X-Doks-Token` header are required for all mutating API endpoints and WebSocket upgrades.

### 2.2. Malicious File Attachments (Stored XSS)
- **Threat:** An attacker uploads a crafted SVG, XML, or HTML file containing `<script>` tags, which executes JavaScript in the context of `127.0.0.1:3000` when viewed.
- **Mitigation:**
  - Content Security Policy (CSP): `sandbox; default-src 'none'; style-src 'unsafe-inline'`.
  - Headers: `X-Content-Type-Options: nosniff`.
  - Content-Disposition: `attachment; filename="..."` forced on `.svg`, `.html`, `.xml`, and executable file types.
  - Disk storage uses collision-free sanitized names `<sanitized-name>-<hash8>.<ext>` to avoid path collisions or escaping.

### 2.3. Unauthorized Peer Injection & Wire Eavesdropping
- **Threat:** An unauthorized node in the VPN subnet attempts to connect to agent port `4747` to eavesdrop or inject forged CRDT updates.
- **Mitigation:**
  - Persistent Ed25519 identity keypairs per node (`.doks/node-identity.json`).
  - Cryptographic challenge-response handshake signed with Ed25519 and authenticated against pre-shared `teamKey`.
  - Full AEAD wire encryption using AES-256-GCM with HKDF-SHA256 derived traffic keys.
  - 12-byte monotonic nonces and 16-byte authentication tags reject replay attacks and unauthorized message tampering.
  - Nodes failing the handshake are immediately terminated and banned from sync.

### 2.4. Path Traversal & Filename Sanitization
- **Threat:** Document titles containing `../`, null bytes, or Windows reserved names (`CON`, `PRN`, `AUX`, `NUL`) attempt to escape the `vault/` directory.
- **Mitigation:**
  - All filenames are sanitized with Windows safe character rules.
  - Paths are strictly resolved and asserted to remain within `path.resolve(vaultDir)`.

### 2.5. Personal Data Leakage across Network (Solo Scope Isolation)
- **Threat:** Private notes or draft canvas stickies created in the personal workspace are inadvertently broadcast to remote peers.
- **Mitigation:**
  - Hard network barrier in `DocManager` via `assertNotSoloForPeer(docName)`.
  - Outbound filter in `PeerService.broadcastUpdate` and `relayMessage` drops any update containing the `solo:` prefix.
  - Inbound request filter rejects sync subscriptions for `solo` documents with zero leakage.
