/*
 * ZotRead item-tree column.
 *
 * Zotero 10 exposes no row-decoration hook capable of drawing content left
 * of the title, so the supported mechanism is a dedicated narrow custom
 * column registered through Zotero.ItemTreeManager.registerColumn(). Column
 * order (including first position) is not a registerColumn option; it lives
 * in the per-profile treePrefs.json as each column's `ordinal` (negative
 * sorts leftmost). ZotRead therefore places itself first automatically on a
 * fresh install (no saved ordinal) by persisting ordinal:-1 for its dataKey,
 * while leaving any column the user has already repositioned or hidden
 * untouched (a saved ordinal means "configured" -> leave it alone). The
 * column supports sorting via its data provider.
 *
 * Rendering notes:
 *  - renderCell is only invoked for object rows; library-header and spacer
 *    rows override renderRow entirely, so they can never show indicators.
 *  - Indicators are drawn only for eligible bibliographic items (regular
 *    items); child attachments/notes/annotations show nothing.
 *  - The two-dot state overlaps by exactly 20% of one dot's diameter using
 *    margin-inline-start (RTL-aware): 6.5 px dots overlap by -1.3 px.
 *  - Colors come from preferences at render time; tooltips and accessible
 *    names describe status so color is never the only signal.
 *  - The "Show annotation indicator" preference hides the yellow dot when
 *    explicitly off: annotated then renders like read (single green dot).
 */

/* global Zotero, ZotRead */

