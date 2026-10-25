# Transport Architecture Spike: Hyperswarm & WebRTC for Doks v3

## 1. Context & Motivation

In Doks v1 and v2, networking uses direct WebSockets over a virtual private network (Radmin VPN `26.x.x.x`). While this setup guarantees complete isolation and zero external dependencies, it requires teammates to manually copy-paste IP addresses or install a specific VPN client.

For **Doks v3**, the goal is zero-configuration peer discovery across arbitrary networks (behind home routers and cellular NATs) while preserving our core principles:
1. No mandatory central server storing data or metadata.
2. End-to-end encryption authenticated by the team key.
3. Transport layer modularity (pluggable via the `Transport` interface defined in `@doks/shared`).

---

## 2. Candidate 1: Hyperswarm (Holepunch / Keet)

### 2.1. How It Works
- **Discovery Mechanism:** Distributed Hash Table (DHT) built on Kademlia. Peers join a 32-byte topic derived from `crypto.createHash('sha256').update(teamKey).digest()`.
- **NAT Traversal:** Built-in UDP hole punching using Hyperswarm's UTP stack. If direct UDP hole punching fails, it falls back to TCP or blind relays.
- **Connection Model:** Once hole-punched, it exposes standard Node.js duplex streams (`stream`).

### 2.2. Pros
- **Zero Configuration:** Users only need the team key; discovery happens automatically across the global DHT.
- **Serverless:** No STUN, TURN, or signaling servers required.
- **Battle-tested:** Powers Holepunch, Keet, and Hypercore with millions of P2P transfers.
- **Direct Fit:** Fits naturally into the Node.js background agent architecture.

### 2.3. Cons & Risks
- Relies on native C++ addons (`udx-native`) which complicates cross-platform compilation and packaging into single-binary executables (`pkg` / Node SEA).
- DHT announcements on public DHT reveal topic hashes (mitigated by hashing the team key).

---

## 3. Candidate 2: WebRTC DataChannels

### 3.1. How It Works
- **Connection Model:** Peer-to-peer data channels over SCTP/DTLS/UDP.
- **Signaling Requirement:** Requires an exchange of SDP offers, answers, and ICE candidates before the direct connection is established.
- **Signaling Options:**
  1. A tiny stateless signaling relay (or Matrix / Nostr relays).
  2. Manual copy-paste SDP tokens (clunky for 4+ users).
  3. DHT-based ephemeral signaling (e.g. via Hyperswarm DHT).

### 3.2. Pros
- Native browser support without requiring a local Node.js agent if Doks ever offers an in-browser-only mode.
- Standardized encryption via DTLS.

### 3.3. Cons & Risks
- Without a TURN server, symmetric NATs (common on cellular hotspots and enterprise Wi-Fi) fail to connect ~15–20% of the time.
- Still requires a signaling path to bootstrap the connection.

---

## 4. Recommendation for Doks v3

### Hybrid Strategy:
1. **Default Transport for v3:** Implement `HyperswarmTransport` implementing the `Transport` interface. It eliminates the need for Radmin VPN and manual IP entry while keeping the system 100% serverless.
2. **Fallback Transport:** Retain `DirectWsTransport` for offline LAN environments, air-gapped secure setups, or testing environments.
3. **Optional Hub:** When a VPS is configured in `config.peers`, it acts as an always-online peer and high-bandwidth relay for peers with restrictive corporate firewalls.
