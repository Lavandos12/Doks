# Frequently Asked Questions (FAQ)

### 1. Does Doks require an internet connection or central server?
No. Doks is strictly local-first and decentralized. It runs entirely on your local machine (`127.0.0.1`). When collaborating with team members, it communicates peer-to-peer over your virtual network (such as Radmin VPN, Tailscale, or local LAN). No data ever leaves your machines or touches external clouds.

---

### 2. Can I use my notes with Obsidian?
Yes! All your notes are mirrored as standard `.md` Markdown files in `%USERPROFILE%\Doks\vault\`. Boards are saved in the open `.canvas` format (JSON Canvas 1.0). You can open the `vault` folder directly in Obsidian, and any edits you make externally in Obsidian will automatically sync into Doks within seconds.

---

### 3. What happens if two people edit the same sticky note or document while offline?
Doks uses **Yjs CRDT** (Conflict-free Replicated Data Type) algorithms:
- **Text edits:** Merged character-by-character mathematically without losing either person's text.
- **Node properties:** Last-write-wins based on logical Lamport clocks.
- **Simultaneous creation:** Both objects are preserved side by side.
- **Deletions:** Items are moved to the recoverable Trash for 30 days.

---

### 4. How do I invite a teammate to join my workspace?
1. Open Doks and click on the **Network** icon in the sidebar (or status bar).
2. Copy the **Invite Link** (formatted like `doks://26.x.x.x:4747#your-team-key`).
3. Send this link to your teammate. When they enter the IP and team key in their Network screen, the agents will establish an encrypted P2P link and synchronize all documents.

---

### 5. What are the system requirements?
- **Operating System:** Windows 10/11 (fully supported), Linux / macOS (via `doks.sh`).
- **Runtime:** Node.js 20 or higher.
- **VPN:** Radmin VPN, ZeroTier, Tailscale, or direct LAN IP addresses.
