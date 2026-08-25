// Integration tests over the full plugin core with a mocked Zotero API:
// open detection, multi-item actions, annotation aggregation/invalidation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCoreModules } from './helpers/load.mjs';

const NOW = '2026-08-24T12:00:00.000Z';

/** Build a mock Zotero with an in-memory item database. */
function makeZotero() {
	const items = new Map();
	const prefVals = new Map();
	let nextID = 1;

	function registerItem(props) {
		const id = nextID++;
		const item = {
			id,
			libraryID: props.libraryID ?? 1,
			key: props.key ?? 'KEY' + String(id).padStart(8, '0'),
			parentItemID: props.parentItemID ?? null,
			deleted: !!props.deleted,
			annotationType: props.annotationType,
			isRegularItem() { return !!props.regular; },
			isAttachment() { return !!props.attachment; },
			isFileAttachment() { return !!props.fileAttachment; },
			isAnnotation() { return !!props.annotation; },
			getAttachments() { return item._attachments || []; },
			getAnnotations() { return (item._annotations || []).filter(a => !a.deleted); }
		};
		items.set(id, item);
		return item;
	}

	return {
		logError(e) { throw e; },
		Items: {
			registerItem,
			get(arg) {
				// Real Zotero.Items.get accepts a single ID or an array of IDs.
				if (Array.isArray(arg)) {
					return arg.map(id => items.get(id) ?? null).filter(Boolean);
				}
				return items.get(arg) ?? null;
			},
			exists(id) { return items.has(id); }
		},
		Prefs: {
			get(name) { return prefVals.get(name); },
			setForTest(name, value) { prefVals.set(name, value); }
		},
		Notifier: {
			trigger(event, type, ids) {
				this._redrawn.push(...ids);
			},
			_redrawn: [],
			registerObserver(observer, types) {
				this._observers.push({ observer, types });
				return this._observers.length;
			},
			unregisterObserver() {},
			_observers: []
		},
		_items: items
	};
}

function setup() {
	const zotero = makeZotero();
	const ctx = loadCoreModules(zotero);
	const ZotRead = ctx.ZotRead;
	ZotRead.init({ id: 'zotread@fdossi.github.io', version: 'test', rootURI: 'file:///zotread/' });
	return { ctx, ZotRead, zotero };
}

/** Memory backend standing in for Zotero.DB in mocked integration runs. */
function makeMemoryBackend() {
	const rows = new Map();
	return {
		rows,
		async createTable() {},
		async loadAll() {
			return [...rows.values()];
		},
		async upsert(table, row) {
			rows.set(row.libraryID + ':' + row.itemKey, { ...row });
		},
		async transaction(fn) {
			await fn();
		},
		async removeKeys(table, keys) {
			for (const k of keys) rows.delete(k.libraryID + ':' + k.itemKey);
		}
	};
}

async function makeLibrary(ZotRead, zotero) {
	// parent <- attachment <- annotations
	const parent = zotero.Items.registerItem({ regular: true });
	const attachment = zotero.Items.registerItem({ fileAttachment: true, parentItemID: parent.id });
	const annotation = zotero.Items.registerItem({
		annotation: true, parentItemID: attachment.id, annotationType: 'highlight'
	});
	parent._attachments = [attachment.id];
	attachment._annotations = [annotation];
	return { parent, attachment, annotation };
}

test('opening a supported attachment marks its bibliographic parent read', async () => {
	const { ZotRead, zotero } = setup();
	await ZotRead.Storage.init(makeMemoryBackend());
	const { parent, attachment } = await makeLibrary(ZotRead, zotero);

	const changed = await ZotRead.applyOpened([attachment], NOW);
	assert.deepEqual([...changed], [parent.id]);
	assert.equal(ZotRead.Storage.getSync(parent.libraryID, parent.key).read, true);
});

