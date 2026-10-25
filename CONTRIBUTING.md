# Contributing to Doks

Thank you for your interest in contributing to Doks! Doks is a decentralized, local-first workspace built with TypeScript, Yjs, Preact, Fastify, and CodeMirror.

---

## Development Setup

1. **Prerequisites:**
   - Node.js 20 or higher
   - npm 10 or higher

2. **Clone and Install:**
   ```bash
   git clone https://github.com/doks-app/doks.git
   cd doks
   npm install
   ```

3. **Running in Development:**
   ```bash
   npm run dev
   ```

4. **Running Quality Checks:**
   Always run the complete verification check before committing or opening a PR:
   ```bash
   npm run check
   ```
   This runs:
   - TypeScript typechecking across all packages (`shared`, `agent`, `web`, `tests`).
   - Vitest unit and integration suites.
   - Vite and agent builds.

5. **End-to-End Tests:**
   ```bash
   npx playwright test
   ```

---

## Coding Standards

- **Local-first rule:** Never add remote telemetry, analytics, fonts, or CDN dependencies. All assets must bundle locally.
- **TDD:** Write failing tests first before modifying business logic or fixing bugs.
- **Commit style:** Conventional Commits (`feat(...)`, `fix(...)`, `refactor(...)`, `docs(...)`, `test(...)`).
