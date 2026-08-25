// Storage tests: persistence semantics, composite identity, batching.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts } from './helpers/load.mjs';

const ctx = loadScripts(['content/zotread.js', 'content/state.js', 'content/storage.js']);
const State = ctx.ZotRead.State;
const StorageFactory = ctx.ZotRead.Storage.makeStorage;

/** In-memory backend whose rows survive storage re-creation (= restart). */
function makeBackend() {
	const rows = new Map(); // "lib:key" -> row
	return {
		rows,
		async createTable() {},
		async loadAll(table) {
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

test('state persists across restart or storage reinitialization', async () => {
	const backend = makeBackend();

	let storage = StorageFactory(backend);
	await storage.init();
	await storage.put(1, 'ABC12345', State.onOpened(State.defaultRecord(), '2026-01-01T00:00:00Z'));

	// Simulate restart: fresh storage instance over the same database
	storage = StorageFactory(backend);
	await storage.init();
	const record = storage.getSync(1, 'ABC12345');
	assert.equal(record.read, true, 'read state must survive reinitialization');
	assert.equal(record.firstOpenedAt, '2026-01-01T00:00:00Z');
});

test('identical item keys in different libraries do not collide', async () => {
	const storage = StorageFactory(makeBackend());
	await storage.init();
	const now = '2026-08-24T00:00:00Z';

	await storage.put(1, 'SAMEKEY1', State.markRead(State.defaultRecord(), now));
	await storage.put(2, 'SAMEKEY1', State.defaultRecord());

	assert.equal(storage.getSync(1, 'SAMEKEY1').read, true, 'library 1 record');
	assert.equal(storage.getSync(2, 'SAMEKEY1').read, false, 'library 2 must be independent');
});

test('items without stored rows read as unread', async () => {
	const storage = StorageFactory(makeBackend());
	await storage.init();
	const record = storage.getSync(42, 'NOPE0000');
	assert.equal(record.read, false);
});

test('putMany batches writes in one transaction and updates cache', async () => {
	const backend = makeBackend();
	let transactions = 0;
	backend.transaction = async fn => { transactions++; await fn(); };

	const storage = StorageFactory(backend);
	await storage.init();

	await storage.putMany([
		{ libraryID: 1, itemKey: 'A', record: State.markRead(State.defaultRecord(), 't1') },
		{ libraryID: 1, itemKey: 'B', record: State.markRead(State.defaultRecord(), 't2') },
		{ libraryID: 3, itemKey: 'C', record: State.onOpened(State.defaultRecord(), 't3') }
	]);

	assert.equal(transactions, 1, 'one transaction for the whole batch');
	assert.equal(storage.getSync(1, 'A').read, true);
	assert.equal(storage.getSync(1, 'B').read, true);
	assert.equal(storage.getSync(3, 'C').firstOpenedAt, 't3');
});

test('removeMany purges rows for deleted items', async () => {
	const backend = makeBackend();
	const storage = StorageFactory(backend);
	await storage.init();

	await storage.put(1, 'DEL00001', State.markRead(State.defaultRecord(), 't'));
	assert.equal(backend.rows.size, 1);

	await storage.removeMany([{ libraryID: 1, itemKey: 'DEL00001' }]);
	assert.equal(backend.rows.size, 0);
	assert.equal(storage.getSync(1, 'DEL00001').read, false);
});