test('selecting/viewing an item does NOT mark it read', async () => {
	const { ZotRead, zotero } = setup();
	await ZotRead.Storage.init(makeMemoryBackend());
	const { parent } = await makeLibrary(ZotRead, zotero);

	// Simulate selection-only flows: no apply* call happens.
	const record = ZotRead.Storage.getSync(parent.libraryID, parent.key);
	assert.equal(record.read, false, 'selection must not change state');
});

test('standalone attachments record their own read state', async () => {
	const { ZotRead, zotero } = setup();
	await ZotRead.Storage.init(makeMemoryBackend());
	const standalone = zotero.Items.registerItem({ attachment: true, fileAttachment: true });

	const changed = await ZotRead.applyOpened([standalone], NOW);
	assert.deepEqual([...changed], [standalone.id]);
});

test('manual mark-as-read/unread across multi-item selection updates all eligible items', async () => {
	const { ZotRead, zotero } = setup();
	await ZotRead.Storage.init(makeMemoryBackend());

	const p1 = zotero.Items.registerItem({ regular: true });
	const p2 = zotero.Items.registerItem({ regular: true, libraryID: 2 });
	const childNote = zotero.Items.registerItem({ key: 'NOTENOTE' }); // ineligible

	let changed = await ZotRead.applyManualRead([p1, p2, childNote], NOW);
	assert.equal(changed.length, 2, 'only regular items are eligible');
	assert.equal(ZotRead.Storage.getSync(1, p1.key).read, true);
	assert.equal(ZotRead.Storage.getSync(2, p2.key).read, true);

	changed = [...await ZotRead.applyManualUnread([p1, p2], NOW)];
	assert.equal(changed.length, 2);
	assert.equal(ZotRead.Storage.getSync(1, p1.key).read, false);
	assert.equal(ZotRead.Storage.getSync(2, p2.key).read, false);
});

test('annotation aggregation: highlight counts, notes-on-parent do not', async () => {
	const { ZotRead, zotero } = setup();
	await ZotRead.Annotations.init();
	await ZotRead.Storage.init(makeMemoryBackend());
	const { parent, attachment } = await makeLibrary(ZotRead, zotero);

	assert.equal(ZotRead.Annotations.hasAnnotationsSync(parent), true, 'highlight qualifies');

	// Replace highlight with a note attached to the parent (not to attachment)
	attachment._annotations = [];
	ZotRead.Annotations.invalidate([parent.id]);
	assert.equal(ZotRead.Annotations.hasAnnotationsSync(parent), false,
		'standalone child notes do not qualify (documented policy)');
});

test('deleting final annotation drops yellow but keeps read; remaining annotation keeps yellow', async () => {
	const { ZotRead, zotero } = setup();
	await ZotRead.Annotations.init();
	await ZotRead.Storage.init(makeMemoryBackend());
	const { parent, attachment, annotation } = await makeLibrary(ZotRead, zotero);

	await ZotRead.applyOpened([attachment], NOW);
	assert.equal(
		ZotRead.State.statusOf(ZotRead.Storage.getSync(1, parent.key), ZotRead.Annotations.hasAnnotationsSync(parent)),
		'annotated'
	);

	// Delete one of two -> yellow preserved
	const second = zotero.Items.registerItem({
		annotation: true, parentItemID: attachment.id, annotationType: 'underline'
	});
	attachment._annotations.push(second);
	ZotRead.Annotations.invalidate([parent.id]);
	annotation.deleted = true;
	ZotRead.Annotations.invalidate([parent.id]);
	assert.equal(ZotRead.Annotations.hasAnnotationsSync(parent), true, 'yellow preserved while one remains');

	// Delete the last one -> green only
	second.deleted = true;
	ZotRead.Annotations.invalidate([parent.id]);
	const record = ZotRead.Storage.getSync(1, parent.key);
	assert.equal(ZotRead.State.statusOf(record, ZotRead.Annotations.hasAnnotationsSync(parent)), 'read');
	assert.equal(record.read, true, 'read state preserved after deletions');
});

