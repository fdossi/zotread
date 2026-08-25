/*
 * ZotRead item context-menu actions (Zotero 10 MenuManager API).
 *
 * Registered for the 'main/library/item' target. Hooks receive a context
 * with `items` (the current selection), `collectionTreeRows` and helpers
 * like setEnabled(). The singular `collectionTreeRow` property throws in
 * Zotero 10 and is never read here.
 *
 * Actions operate on every eligible regular item of the selection, so
 * single- and multi-item selections behave uniformly. Inappropriate actions
 * are disabled when the selection contains no eligible items.
 */

/* global Zotero, ZotRead */

ZotRead.Menu = (function () {
	const MENU_ID = 'zotread-item-menu';

	function makeMenu(deps) {
		let registered = false;

		/** Regular items only; child notes/attachments/annotations excluded. */
		function eligibleItems(items) {
			return (items || []).filter(item => item && item.isRegularItem && item.isRegularItem());
		}

		async function onMarkRead(event, context) {
			await deps.applyManualRead(eligibleItems(context.items));
		}

		async function onMarkUnread(event, context) {
			await deps.applyManualUnread(eligibleItems(context.items));
		}

		async function onToggleRead(event, context) {
			await deps.applyToggleRead(eligibleItems(context.items));
		}

		async function onRefreshAnnotations(event, context) {
			await deps.refreshAnnotationStatus(context.items || []);
		}

		function onShowing(event, context) {
			let eligible = eligibleItems(context.items);
			if (context.setEnabled) {
				context.setEnabled(eligible.length > 0);
			}
		}

		function register() {
			deps.registerMenu({
				menuID: MENU_ID,
				pluginID: deps.pluginID,
				target: 'main/library/item',
				menus: [
					{
						menuType: 'menuitem',
						l10nID: 'zotread-menu-mark-read',
						onShowing,
						onCommand: onMarkRead
					},
					{
						menuType: 'menuitem',
						l10nID: 'zotread-menu-mark-unread',
						onShowing,
						onCommand: onMarkUnread
					},
					{
						menuType: 'menuitem',
						l10nID: 'zotread-menu-toggle-read',
						onShowing,
						onCommand: onToggleRead
					},
					{
						menuType: 'menuitem',
						l10nID: 'zotread-menu-refresh-annotations',
						onShowing,
						onCommand: onRefreshAnnotations
					}
				]
			});
			registered = true;
		}

		function unregister() {
			if (registered) {
				try {
					deps.unregisterMenu(MENU_ID);
				}
				catch (e) {
					deps.logError(e);
				}
				registered = false;
			}
		}

		return { register, unregister, eligibleItems };
	}

	return {
		makeMenu,

		register() {
			this._impl = makeMenu({
				pluginID: ZotRead.ID,
				registerMenu: opts => Zotero.MenuManager.registerMenu(opts),
				unregisterMenu: id => Zotero.MenuManager.unregisterMenu(id),
				applyManualRead: items => ZotRead.applyManualRead(items),
				applyManualUnread: items => ZotRead.applyManualUnread(items),
				applyToggleRead: items => ZotRead.applyToggleRead(items),
				refreshAnnotationStatus: items => ZotRead.refreshAnnotationStatus(items),
				logError: e => Zotero.logError(e)
			});
			this._impl.register();
		},

		unregister() {
			if (this._impl) {
				this._impl.unregister();
				this._impl = null;
			}
		},

		eligibleItems(items) {
			return this._impl ? this._impl.eligibleItems(items) : [];
		}
	};
})();
