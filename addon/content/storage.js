/*
 * Persistence for ZotRead.
 *
 * Storage is a plugin-managed table inside Zotero's database, accessed only
 * through Zotero's supported DB abstraction (Zotero.DB.queryAsync /
 * executeTransaction) — the SQLite file is never touched directly.
 *
 * Identity: (libraryID, itemKey). This is Zotero's stable object identity;
 * composite keys prevent collisions between identical keys in different
 * libraries (e.g. "ABC12345" in My Library vs. a group library).
 *
 * The table is local to this installation: reading status does NOT sync via
 * Zotero sync. This is documented in the README; it avoids polluting the
 * user's tag namespace and works in group libraries where items themselves
 * are read-only.
 *
 * An in-memory cache mirrors the table so the synchronous column data
 * provider never touches the database. A pluggable backend is used so tests
 * can exercise identical logic without Zotero.
 */

/* global Zotero, ZotRead */

ZotRead.Storage = (function () {
	const TABLE = 'zotreadState';

	function makeStorage(backend) {
		/** @type {Map<string, object>} cache keyed by "libraryID:itemKey" */
		let cache = new Map();
		let initialized = false;

		function keyOf(libraryID, itemKey) {
			return libraryID + ':' + itemKey;
		}

		async function init() {
			if (initialized) return;
			await backend.createTable(TABLE);
			let rows = await backend.loadAll(TABLE);
			for (let row of rows) {
				cache.set(keyOf(row.libraryID, row.itemKey), ZotRead.State.normalize(row));
			}
			initialized = true;
		}

		function getSync(libraryID, itemKey) {
			let record = cache.get(keyOf(libraryID, itemKey));
			return record ? ZotRead.State.normalize(record) : ZotRead.State.defaultRecord();
		}

		async function put(libraryID, itemKey, record) {
			record = ZotRead.State.normalize(record);
			cache.set(keyOf(libraryID, itemKey), record);
			await backend.upsert(TABLE, {
				libraryID,
				itemKey,
				read: record.read ? 1 : 0,
				source: record.source,
				firstOpenedAt: record.firstOpenedAt,
				manuallySetAt: record.manuallySetAt
			});
			return record;
		}

		/**
		 * Batch put: single transaction, one cache pass. Used by multi-item
		 * context-menu actions and burst handling.
		 */
		async function putMany(entries) {
			if (!entries.length) return [];
			let normalized = entries.map(e => ({ ...e, record: ZotRead.State.normalize(e.record) }));
			for (let e of normalized) {
				cache.set(keyOf(e.libraryID, e.itemKey), e.record);
			}
			await backend.transaction(async () => {
				for (let e of normalized) {
					await backend.upsert(TABLE, {
						libraryID: e.libraryID,
						itemKey: e.itemKey,
						read: e.record.read ? 1 : 0,
						source: e.record.source,
						firstOpenedAt: e.record.firstOpenedAt,
						manuallySetAt: e.record.manuallySetAt
					});
				}
			});
			return normalized.map(e => e.record);
		}

		/**
		 * Drop stored rows for permanently deleted objects. Rows for unknown
		 * keys are harmless but purging keeps the table small.
		 */
		async function removeMany(keys) {
			if (!keys.length) return;
			for (let k of keys) {
				cache.delete(keyOf(k.libraryID, k.itemKey));
			}
			await backend.removeKeys(TABLE, keys);
		}

		// Test/introspection hooks
		function _cacheSize() {
			return cache.size;
		}

		function _resetForTest() {
			cache = new Map();
			initialized = false;
		}

		return { init, getSync, put, putMany, removeMany, keyOf, _cacheSize, _resetForTest };
	}

	function zoteroBackend() {
		return {
			async createTable(table) {
				await Zotero.DB.queryAsync(
					"CREATE TABLE IF NOT EXISTS " + table + " ("
					+ "libraryID INTEGER NOT NULL, "
					+ "itemKey TEXT NOT NULL, "
					+ "read INTEGER NOT NULL DEFAULT 0, "
					+ "source TEXT NOT NULL DEFAULT 'auto', "
					+ "firstOpenedAt TEXT, "
					+ "manuallySetAt TEXT, "
					+ "PRIMARY KEY (libraryID, itemKey)"
					+ ")"
				);
			},

			async loadAll(table) {
				return Zotero.DB.queryAsync("SELECT libraryID, itemKey, read, source, firstOpenedAt, manuallySetAt FROM " + table);
			},

			async upsert(table, row) {
				await Zotero.DB.queryAsync(
					"INSERT OR REPLACE INTO " + table
					+ " (libraryID, itemKey, read, source, firstOpenedAt, manuallySetAt) VALUES (?, ?, ?, ?, ?, ?)",
					[row.libraryID, row.itemKey, row.read, row.source, row.firstOpenedAt, row.manuallySetAt]
				);
			},

			async transaction(fn) {
				await Zotero.DB.executeTransaction(async () => {
					await fn();
					return true;
				});
			},

			async removeKeys(table, keys) {
				await Zotero.DB.executeTransaction(async () => {
					for (let k of keys) {
						await Zotero.DB.queryAsync(
							"DELETE FROM " + table + " WHERE libraryID = ? AND itemKey = ?",
							[k.libraryID, k.itemKey]
						);
					}
					return true;
				});
			}
		};
	}

	return {
		makeStorage,

		init(backendOverride) {
			this._impl = makeStorage(backendOverride || zoteroBackend());
			return this._impl.init();
		},

		getSync(libraryID, itemKey) {
			return this._impl.getSync(libraryID, itemKey);
		},

		put(libraryID, itemKey, record) {
			return this._impl.put(libraryID, itemKey, record);
		},

		putMany(entries) {
			return this._impl.putMany(entries);
		},

		removeMany(keys) {
			return this._impl.removeMany(keys);
		},

		keyOf(libraryID, itemKey) {
			return this._impl.keyOf(libraryID, itemKey);
		},

		shutdown() {
			this._impl = null;
		}
	};
})();