ZotRead.Column = (function () {
	const DATA_KEY = 'status';
	// Geometry contract (asserted in tests/geometry.test.mjs and mirrored in
	// styles.css): dots are 6.5 px (50% smaller than the previous 13 px); the
	// two-dot state overlaps by exactly 20% of one dot's diameter (1.3 px),
	// giving a center-to-center distance of 5.2 px and a combined width of
	// 11.7 px. OVERLAP_PX is written as a literal so the value is exact in
	// CSS output ('-1.3px').
	const DOT_SIZE = 6.5;
	const OVERLAP_PX = 1.3;

	function makeColumn(deps) {
		let registeredKey = null;

		function colors() {
			return {
				unread: deps.pref('colorUnread') || '#E53935',
				read: deps.pref('colorRead') || '#66BB6A',
				annotated: deps.pref('colorAnnotated') || '#FBC02D'
			};
		}

		function strings(win) {
			return {
				unread: deps.formatString(win, 'zotread-status-unread', {}, 'Unread'),
				read: deps.formatString(win, 'zotread-status-read', {}, 'Read'),
				annotated: deps.formatString(win, 'zotread-status-annotated', {}, 'Read and annotated'),
				column: deps.formatString(win, 'zotread-column-label', {}, 'Reading status')
			};
		}

		/**
		 * Synchronous data-provider value. Also drives sorting:
		 * '0' unread < '1' read < '2' read+annotated.
		 */
		function dataProvider(item) {
			try {
				if (!item || !item.isRegularItem()) {
					return ''; // ineligible rows carry no indicator
				}
				let record = deps.getRecord(item.libraryID, item.key);
				let hasAnnotations = deps.hasAnnotations(item);
				return ZotRead.State.sortValue(ZotRead.State.statusOf(record, hasAnnotations));
			}
			catch (e) {
				deps.logError(e);
				return '';
			}
		}

		function makeDot(doc, color, extraClass) {
			let dot = doc.createElement('span');
			dot.className = 'zotread-dot' + (extraClass ? ' ' + extraClass : '');
			dot.style.width = DOT_SIZE + 'px';
			dot.style.height = DOT_SIZE + 'px';
			dot.style.flex = '0 0 ' + DOT_SIZE + 'px';
			dot.style.backgroundColor = color;
			return dot;
		}

		/**
		 * Build the indicator cell. `data` is '' or '0'|'1'|'2'.
		 */
		function renderCell(index, data, column, isFirstColumn, doc) {
			let win = doc.defaultView;
			let labels = strings(win);
			let c = colors();

			let cell = doc.createElement('span');
			cell.className = 'cell zotread-cell';

			if (!data) {
				return cell; // ineligible/unknown: empty cell, no layout shift risk
			}

			// "Show annotation indicator" preference: when explicitly disabled
			// the annotated state renders exactly like read (single green dot),
			// so the documented toggle has a visible effect. Sorting still
			// separates annotated items: dataProvider is display-independent.
			let effective = data;
			if (data === ZotRead.STATUS.ANNOTATED && deps.pref('showAnnotationDots') === false) {
				effective = ZotRead.STATUS.READ;
			}

			let container = doc.createElement('span');
			container.className = 'zotread-dots';
			container.setAttribute('role', 'img');

			if (effective === ZotRead.STATUS.UNREAD) {
				container.appendChild(makeDot(doc, c.unread));
				container.setAttribute('aria-label', labels.unread);
				container.setAttribute('title', labels.unread);
			}
			else if (effective === ZotRead.STATUS.READ) {
				container.appendChild(makeDot(doc, c.read));
				container.setAttribute('aria-label', labels.read);
				container.setAttribute('title', labels.read);
			}
			else if (effective === ZotRead.STATUS.ANNOTATED) {
				let green = makeDot(doc, c.read, 'zotread-dot-green');
				let yellow = makeDot(doc, c.annotated, 'zotread-dot-annotated');
				// Green first, yellow second, overlapping by exactly 20% of
				// one dot's diameter. margin-inline-start keeps this correct
				// in right-to-left locales. A hairline ring separates the two
				// fills where they overlap on both light and dark themes.
				yellow.style.marginInlineStart = (-OVERLAP_PX) + 'px';
				green.style.boxShadow = 'inset 0 0 0 1px rgba(0,0,0,0.25)';
				yellow.style.boxShadow = 'inset 0 0 0 1px rgba(0,0,0,0.25)';
				container.appendChild(green);
				container.appendChild(yellow);
				container.setAttribute('aria-label', labels.annotated);
				container.setAttribute('title', labels.annotated);
			}

			cell.appendChild(container);
			return cell;
		}

		function register() {
			registeredKey = deps.registerColumn({
				dataKey: DATA_KEY,
				label: 'zotread-column-label',
				pluginID: deps.pluginID,
				enabledTreeIDs: ['main'],
				staticWidth: true,
				fixedWidth: true,
				width: '28',
				minWidth: 24,
				noPadding: true,
				showInColumnPicker: true,
				columnPickerSubMenu: false,
				dataProvider,
				renderCell,
				zoteroPersist: ['width', 'hidden', 'sortDirection']
			});
			return registeredKey;
		}

		function unregister() {
			if (registeredKey) {
				try {
					deps.unregisterColumn(registeredKey);
				}
				catch (e) {
					deps.logError(e);
				}
				registeredKey = null;
			}
		}

		function refreshAll() {
			try {
				// Repaint visible rows without resetting user's columns.
				for (let win of deps.getMainWindows()) {
					let itemsView = win.ZoteroPane && win.ZoteroPane.itemsView;
					if (itemsView && itemsView.tree) {
						itemsView.tree.invalidate();
					}
				}
			}
			catch (e) {
				deps.logError(e);
			}
		}

		// --- Automatic first-column placement on fresh install -----------------
		// Column order is stored per profile in treePrefs.json as each column's
		// `ordinal` (negative sorts leftmost). Zotero has no public API to set a
		// custom column's default position, so we persist ordinal:-1 for our
		// dataKey and respect any column the user has already repositioned or
		// hidden (a saved ordinal means "configured" -> leave it alone).
		const FIRST_ORDINAL = -1;

		function treePrefsPath() {
			return deps.profileDir().replace(/\\/g, '/') + '/treePrefs.json';
		}

		async function readAllTreePrefs() {
			try {
				let raw = await deps.readFile(treePrefsPath());
				return JSON.parse(raw) || {};
			}
			catch (e) {
				return {};
			}
		}

		async function writeAllTreePrefs(obj) {
			try {
				await deps.writeFile(treePrefsPath(), JSON.stringify(obj));
			}
			catch (e) {
				deps.logError(e);
			}
		}

		async function ensureFirstColumnForTree(tree, key) {
			let all = await readAllTreePrefs();
			let fileEntry = all[tree.id] || {};

			// User (or a previous run) already chose a position -> respect it.
			if (fileEntry[key] && 'ordinal' in fileEntry[key]) {
				return;
			}

			let next = Object.assign({}, fileEntry);
			next[key] = Object.assign({}, next[key], {
				ordinal: FIRST_ORDINAL,
				hidden: false
			});

			// Reflect immediately in the live tree without a full reload.
			try { tree._columnPrefs = next; } catch (e) {}
			if (typeof tree._storeColumnPrefs === 'function') {
				try { tree._storeColumnPrefs(next); } catch (e) {}
			}
			if (typeof tree._resetColumns === 'function') {
				try { await tree._resetColumns(); } catch (e) {}
			}

			// Persist promptly and authoritatively for this tree id.
			try {
				all[tree.id] = next;
				await writeAllTreePrefs(all);
			}
			catch (e) {
				deps.logError(e);
			}
		}

		async function ensureFirstColumn() {
			if (!registeredKey) return;
			let key = registeredKey;

			// Persist for every known tree id (covers views not currently open).
			try {
				let all = await readAllTreePrefs();
				let changed = false;
				for (let treeID of Object.keys(all)) {
					let entry = all[treeID];
					if (entry && entry[key] && 'ordinal' in entry[key]) continue;
					all[treeID] = Object.assign({}, entry, {
						[key]: Object.assign({}, entry && entry[key], {
							ordinal: FIRST_ORDINAL,
							hidden: false
						})
					});
					changed = true;
				}
				if (changed) await writeAllTreePrefs(all);
			}
			catch (e) {
				deps.logError(e);
			}

			// Apply to currently open trees for immediate visual effect.
			for (let win of deps.getMainWindows()) {
				try {
					let tree = win.ZoteroPane && win.ZoteroPane.itemsView
						&& win.ZoteroPane.itemsView.tree;
					if (tree) await ensureFirstColumnForTree(tree, key);
				}
				catch (e) {
					deps.logError(e);
				}
			}
		}

		return { register, unregister, refreshAll, ensureFirstColumn, dataProvider, renderCell, OVERLAP_PX, DOT_SIZE };
	}

	return {
		makeColumn,

		register() {
			this._impl = makeColumn({
				pluginID: ZotRead.ID,
				pref: name => ZotRead.pref(name),
				formatString: (win, id, args, fb) => ZotRead.formatString(win, id, args, fb),
				getRecord: (libraryID, key) => ZotRead.Storage.getSync(libraryID, key),
				hasAnnotations: item => ZotRead.Annotations.hasAnnotationsSync(item),
				registerColumn: opts => Zotero.ItemTreeManager.registerColumn(opts),
				unregisterColumn: key => Zotero.ItemTreeManager.unregisterColumn(key),
				getMainWindows: () => Zotero.getMainWindows(),
				profileDir: () => Zotero.Profile.dir,
				readFile: path => Zotero.File.getContentsAsync(path),
				writeFile: (path, str) => Zotero.File.putContentsAsync(path, str),
				logError: e => Zotero.logError(e)
			});
			this._key = this._impl.register();
		},

		unregister() {
			if (this._impl) {
				this._impl.unregister();
				this._impl = null;
			}
		},

		refreshAll() {
			if (this._impl) {
				this._impl.refreshAll();
			}
		},

		/**
		 * Place the column first on a fresh install / first run, without
		 * overriding a position the user has already chosen. Safe to call
		 * once per startup; see makeColumn().ensureFirstColumn().
		 */
		ensureFirstColumn() {
			if (this._impl) {
				return this._impl.ensureFirstColumn();
			}
		},

		get key() {
			return this._key;
		}
	};
})();
