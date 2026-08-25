// Tests for automatic first-column placement on fresh install.
// Verifies that ZotRead writes ordinal:-1 for its dataKey in treePrefs.json
// (per-profile column order) while leaving any column the user has already
// repositioned or hidden untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScripts } from './helpers/load.mjs';

const ctx = loadScripts(['content/zotread.js', 'content/state.js', 'content/column.js']);
const ColumnFactory = ctx.ZotRead.Column.makeColumn;
const KEY = 'zotread@fdossi.github.io_status';
const TREE_ID = 'item-tree-main-library';

function makeFakeTree(treeID, existingPrefs = {}) {
	let resetCalled = 0;
	let storeCalled = 0;
	return {
		id: treeID,
		_columnPrefs: existingPrefs,
		resetCalled: () => resetCalled,
		storeCalled: () => storeCalled,
		_getColumnPrefs() { return this._columnPrefs || {}; },
		_loadColumnPrefsFromFile() {},
		_storeColumnPrefs(p) { this._columnPrefs = p; storeCalled++; },
		_resetColumns() { resetCalled++; return Promise.resolve(); }
	};
}

function makeColumn(overrides = {}) {
	// File system stub: a single treePrefs.json content controlled by tests.
	let fileContent = overrides.fileContent;
	let writes = [];
	const impl = ColumnFactory({
		pluginID: 'zotread@fdossi.github.io',
		pref: () => null,
		formatString: (win, id, args, fallback) => fallback,
		getRecord: () => ({ read: false }),
		hasAnnotations: () => false,
		registerColumn: opts => KEY,
		unregisterColumn: () => true,
		getMainWindows: () => overrides.windows || [],
		profileDir: () => 'C:/profile',
		readFile: async () => {
			if (fileContent == null) throw new Error('file missing');
			return fileContent;
		},
		writeFile: async (path, str) => {
			writes.push({ path, str });
			fileContent = str;
		},
		logError(e) { throw e; },
		...overrides
	});
	impl._writes = writes;
	impl._getFileContent = () => fileContent;
	return impl;
}

test('fresh install: writes ordinal -1 and reorders the live tree first', async () => {
	const tree = makeFakeTree(TREE_ID, {});
	const win = { ZoteroPane: { itemsView: { tree } } };
	const impl = makeColumn({ windows: [win], fileContent: null });
	impl.register();

	await impl.ensureFirstColumn();

	// Persisted to treePrefs.json for the tree id
	assert.ok(impl._writes.length >= 1, 'treePrefs.json must be written');
	const saved = JSON.parse(impl._writes[impl._writes.length - 1].str);
	assert.equal(saved[TREE_ID][KEY].ordinal, -1, 'zotread must be first');
	assert.equal(saved[TREE_ID][KEY].hidden, false);

	// Live tree updated in memory and re-rendered
	assert.equal(tree._columnPrefs[KEY].ordinal, -1);
	assert.equal(tree.resetCalled(), 1, 'tree must re-render with new order');
	assert.ok(tree.storeCalled() >= 1);
});

test('user already repositioned: existing ordinal is respected (no change)', async () => {
	const existing = JSON.stringify({ [TREE_ID]: { [KEY]: { ordinal: 3, width: 28 } } });
	const tree = makeFakeTree(TREE_ID, { [KEY]: { ordinal: 3, width: 28 } });
	const win = { ZoteroPane: { itemsView: { tree } } };
	const impl = makeColumn({ windows: [win], fileContent: existing });
	impl.register();

	await impl.ensureFirstColumn();

	// Nothing persisted again
	assert.equal(impl._writes.length, 0, 'must not overwrite a user-chosen position');
	assert.equal(tree.resetCalled(), 0, 'must not re-render when unchanged');
	// In-memory position preserved
	assert.equal(tree._columnPrefs[KEY].ordinal, 3);
});

test('user hid the column: hidden+ordinal preserved, not forced first', async () => {
	const existing = JSON.stringify({ [TREE_ID]: { [KEY]: { ordinal: 5, hidden: true } } });
	const tree = makeFakeTree(TREE_ID, { [KEY]: { ordinal: 5, hidden: true } });
	const win = { ZoteroPane: { itemsView: { tree } } };
	const impl = makeColumn({ windows: [win], fileContent: existing });
	impl.register();

	await impl.ensureFirstColumn();

	assert.equal(impl._writes.length, 0, 'must respect a hidden column');
	assert.equal(tree._columnPrefs[KEY].hidden, true);
});

test('only the zotread dataKey is added; existing columns are preserved', async () => {
	const existing = JSON.stringify({
		[TREE_ID]: {
			title: { ordinal: 0, width: 200 },
			dateAdded: { ordinal: 1, width: 90 }
		}
	});
	const tree = makeFakeTree(TREE_ID, {
		title: { ordinal: 0, width: 200 },
		dateAdded: { ordinal: 1, width: 90 }
	});
	const win = { ZoteroPane: { itemsView: { tree } } };
	const impl = makeColumn({ windows: [win], fileContent: existing });
	impl.register();

	await impl.ensureFirstColumn();

	const saved = JSON.parse(impl._writes[impl._writes.length - 1].str)[TREE_ID];
	assert.equal(saved.title.ordinal, 0, 'title ordinal preserved');
	assert.equal(saved.dateAdded.ordinal, 1, 'dateAdded ordinal preserved');
	assert.equal(saved[KEY].ordinal, -1, 'zotread inserted first');
});

test('covers views not currently open via the persisted file', async () => {
	// No open windows, but treePrefs.json already has a collection view id.
	const existing = JSON.stringify({
		'item-tree-main-collection': { title: { ordinal: 0 } }
	});
	const impl = makeColumn({ windows: [], fileContent: existing });
	impl.register();

	await impl.ensureFirstColumn();

	const saved = JSON.parse(impl._writes[impl._writes.length - 1].str);
	assert.equal(saved['item-tree-main-collection'][KEY].ordinal, -1,
		'collection view also gets zotread first');
	assert.equal(saved['item-tree-main-collection'].title.ordinal, 0,
		'other columns preserved in that view');
});
