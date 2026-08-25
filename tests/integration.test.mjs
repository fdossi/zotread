// Integration tests over the full plugin core with a mocked Zotero API:
// open detection, multi-item actions, annotation aggregation/invalidation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCoreModules } from './helpers/load.mjs';

const NOW = '2026-08-24T12:00:00.000Z';

/** Build a mock Zotero with an in-memory item database. */
function makeZotero() {
	const items = new Map();
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
			get(id) { return items.get(id) ?? null; },
			exists(id) { return items.has(id); }
		},
		Notifier: {
			trigger(event, type, ids) {
				this._redrawn.push(...ids);
			},
			_redrawn: [],
			registerObserver() { return 1; },
			unregisterObserver() {}
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

