# Changelog

All notable changes to ZotRead are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [SemVer](https://semver.org/).

## [1.0.1] - 2026-08-26

### Fixed

- Annotation creation now actually marks the parent item read (the state
  transition existed but was never wired to the notifier); gated by
  *autoDetectRead* like all automatic detection.
- The *"Show annotation indicator"* preference now has a visible effect:
  when off, annotated items render like read (single green dot).
- Reader-window open detection no longer touches Zotero's private
  `Zotero.Reader._readers`; it reads the reader instance Zotero attaches to
  the window (`window.reader`).
- `updates.json` no longer carries a placeholder checksum: builds are
  deterministic, so `npm run build` syncs the real SHA-256 into the entry
  for the current version, and package verification fails on any mismatch.

### Changed

- Indicator dots resized after feedback: diameter **6.5 px** (from 10 px in
  1.0.0; half of the intermediate 13 px iteration); overlap kept at exactly
  20 % of a dot's diameter (**1.3 px**, center distance 5.2 px, combined
  width 11.7 px). Colors, shape, alignment, labels and tooltips unchanged.

## [1.0.0] - 2026-08-24

### Added

- Reading-status indicators in a dedicated item-tree column:
  - Unread: single red dot (`#E53935`, customizable).
  - Read: single light-green dot (`#66BB6A`, customizable).
  - Read and annotated: overlapping green + yellow pair
    (`#FBC02D`, customizable) with exactly 20 % overlap of one dot's
    diameter (10 px dots, 8 px center distance, 18 px combined width).
- Automatic read detection when an attachment is opened in Zotero's reader
  (tabs fully supported; reader windows best-effort), configurable via
  preferences.
- Annotation detection for reader annotations on all attachments of an item
  (highlight, underline, note, image, ink, text). Existing annotations are
  detected immediately; adding, editing, deleting and syncing updates the
  parent item incrementally.
- Context-menu actions for one or many selected items: Mark as Read,
  Mark as Unread, Refresh Annotation Status (Zotero 10 MenuManager API).
- Local persistence via a plugin-managed table using Zotero's database
  abstraction — survives restarts, no direct SQLite file access, safe for
  read-only/group libraries, keyed by library ID + item key so identical
  keys in different libraries never collide.
- Preferences pane: auto-detection toggle, annotation-dot toggle, custom
  indicator colors.
- Localization: English (en-US) and Brazilian Portuguese (pt-BR).
- Accessibility: accessible names, tooltips, fixed cell footprint (no layout
  shift between states), RTL-aware overlap, dark-theme legibility ring.
- CI (test → build → verify → artifact) and tag-driven release automation
  with SHA-256 checksums and automatic `updates.json` maintenance.
