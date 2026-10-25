# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-10-25

### Changed
- **Unified Branding:** Renamed internal identifiers, files, and directories from `Eluma` to `Doks`.
- **Default Directories:** Data directory is now `~/Doks` with internal state at `.doks`.
- **Migration System:** Added automatic schema v3 migration from `~/Eluma` / `.eluma` to `~/Doks` / `.doks` while preserving `backup-v1`.
- **Neutral Templates:** Replaced specific roadmap with neutral template seeds (Roadmap, Kanban, Retro) and neutral authors (Alice, Bob, Charlie).
- **Dead Code Removal:** Removed `Doks.lnk` and cleaned up unused timers in `StateStore`.
- **Structured Logging:** Replaced raw `console.log` calls with configurable leveled `logger` (`DOKS_LOG=info|debug`).
- **Version Alignment:** Standardized version `0.2.0` across all package manifests.
