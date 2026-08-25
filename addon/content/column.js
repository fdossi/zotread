/*
 * ZotRead item-tree column.
 *
 * Zotero 10 exposes no row-decoration hook capable of drawing content left
 * of the title, so the supported mechanism is a dedicated narrow custom
 * column registered through Zotero.ItemTreeManager.registerColumn(). There
 * is no supported parameter to place it leftmost automatically; the user
 * drags it into position once and Zotero persists the order (README covers
 * this honestly). The column supports sorting via its data provider.
 *
 * Rendering notes:
 *  - renderCell is only invoked for object rows; library-header and spacer
 *    rows override renderRow entirely, so they can never show indicators.
 *  - Indicators are drawn only for eligible bibliographic items (regular
 *    items); child attachments/notes/annotations show nothing.
 *  - The two-dot state overlaps by exactly 20% of one dot's diameter using
 *    margin-inline-start (RTL-aware): 10 px dots overlap by -2 px.
 *  - Colors come from preferences at render time; tooltips and accessible
 *    names describe status so color is never the only signal.
 */

/* global Zotero, ZotRead */

ZotRead.Column = (function () {
	const DATA_KEY = 'status';
	const DOT_SIZE = 10;
	const OVERLAP_PX = Math.round(DOT_SIZE * 0.20); // 2 px = 20% of diameter

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

			let container = doc.createElement('span');
			container.className = 'zotread-dots';
			container.setAttribute('role', 'img');

			if (data === ZotRead.STATUS.UNREAD) {
				container.appendChild(makeDot(doc, c.unread));
				container.setAttribute('aria-label', labels.unread);
				container.setAttribute('title', labels.unread);
			}
			else if (data === ZotRead.STATUS.READ) {
				container.appendChild(makeDot(doc, c.read));
				container.setAttribute('aria-label', labels.read);
				container.setAttribute('title', labels.read);
			}
			else if (data === ZotRead.STATUS.ANNOTATED) {
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

		return { register, unregister, refreshAll, dataProvider, renderCell, OVERLAP_PX, DOT_SIZE };
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

		get key() {
			return this._key;
		}
	};
})();
