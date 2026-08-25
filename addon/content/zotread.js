/*
 * ZotRead namespace, constants and plugin lifecycle.
 * Loaded first; every other content script attaches to this object.
 */

/* global Zotero, Services, ZotReadScope */

var ZotRead = {
	ID: null,
	VERSION: null,
	ROOT_URI: null,

	/** Status values used by the column data provider (also defines sort order). */
	STATUS: {
		UNREAD: '0',
		READ: '1',
		ANNOTATED: '2'
	},

	/**
	 * Reader annotation types that qualify for the yellow dot.
	 * Standalone child notes attached to the parent item deliberately do NOT
	 * qualify — see README ("What counts as an annotation").
	 */
	QUALIFYING_ANNOTATION_TYPES: [
		'highlight',
		'underline',
		'note',
		'image',
		'ink',
		'text'
	],

	init({ id, version, rootURI }) {
		this.ID = id;
		this.VERSION = version;
		this.ROOT_URI = rootURI;
	},

	pref(name) {
		return Zotero.Prefs.get('zotread.' + name);
	},

	setPref(name, value) {
		Zotero.Prefs.set('zotread.' + name, value);
	},

	registerPrefObserver(name, callback) {
		return Zotero.Prefs.registerObserver('zotread.' + name, callback);
	},

	unregisterPrefObserver(id) {
		if (id !== undefined && id !== null) {
			Zotero.Prefs.unregisterObserver(id);
		}
	},

	/**
	 * Localize a Fluent message from the plugin's FTL file using the given
	 * window's document localization, which includes the unified plugin
	 * source registered by Zotero. Falls back to English defaults when the
	 * message cannot be resolved.
	 */
	formatString(win, id, args, fallback) {
		try {
			let value = win.document.l10n.formatValueSync(id, args);
			if (value != null && value !== '') {
				return value;
			}
		}
		catch (e) {
			Zotero.logError(e);
		}
		return fallback;
	},

	async main() {
		await Zotero.uiReadyPromise;

		// Make plugin strings resolvable through Zotero.getString()
		// (used for the column label). Removed on shutdown.
		try {
			Zotero.ftl.addResourceIds(['zotread.ftl']);
		}
		catch (e) {
			Zotero.logError(e);
		}

		this.registerStylesheet();

		await ZotRead.Storage.init();
		ZotRead.Annotations.init();
		ZotRead.Notifier.init();

		ZotRead.Column.register();
		// Place the column first automatically on a fresh install, while
		// respecting any position the user has already chosen.
		ZotRead.Column.ensureFirstColumn();
		ZotRead.Menu.register();

		this._prefObserverIDs = [
			this.registerPrefObserver('showAnnotationDots', () => ZotRead.Column.refreshAll()),
			this.registerPrefObserver('colorUnread', () => ZotRead.Column.refreshAll()),
			this.registerPrefObserver('colorRead', () => ZotRead.Column.refreshAll()),
			this.registerPrefObserver('colorAnnotated', () => ZotRead.Column.refreshAll())
		];

		ZotRead.Reader.init();

		this.markStarted();
		log("Started");
	},

	shutdown() {
		ZotRead.Reader.shutdown();
		if (this._prefObserverIDs) {
			for (let id of this._prefObserverIDs) {
				this.unregisterPrefObserver(id);
			}
			this._prefObserverIDs = [];
		}
		ZotRead.Menu.unregister();
		ZotRead.Column.unregister();
		ZotRead.Notifier.shutdown();
		ZotRead.Annotations.shutdown();
		ZotRead.Storage.shutdown();
		try {
			Zotero.ftl.removeResourceIds(['zotread.ftl']);
		}
		catch (e) {
			// Zotero.ftl may already be tearing down during app shutdown
		}
		this.unregisterStylesheet();
		for (let win of Zotero.getMainWindows()) {
			this.removeFromWindow(win);
		}
	},

	/**
	 * Per-window setup: link the plugin's Fluent file into the document so
	 * data-l10n-id attributes (menu items, preference pane) resolve, and keep
	 * a reference for cleanup.
	 */
	addToWindow(win) {
		try {
			let doc = win.document;
			if (!doc) return;
			let existing = doc.getElementById('zotread-ftl-link');
			if (!existing) {
				let link = doc.createElementNS('http://www.w3.org/1999/xhtml', 'link');
				link.id = 'zotread-ftl-link';
				link.rel = 'localization';
				link.href = 'zotread.ftl';
				doc.head.appendChild(link);
			}
			this._windows = this._windows || new Set();
			this._windows.add(win);
		}
		catch (e) {
			Zotero.logError(e);
		}
	},

	removeFromWindow(win) {
		try {
			if (this._windows) {
				this._windows.delete(win);
			}
			let doc = win.document;
			if (!doc) return;
			let link = doc.getElementById('zotread-ftl-link');
			if (link) {
				link.remove();
			}
		}
		catch (e) {
			// Window may already be gone during app shutdown
		}
	},

	markStarted() {
		this._started = true;
	},

	/** Register content/styles.css as an author sheet for chrome documents. */
	registerStylesheet() {
		try {
			let uri = Services.io.newURI(this.ROOT_URI + 'content/styles.css');
			this._sss = Cc['@mozilla.org/content/style-sheet-service;1']
				.getService(Ci.nsIStyleSheetService);
			this._sheetURI = uri;
			if (!this._sss.sheetRegistered(uri, this._sss.AUTHOR_SHEET)) {
				this._sss.loadAndRegisterSheet(uri, this._sss.AUTHOR_SHEET);
			}
		}
		catch (e) {
			Zotero.logError(e);
		}
	},

	unregisterStylesheet() {
		try {
			if (this._sss && this._sheetURI
					&& this._sss.sheetRegistered(this._sheetURI, this._sss.AUTHOR_SHEET)) {
				this._sss.unregisterSheet(this._sheetURI, this._sss.AUTHOR_SHEET);
			}
		}
		catch (e) {
			Zotero.logError(e);
		}
		this._sss = null;
		this._sheetURI = null;
	},

	/**
	 * Apply "opened in reader" to eligible bibliographic parents.
	 * Accepts attachment items or regular items; ineligible items are
	 * ignored. Returns the item IDs whose visible status changed.
	 */
	async applyOpened(items, now) {
		now = now || ZotRead.State.now();
		let targets = [];
		for (let item of items) {
			if (!item) continue;
			try {
				if (item.isRegularItem()) {
					targets.push(item);
					continue;
				}
				if (typeof item.isAnnotation === 'function' && item.isAnnotation()) {
					continue;
				}
				let parentId = item.parentItemID;
				if (parentId) {
					// Attachment opened in the reader: mark its bibliographic
					// parent read when the parent is a regular item.
					let parent = Zotero.Items.get(parentId);
					if (parent && parent.isRegularItem()) {
						targets.push(parent);
					}
				}
				else if (typeof item.isAttachment === 'function' && item.isAttachment()) {
					// Standalone supported attachment opened directly: record
					// its own read state (not displayed in the column).
					targets.push(item);
				}
			}
			catch (e) {
				Zotero.logError(e);
			}
		}

		let changed = [];
		let entries = [];
		for (let item of targets) {
			let current = this.Storage.getSync(item.libraryID, item.key);
			let next = ZotRead.State.onOpened(current, now);
			if (!ZotRead.State.equals(current, next)) {
				entries.push({ libraryID: item.libraryID, itemKey: item.key, record: next });
				changed.push(item.id);
			}
		}
		await this.Storage.putMany(entries);
		this.refreshRows(changed);
		return changed;
	},

	/** Manual "Mark as read" over one or more selected items. */
	async applyManualRead(items, now) {
		now = now || ZotRead.State.now();
		let changed = [];
		let entries = [];
		for (let item of items) {
			if (!item || !item.isRegularItem || !item.isRegularItem()) continue;
			let current = this.Storage.getSync(item.libraryID, item.key);
			let next = ZotRead.State.markRead(current, now);
			if (!ZotRead.State.equals(current, next)) {
				entries.push({ libraryID: item.libraryID, itemKey: item.key, record: next });
				changed.push(item.id);
			}
		}
		await this.Storage.putMany(entries);
		this.refreshRows(changed);
		return changed;
	},

	/** Manual "Mark as unread" over one or more selected items. */
	async applyManualUnread(items, now) {
		now = now || ZotRead.State.now();
		let changed = [];
		let entries = [];
		for (let item of items) {
			if (!item || !item.isRegularItem || !item.isRegularItem()) continue;
			let current = this.Storage.getSync(item.libraryID, item.key);
			let next = ZotRead.State.markUnread(current, now);
			if (!ZotRead.State.equals(current, next)) {
				entries.push({ libraryID: item.libraryID, itemKey: item.key, record: next });
				changed.push(item.id);
			}
		}
		await this.Storage.putMany(entries);
		this.refreshRows(changed);
		return changed;
	},

	/** Manual "Toggle read/unread" over one or more selected items. */
	async applyToggleRead(items, now) {
		now = now || ZotRead.State.now();
		let changed = [];
		let entries = [];
		for (let item of items) {
			if (!item || !item.isRegularItem || !item.isRegularItem()) continue;
			let current = this.Storage.getSync(item.libraryID, item.key);
			let next = ZotRead.State.toggleRead(current, now);
			if (!ZotRead.State.equals(current, next)) {
				entries.push({ libraryID: item.libraryID, itemKey: item.key, record: next });
				changed.push(item.id);
			}
		}
		await this.Storage.putMany(entries);
		this.refreshRows(changed);
		return changed;
	},

	/**
	 * Recompute aggregate annotation presence for affected parents and
	 * repaint their rows.
	 */
	async refreshAnnotationStatus(items) {
		let parentIDs = ZotRead.Annotations.resolveParentIDs(items);
		ZotRead.Annotations.invalidate(parentIDs);
		this.refreshRows(parentIDs);
		return parentIDs;
	},

	/**
	 * Annotation-creation policy (README "Automatic read detection"):
	 * creating a qualifying reader annotation marks its bibliographic parent
	 * read. The annotated (yellow) flag itself is recomputed live from
	 * library data by the notifier's aggregate refresh.
	 *
	 * Accepts notified item objects; non-annotations are ignored. Respects
	 * the autoDetectRead preference: when explicitly disabled, no automatic
	 * state transition happens (manual actions are unaffected). Returns
	 * { changed, parents } - stored-state changes and affected parents.
	 */
	async applyAnnotationCreated(items, now) {
		if (this.pref('autoDetectRead') === false) {
			return { changed: [], parents: [] };
		}
		now = now || ZotRead.State.now();
		let entries = [];
		let changed = [];
		let parents = [];
		for (let item of items) {
			if (!item || typeof item.isAnnotation !== 'function' || !item.isAnnotation()) continue;
			try {
				// annotation -> attachment -> bibliographic parent
				let parent = item;
				for (let depth = 0; depth < 3 && parent && !parent.isRegularItem(); depth++) {
					if (!parent.parentItemID) break;
					parent = Zotero.Items.get(parent.parentItemID);
				}
				if (!parent || !parent.isRegularItem()) continue;
				parents.push(parent.id);
				let current = this.Storage.getSync(parent.libraryID, parent.key);
				let next = ZotRead.State.onAnnotationCreated(current, now);
				if (!ZotRead.State.equals(current, next)) {
					entries.push({ libraryID: parent.libraryID, itemKey: parent.key, record: next });
					changed.push(parent.id);
				}
			}
			catch (e) {
				Zotero.logError(e);
			}
		}
		await this.Storage.putMany(entries);
		return { changed, parents };
	},

	/** Visual-only row refresh; does not re-sort or mutate rows. */
	refreshRows(itemIDs) {
		if (!itemIDs || !itemIDs.length) return;
		try {
			Zotero.Notifier.trigger('redraw', 'item', itemIDs);
		}
		catch (e) {
			Zotero.logError(e);
		}
	}
};