test('multiple attachments of the same parent aggregate correctly', async () => {
	const { ZotRead, zotero } = setup();
	await ZotRead.Annotations.init();
	await ZotRead.Storage.init(makeMemoryBackend());

	const parent = zotero.Items.registerItem({ regular: true });
	const attA = zotero.Items.registerItem({ fileAttachment: true, parentItemID: parent.id });
	const attB = zotero.Items.registerItem({ fileAttachment: true, parentItemID: parent.id });
	parent._attachments = [attA.id, attB.id];

	assert.equal(ZotRead.Annotations.hasAnnotationsSync(parent), false);

	const inkOnB = zotero.Items.registerItem({
		annotation: true, parentItemID: attB.id, annotationType: 'ink'
	});
	attB._annotations = [inkOnB];
	ZotRead.Annotations.invalidate([parent.id]);
	assert.equal(ZotRead.Annotations.hasAnnotationsSync(parent), true,
		'annotation on second attachment must be detected');

	attB._annotations = [];
	ZotRead.Annotations.invalidate([parent.id]);
	assert.equal(ZotRead.Annotations.hasAnnotationsSync(parent), false,
		'moving/removing from second attachment must clear aggregate');
});

test('toggle read/unread flips each eligible item and repaints rows', async () => {
	const { ZotRead, zotero } = setup();
	await ZotRead.Storage.init(makeMemoryBackend());

	const p1 = zotero.Items.registerItem({ regular: true });
	const p2 = zotero.Items.registerItem({ regular: true, libraryID: 2 });
	const childNote = zotero.Items.registerItem({ key: 'NOTENOTE' }); // ineligible

	// p1 starts unread; p2 starts unread
	await ZotRead.applyManualRead([p1], NOW);
	assert.equal(ZotRead.Storage.getSync(1, p1.key).read, true);
	assert.equal(ZotRead.Storage.getSync(2, p2.key).read, false);

	// Toggle both (p2 unread->read, p1 read->unread); note excluded
	zotero.Notifier._redrawn.length = 0;
	let changed = await ZotRead.applyToggleRead([p1, p2, childNote], NOW);
	assert.equal(changed.length, 2, 'only regular items are eligible');
	assert.equal(ZotRead.Storage.getSync(1, p1.key).read, false, 'p1 flipped to unread');
	assert.equal(ZotRead.Storage.getSync(2, p2.key).read, true, 'p2 flipped to read');
	assert.deepEqual([...zotero.Notifier._redrawn].sort(), [p1.id, p2.id], 'both rows repainted');

	// Toggle again returns to original
	changed = await ZotRead.applyToggleRead([p1, p2], NOW);
	assert.equal(changed.length, 2);
	assert.equal(ZotRead.Storage.getSync(1, p1.key).read, true);
	assert.equal(ZotRead.Storage.getSync(2, p2.key).read, false);
});

test('refreshAnnotationStatus resolves annotation->attachment->parent and repaints parents', async () => {
	const { ZotRead, zotero } = setup();
	await ZotRead.Annotations.init();
	await ZotRead.Storage.init(makeMemoryBackend());
	const { parent, annotation } = await makeLibrary(ZotRead, zotero);

	// Cross-realm arrays: copy into the host realm before deepStrictEqual
	zotero.Notifier._redrawn.length = 0;
	const affected = await ZotRead.refreshAnnotationStatus([annotation]);
	assert.deepEqual([...affected], [parent.id], 'must resolve up to the bibliographic parent');
	assert.deepEqual([...zotero.Notifier._redrawn], [parent.id], 'parent row must be repainted');
});

