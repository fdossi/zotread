/*
 * ZotRead — reading-status indicators for Zotero 10.
 *
 * Bootstrap entry point. Loads the plugin's content scripts into this scope,
 * then wires up the custom item-tree column, context-menu actions, notifier
 * observers, reader-open detection, stylesheet, localization link and
 * preference pane. Everything is torn down in shutdown().
 */

/* global ZotRead */

var ZotReadScope = { id: null, version: null, rootURI: null };

function log(msg) {
	Zotero.debug("ZotRead: " + msg);
}

function install() {
	log("Installed");
}

async function startup({ id, version, rootURI }) {
	log("Starting " + version);

	ZotReadScope.id = id;
	ZotReadScope.version = version;
	ZotReadScope.rootURI = rootURI;

	// Load content scripts into this scope, in dependency order.
	// Each file attaches its exports to the shared `ZotRead` namespace object.
	Services.scriptloader.loadSubScript(rootURI + 'content/zotread.js');
	Services.scriptloader.loadSubScript(rootURI + 'content/state.js');
	Services.scriptloader.loadSubScript(rootURI + 'content/storage.js');
	Services.scriptloader.loadSubScript(rootURI + 'content/annotations.js');
	Services.scriptloader.loadSubScript(rootURI + 'content/reader.js');
	Services.scriptloader.loadSubScript(rootURI + 'content/notifier.js');
	Services.scriptloader.loadSubScript(rootURI + 'content/column.js');
	Services.scriptloader.loadSubScript(rootURI + 'content/menu.js');

	ZotRead.init({ id, version, rootURI });

	// Preference pane (auto-unregistered on plugin shutdown)
	Zotero.PreferencePanes.register({
		pluginID: id,
		src: rootURI + 'content/preferences.xhtml',
		scripts: [rootURI + 'content/preferences.js']
	});

	await ZotRead.main();
}

/**
 * Called for every main (zoteroPane) window, including windows opened later.
 * `startup()` runs before the first main window finishes loading on app start,
 * so per-window work must happen here.
 */
function onMainWindowLoad({ window }) {
	ZotRead.addToWindow(window);
}

function onMainWindowUnload({ window }) {
	ZotRead.removeFromWindow(window);
}

async function shutdown() {
	log("Shutting down");
	try {
		ZotRead.shutdown();
	}
	catch (e) {
		Zotero.logError(e);
	}
}

function uninstall() {
	log("Uninstalled");
}
