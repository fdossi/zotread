# ZotRead

**Reading-status indicators for Zotero 10.** ZotRead shows, at a glance, whether a bibliographic item is unread, read, or read and annotated.

| Status | Indicator |
| --- | --- |
| Unread | ● red dot (`#E53935` by default) |
| Read | ● light-green dot (`#66BB6A`) |
| Read + annotated | ●● overlapping green + yellow dots (`#FBC02D`), 20 % overlap |

New references appear **unread automatically**. Opening an attachment in Zotero's reader marks its parent item **read**. Creating or keeping reader annotations adds the **yellow annotation dot** on top of the green one.

- **Requirements:** Zotero 10 (`strict_max_version: 10.0.*`)
- **License:** MIT
- **Repository:** <https://github.com/fdossi/zotread>

---

## Contents

1. [Features](#features)
2. [Indicator legend](#indicator-legend)
3. [Installation](#installation)
4. [Showing / positioning the status column](#showing--positioning-the-status-column)
5. [Automatic read detection](#automatic-read-detection)
6. [Manual read/unread actions](#manual-readunread-actions)
7. [Annotation indicators](#annotation-indicators)
8. [Persistence & synchronization](#persistence--synchronization)
9. [Privacy](#privacy)
10. [Preferences](#preferences)
11. [Limitations](#limitations)
12. [Development setup](#development-setup)
13. [Building](#building)
14. [Testing](#testing)
15. [Releasing](#releasing)
16. [Troubleshooting](#troubleshooting)
17. [References](#references)

---

## Features

- Compact reading-status indicator for every regular bibliographic item.
- Fully automatic state detection plus manual control via the item context menu.
- Multi-select aware: mark any number of items read/unread in one action.
- Efficient incremental updates — no full-library scans; only affected rows repaint.
- Works across My Library and group libraries; respects read-only libraries (your local reading progress can still be recorded).
- Localized in English (en-US) and Brazilian Portuguese (pt-BR); RTL-aware rendering.
- Accessible: text labels via tooltips and accessible names — color is never the only signal.

## Indicator legend

| Dots | Meaning | Sort value |
| --- | --- | --- |
| 🔴 one red | Unread | 0 |
| 🟢 one green | Read | 1 |
| 🟢🟡 green + overlapping yellow | Read with annotations | 2 |

The two-dot state overlaps by exactly **20 % of one dot's diameter**: 6.5 px dots whose centers are 5.2 px apart (1.3 px overlap), for a combined width of 11.7 px. The green dot comes first, the yellow second, and a subtle inset ring keeps both legible on light *and* dark themes.

## Installation

1. Download the latest `zotread-<version>.xpi` from [GitHub Releases](https://github.com/fdossi/zotread/releases).
2. Open Zotero 10.
3. Open **Tools → Plugins** (the Add-ons Manager).
4. Open the gear menu → **Install Plugin From File…**
5. Select the downloaded `.xpi`.
6. A restart is not normally required.
7. Show/position the **Reading status** column as described below.

## Showing / positioning the status column

Zotero 10 has no supported row-decoration hook that draws content to the left of the title, so ZotRead registers a dedicated narrow custom column through the official `Zotero.ItemTreeManager.registerColumn()` API.

- After installation the **Reading status** column appears automatically as the **first (leftmost)** column in the items list. Zotero stores column order per profile in `treePrefs.json` as each column's `ordinal`; on a fresh install ZotRead writes `ordinal: -1` for its data key so it sorts leftmost. You can still drag it anywhere, hide it, or resize it — once you change its position, your choice is saved and ZotRead will never move it again (it only acts when no position has been recorded yet).
- If you ever hide the column, re-enable it from the column picker (**View → Columns**, or the ☰ button at the top-right of the items list) under *More Columns*.
- The column supports sorting: ascending order groups unread → read → read+annotated.

## Automatic read detection

An item is marked read when **its attachment is opened in Zotero's built-in reader**:

- Opening a PDF/EPUB/snapshot attachment from an item's attachments (reader tabs) marks the parent bibliographic item read.
- Re-opening or switching back to an already-open reader tab also counts.
- Attachments opened in separate reader windows are detected best-effort (see [Limitations](#limitations)).
- Standalone (parentless) attachments record their own read state internally.
- Annotation creation (e.g., making a highlight) marks the parent read *and* annotated.
- Automatic detection (opening *and* annotation creation) is governed by the *"Mark items as read when opened in the reader"* preference; manual actions always work.

What does **not** mark an item read: selecting it, viewing metadata, inspecting attachment details, syncing, or any background access.

> **Honest scope:** "opened" means exactly that. ZotRead cannot verify that you actually read the content — no scroll or attention tracking exists.

Detection can be turned off in Preferences (*"Mark items as read when opened in the reader"*).

## Manual read/unread actions

Right-click one or more selected items:

- **Mark as Read**
- **Mark as Unread**
- **Refresh Annotation Status** — recomputes annotation presence for the selection (useful after bulk operations).

Actions apply to all eligible (regular) items in the selection and are disabled when none are eligible. Child notes, attachments and annotation rows are ignored.

**Unread-with-annotations policy:** marking an annotated item *unread* hides the yellow dot while the item remains explicitly unread (red dot wins). Your annotations are untouched; opening the item again restores the green + yellow pair.

## Annotation indicators

The yellow dot appears when a **read** item has qualifying reader annotations on *any* of its file attachments:

- Qualifying types: highlight, underline, note (reader margin notes), image, ink, text.
- **Standalone child notes attached directly to the item do not count.** This is a deliberate, documented choice: they are writing, not evidence of reading.
- Annotations that existed before you installed ZotRead are detected immediately (presence is computed live from library data).
- Adding, editing, deleting, restoring (undo) or syncing annotations updates the correct parent item incrementally, with debounced batching during import/sync bursts.
- Deleting the last qualifying annotation removes the yellow dot but preserves the read state.
- Multiple attachments of the same item are aggregated — a highlight in any of them lights the dot.

## Persistence & synchronization

State is stored in a plugin-managed table inside Zotero's local database, accessed **only** through Zotero's official database abstraction (`Zotero.DB`). ZotRead never opens `zotero.sqlite` directly and never modifies bibliographic fields or your tags.

- ✅ Status survives restarts.
- ✅ Items are identified by *library ID + item key*, so identical keys in different libraries cannot collide.
- ✅ Works in group libraries and read-only libraries (state is plugin-local, so recording reading progress needs no edit permission on the items themselves).
- ❌ **Status does not sync across devices.** It is intentionally local: synchronized tags would pollute your tag namespace, and there is no supported sync channel for plugin tables today. If you need matching status on another machine, use the context-menu actions there (or copy the table — see Troubleshooting).
- Permanently deleted items are purged from the table automatically.

## Privacy

ZotRead performs no network requests. All data stays in your Zotero profile. It collects nothing, phones home nothing, and the update check uses Zotero's own plugin-update mechanism against this repository's `updates.json`.

## Preferences

Tools → Settings → **ZotRead** (sidebar entry):

| Preference | Default | Effect |
| --- | --- | --- |
| Mark items as read when opened in the reader | on | Enables automatic read detection |
| Show annotation indicator | on | Toggles the yellow dot globally |
| Unread color | `#E53935` | Red dot fill |
| Read color | `#66BB6A` | Green dot fill |
| Annotation dot color | `#FBC02D` | Yellow dot fill |

Color changes repaint visible rows immediately.

## Limitations

- **Reader windows:** attachments opened in standalone reader windows (not tabs) are detected best-effort via window watching; if resolution fails, the open simply isn't counted. Reader *tabs* are fully reliable.
- "Opened ≠ read": see [Automatic read detection](#automatic-read-detection).
- No cross-device synchronization of status.
- The column is placed leftmost automatically on a fresh install (via `treePrefs.json` ordinal); once you reposition or hide it, that choice is respected and never overridden.
- Zotero 10 only — older versions are not targeted.
- Interactive verification was performed against Zotero 10 documentation and source code; automated coverage uses mocked Zotero APIs (see Testing). Please report runtime issues on the tracker.

## Development setup

```bash
git clone https://github.com/fdossi/zotread.git
cd zotread
npm install        # no runtime dependencies; tooling is Node stdlib
npm test
```

Source layout:

```
addon/
├── manifest.json          # Zotero 10 manifest
├── bootstrap.js           # lifecycle entry point
├── prefs.js               # default preferences
├── content/
│   ├── zotread.js         # namespace, lifecycle, business operations
│   ├── state.js           # pure state model (unit-tested as shipped)
│   ├── storage.js         # Zotero.DB-backed persistence (+ memory backend)
│   ├── annotations.js     # annotation aggregation & invalidation
│   ├── reader.js          # reader-open detection (tabs + windows)
│   ├── notifier.js        # batched incremental updates
│   ├── column.js          # custom column & dot renderer
│   ├── menu.js            # MenuManager context menu
│   ├── preferences.xhtml  # prefs pane fragment
│   ├── preferences.js     # prefs wiring
│   └── styles.css         # indicator geometry/layout
├── locale/{en-US,pt-BR}/zotread.ftl
└── icons/
scripts/                   # dependency-free build/verify/icon tooling
tests/                     # node:test suites over the exact shipped sources
```

To develop against a live Zotero, create a proxy file named `zotread@fdossi.github.io` inside the `extensions` directory of your Zotero profile containing the absolute path to `addon/`, then start Zotero with `-purgecaches -jsconsole` ([plugin dev docs](https://www.zotero.org/support/dev/client_coding/plugin_development)).

## Building

```bash
npm run build     # -> dist/zotread-<version>.xpi + .sha256
npm run verify    # structural checks of the produced XPI
npm run icons     # regenerate PNG icons from scripts/lib/png.mjs
```

The build has zero npm dependencies (a minimal deterministic ZIP writer lives in `scripts/lib/zip.mjs`).

## Testing

```bash
npm test
```

Covers: state transitions (defaults, open/manual flows, multi-item batches, annotation add/delete aggregation, unread policy), persistence across reinitialization, composite-key collision safety, indicator geometry (exact 20 % overlap), accessibility attributes, manifest/locale validity, and XPI archive contents. Tests execute the **same files that ship** in the XPI via VM sandboxes with mocked Zotero APIs.

## Releasing

1. Update `CHANGELOG.md`, bump `version` in `addon/manifest.json`.
2. Commit, tag `vX.Y.Z`, push with tags:
   ```bash
   git tag vX.Y.Z && git push origin main --tags
   ```
3. GitHub Actions builds/tests the XPI, creates a Release with the `.xpi` + checksum, and updates `updates.json` on the default branch (the update manifest referenced by installed plugins).

## Troubleshooting

- **No column visible** — enable it: View → Columns → More Columns → *Reading status*.
- **All dots red after install** — expected: existing items without recorded evidence of reading start as unread. Use right-click → *Mark as Read* (multi-select works) for backfill.
- **Yellow dot missing though I have highlights** — try right-click → *Refresh Annotation Status*. If the highlight is embedded in the PDF file but was never imported into Zotero's annotation layer, import it first (attachment → *Manage Attachments → Import Annotations*... in current builds: right-click attachment → *Add annotations from file*). ZotRead counts Zotero annotation items, not raw PDF markup.
- **Reset everything** — Tools → Plugins → ZotRead → Remove; then delete the `zotreadState` table via Tools → Developer → Run JavaScript:
  ```javascript
  await Zotero.DB.queryAsync("DROP TABLE IF EXISTS zotreadState");
  ```

## References

- [Zotero 10 for Developers](https://www.zotero.org/support/dev/zotero_10_for_developers)
- [Plugin Development](https://www.zotero.org/support/dev/client_coding/plugin_development)
- [JavaScript API](https://www.zotero.org/support/dev/client_coding/javascript_api)
- [Local API](https://www.zotero.org/support/dev/web_api/v3/local_api) · [Web API v3](https://www.zotero.org/support/dev/web_api/v3/) · [Full-text content](https://www.zotero.org/support/dev/web_api/v3/fulltext_content)
- [Direct SQLite access (why we avoid it)](https://www.zotero.org/support/dev/client_coding/direct_sqlite_database_access)
- [Collections and Tags](https://www.zotero.org/support/collections_and_tags)
- Official sample plugin: [zotero/make-it-red](https://github.com/zotero/make-it-red)