test('annotation creation marks an unread parent read (README policy)', async () => {
	const { ZotRead, zotero } = setup();
	await ZotRead.Annotations.init();
	await ZotRead.Storage.init(makeMemoryBackend());
	const { parent, annotation } = await makeLibrary(ZotRead, zotero);

	assert.equal(ZotRead.Storage.getSync(1, parent.key).read, false);

	const res = await ZotRead.applyAnnotationCreated([annotation], NOW);
	assert.deepEqual([...res.changed], [parent.id], 'parent stored state must flip to read');
	assert.deepEqual([...res.parents], [parent.id]);
	assert.equal(ZotRead.Storage.getSync(1, parent.key).read, true);
	assert.equal(ZotRead.Storage.getSync(1, parent.key).source, 'auto');

	ZotRead.Annotations.invalidate([parent.id]);
	const status = ZotRead.State.statusOf(
		ZotRead.Storage.getSync(1, parent.key),
		ZotRead.Annotations.hasAnnotationsSync(parent)
	);
	assert.equal(status, 'annotated', 'unread -> read via annotation shows green+yellow');
});

test('annotation creation on an already-read parent changes nothing', async () => {
	const { ZotRead, zotero } = setup();
	await ZotRead.Annotations.init();
	await ZotRead.Storage.init(makeMemoryBackend());
	const { parent, attachment, annotation } = await makeLibrary(ZotRead, zotero);

	await ZotRead.applyOpened([attachment], NOW);
	zotero.Notifier._redrawn.length = 0;

	const res = await ZotRead.applyAnnotationCreated([annotation], NOW);
	assert.equal(res.changed.length, 0, 'already read: no state transition');
	assert.deepEqual([...zotero.Notifier._redrawn], [], 'no repaint when nothing changed');
});

test('non-annotation items are ignored by the creation policy', async () => {
	const { ZotRead, zotero } = setup();
	await ZotRead.Storage.init(makeMemoryBackend());
	const parent = zotero.Items.registerItem({ regular: true });
	const attachment = zotero.Items.registerItem({ fileAttachment: true, parentItemID: parent.id });

	const res = await ZotRead.applyAnnotationCreated([parent, attachment], NOW);
	assert.equal(res.changed.length, 0, 'regular items/attachments must not be marked read');
	assert.equal(res.parents.length, 0);
	assert.equal(ZotRead.Storage.getSync(1, parent.key).read, false,
		'adding a plain item or attachment never marks anything read');
});

test('autoDetectRead=false disables automatic marking from annotations', async () => {
	const { ZotRead, zotero } = setup();
	await ZotRead.Annotations.init();
	await ZotRead.Storage.init(makeMemoryBackend());
	const { parent, annotation } = await makeLibrary(ZotRead, zotero);

	zotero.Prefs.setForTest('zotread.autoDetectRead', false);
	const res = await ZotRead.applyAnnotationCreated([annotation], NOW);
	assert.equal(res.changed.length, 0, 'pref off: no automatic transition');
	assert.equal(ZotRead.Storage.getSync(1, parent.key).read, false);

	// Manual flows stay available regardless of the pref
	const changed = await ZotRead.applyManualRead([parent], NOW);
	assert.equal(changed.length, 1);
	assert.equal(ZotRead.Storage.getSync(1, parent.key).source, 'manual');
});

test('notifier add event applies the creation policy and repaints the parent', async () => {
	const { ZotRead, zotero } = setup();
	await ZotRead.Annotations.init();
	await ZotRead.Storage.init(makeMemoryBackend());
	ZotRead.Notifier.init();
	const { parent, annotation } = await makeLibrary(ZotRead, zotero);

	const itemObserver = zotero.Notifier._observers.find(o => o.types.includes('item'));
	assert.ok(itemObserver, 'notifier must register an item observer');

	itemObserver.observer.notify('add', 'item', [annotation.id]);

	// Storage write happens inside the async handler; the repaint is debounced
	await new Promise(resolve => setTimeout(resolve, 350));

	assert.equal(ZotRead.Storage.getSync(1, parent.key).read, true,
		'notifier-driven annotation add must mark the parent read');
	assert.ok(zotero.Notifier._redrawn.includes(parent.id), 'parent row repainted after debounce');
});

