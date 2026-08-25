/*
 * Notifier wiring for ZotRead.
 *
 * Listens to library 'item' events and keeps annotation aggregation correct
 * with incremental, batched updates:
 *
 *  - add/modify of annotations or attachments -> recompute affected parents
 *    (debounced: imports and sync can fire bursts of hundreds of events)
 *  - add of an annotation additionally marks its bibliographic parent read
 *    ("Automatic read detection"; gated by autoDetectRead)
 *  - delete/erase of annotations -> same; removing the final qualifying
 *    annotation drops the yellow dot while preserving the read state
 *  - permanent deletion of items -> purge stored state rows
 *
 * No event loops are possible: ZotRead writes only to its own storage table,
 * never back to item data; its own visual 'redraw' notifications are not of
 * a type this observer handles.
 */

/* global Zotero, ZotRead */

ZotRead.Notifier = (function () {
	function makeNotifier(deps) {
		let pendingParents = new Set();
		let flushTimer = null;

		function scheduleFlush() {
			if (flushTimer) return;
			flushTimer = deps.setTimeout(() => {
				flushTimer = null;
				let ids = [...pendingParents];
				pendingParents.clear();
				deps.refreshRows(ids);
			}, deps.DEBOUNCE_MS);
		}

		async function notify(event, type, ids, extraData) {
			if (type !== 'item') return;

			try {
				if (['add', 'modify'].includes(event)) {
					// Annotation saves, sync merges, attachment changes, etc.
					let items = Zotero.Items.get(ids.filter(id => Zotero.Items.exists(id)));
					if (event === 'add') {
						// Policy: creating an annotation marks its bibliographic
						// parent read. The dep applies the pref gate and storage
						// write; affected parents join the debounced repaint.
						try {
							let res = await deps.applyAnnotationCreated(items);
							for (let id of res.parents) {
								pendingParents.add(id);
							}
						}
						catch (e) {
							deps.logError(e);
						}
					}
					let parentIDs = deps.resolveParentIDs(items);
					deps.invalidate(parentIDs);
					for (let id of parentIDs) {
						pendingParents.add(id);
					}
					if (parentIDs.length) {
						scheduleFlush();
					}
					return;
				}

				if (event === 'delete' || event === 'trash') {
					// Annotations disappearing: invalidate their parents. The
					// deleted items themselves are already gone from memory,
					// so resolve via extraData keys where available.
					for (let id of ids) {
						// extraData[id].libraryID/key identify erased annotations;
						// we cannot always reconstruct the parent cheaply, so do a
						// targeted full invalidation only when needed.
						if (extraData && extraData[id] && extraData[id].parentItemID) {
							pendingParents.add(extraData[id].parentItemID);
						}
					}
					if (ids.length) {
						deps.invalidateAll();
						scheduleFlush();
					}
					return;
				}

				if (event === 'remove' && ids.length) {
					// Child removal (e.g., attachment detached from parent):
					// conservative invalidation keeps aggregates honest.
					deps.invalidateAll();
					scheduleFlush();
				}
			}
			catch (e) {
				deps.logError(e);
			}
		}

		/**
		 * Purge stored rows for permanently deleted items ('delete' events
		 * carry libraryID/key in extraData).
		 */
		async function purgeDeleted(event, type, ids, extraData) {
			if (type !== 'item' || event !== 'delete' || !ids.length) return;
			let keys = [];
			for (let id of ids) {
				let info = extraData && extraData[id];
				if (info && info.libraryID && info.key) {
					keys.push({ libraryID: info.libraryID, itemKey: info.key });
				}
			}
			await deps.removeStored(keys);
		}

		function shutdown() {
			if (flushTimer) {
				deps.clearTimeout(flushTimer);
				flushTimer = null;
			}
			pendingParents.clear();
		}

		return { notify, purgeDeleted, shutdown };
	}

	return {
		makeNotifier,

		init() {
			this._impl = makeNotifier({
				DEBOUNCE_MS: 250,
				setTimeout: (fn, ms) => setTimeout(fn, ms),
				clearTimeout: t => clearTimeout(t),
				resolveParentIDs: items => ZotRead.Annotations.resolveParentIDs(items),
				applyAnnotationCreated: items => ZotRead.applyAnnotationCreated(items),
				invalidate: ids => ZotRead.Annotations.invalidate(ids),
				invalidateAll: () => ZotRead.Annotations.invalidateAll(),
				refreshRows: ids => ZotRead.refreshRows(ids),
				removeStored: keys => ZotRead.Storage.removeMany(keys),
				logError: e => Zotero.logError(e)
			});

			this._observer = {
				notify: (event, type, ids, extraData) => {
					this._impl.notify(event, type, ids, extraData);
					this._impl.purgeDeleted(event, type, ids, extraData);
				}
			};
			this._notifierID = Zotero.Notifier.registerObserver(
				this._observer,
				['item'],
				'zotread-items'
			);
		},

		shutdown() {
			if (this._notifierID) {
				Zotero.Notifier.unregisterObserver(this._notifierID);
				this._notifierID = null;
			}
			if (this._impl) {
				this._impl.shutdown();
				this._impl = null;
			}
		}
	};
})();
