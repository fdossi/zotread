/*
 * Reader-open detection for ZotRead.
 *
 * Primary path (fully supported): the notifier emits 'add' and 'select'
 * events of type 'tab' when a reader tab opens or becomes active. The reader
 * for a tab is resolved with the public Zotero.Reader.getByTabID(); its
 * `itemID` is the attachment being displayed.
 *
 * Secondary path (best effort, documented): attachments opened in separate
 * reader windows do not produce tab events. A window watcher notices new
 * 'zotero:reader' windows and resolves their items from the reader instance
 * Zotero attaches to the chrome window itself (ReaderWindow sets
 * `window.reader = this`, xpcom/reader.js) - no private Zotero internals are
 * touched. If resolution fails the open is simply not counted; nothing
 * breaks.
 *
 * Important honesty note (also in README): "opened" means exactly that. It
 * does not prove the content was read; no scroll/attention tracking exists.
 */

/* global Zotero, Services, ZotRead */

ZotRead.Reader = (function () {
	function makeReader(deps) {
		let processedReaders = new WeakSet();
		let wmListener = null;

		/** Handle one attachment-or-parent item ID coming from a reader. */
		async function handleAttachmentOpened(attachmentItemID) {
			if (!deps.autoDetectEnabled()) {
				return;
			}
			let item = Zotero.Items.get(attachmentItemID);
			if (!item) return;
			await deps.applyOpened([item]);
		}

		async function onTabEvent(event, type, ids) {
			if (!['add', 'select'].includes(event)) {
				return;
			}
			for (let tabID of ids) {
				try {
					let reader = Zotero.Reader.getByTabID(tabID);
					if (reader && reader.itemID && !processedReaders.has(reader)) {
						processedReaders.add(reader);
						await handleAttachmentOpened(reader.itemID);
					}
					else if (reader && reader.itemID && event === 'select') {
						// Re-selecting an already-open tab should still count as
						// opening (e.g., first select after restore).
						await handleAttachmentOpened(reader.itemID);
					}
				}
				catch (e) {
					deps.logError(e);
				}
			}
		}

		/**
		 * Best effort for standalone reader windows. The xul window's load
		 * handler reads the reader instance Zotero assigned to the window
		 * (window.reader); retries give the instance time to register itself.
		 */
		async function scanReaderWindow(domWindow) {
			try {
				let reader = domWindow.reader;
				if (!reader || !reader.itemID || processedReaders.has(reader)) {
					return;
				}
				processedReaders.add(reader);
				await handleAttachmentOpened(reader.itemID);
			}
			catch (e) {
				deps.logError(e);
			}
		}

		function init() {
			wmListener = {
				onOpenWindow(xulWindow) {
					let domWindow = xulWindow.docShell.domWindow;
					domWindow.addEventListener('load', function onload() {
						domWindow.removeEventListener('load', onload);
						try {
							let href = domWindow.location.href || '';
							if (!href.includes('reader.xhtml')) {
								return;
							}
							// Give the reader instance a moment to register itself
							domWindow.setTimeout(() => scanReaderWindow(domWindow), 1500);
							domWindow.setTimeout(() => scanReaderWindow(domWindow), 4000);
						}
						catch (e) {
							deps.logError(e);
						}
					});
				}
			};
			Services.wm.addListener(wmListener);
		}

		function shutdown() {
			if (wmListener) {
				Services.wm.removeListener(wmListener);
				wmListener = null;
			}
		}

		return { onTabEvent, scanReaderWindow, init, shutdown };
	}

	return {
		makeReader,

		init() {
			this._impl = makeReader({
				autoDetectEnabled: () => ZotRead.pref('autoDetectRead'),
				applyOpened: items => ZotRead.applyOpened(items),
				logError: e => Zotero.logError(e)
			});

			this._notifierID = Zotero.Notifier.registerObserver(
				{
					notify: (event, type, ids) => {
						if (type !== 'tab') return;
						this._impl.onTabEvent(event, type, ids);
					}
				},
				['tab'],
				'zotread-reader'
			);

			this._impl.init();
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
