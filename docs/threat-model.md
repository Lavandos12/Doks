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
  - Strict `Origin` and `Host` header checks reject all requests whose origin does not match `127.0.0.1` or `localhost`.
  - Cryptographic session cookie (`doks_session`) is issued on index load and required for all subsequent API endpoints and WebSocket upgrades.

### 2.2. Malicious File Attachments (SVG Stored XSS)
- **Threat:** An attacker uploads a crafted SVG or HTML file containing `<script>` tags, which executes JavaScript in the context of `127.0.0.1:3000` when viewed.
- **Mitigation:**
  - Content Security Policy (CSP): `sandbox allow-scripts=none; default-src 'none'`.
  - Headers: `X-Content-Type-Options: nosniff`.
  - Content-Disposition: `attachment; filename="..."` forced on sensitive MIME types.

### 2.3. Unauthorized Peer Injection & Mesh Tampering
- **Threat:** An unauthorized node in the same Radmin VPN subnet attempts to connect to agent port `4747` and inject forged CRDT updates.
- **Mitigation:**
  - Mutual HMAC-SHA256 handshake. Both sides challenge each other with random nonces signed by `teamKey`.
  - Constant-time verification (`crypto.timingSafeEqual`) prevents timing oracle attacks.
  - Nodes failing the handshake are immediately terminated and banned from sync.

### 2.4. Path Traversal & Filename Sanitization
- **Threat:** Document titles containing `../`, null bytes, or Windows reserved names (`CON`, `PRN`, `AUX`, `NUL`) attempt to escape the `vault/` directory.
- **Mitigation:**
  - All filenames are sanitized with Windows safe character rules.
  - Paths are strictly resolved and asserted to remain within `path.resolve(vaultDir)`.
