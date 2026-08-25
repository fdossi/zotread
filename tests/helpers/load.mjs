// Test helper: loads the exact shipped addon content scripts into a VM
// sandbox so unit/integration tests exercise the real code, unmodified.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ADDON_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'addon');

export function readAddon(relPath) {
	return readFileSync(join(ADDON_DIR, relPath), 'utf8');
}

/**
 * Load content scripts in order into a fresh sandbox.
 * @param {string[]} relPaths e.g. ['content/state.js']
 * @param {object} globals extra sandbox globals (Zotero stub, etc.)
 */
export function loadScripts(relPaths, globals = {}) {
	const context = vm.createContext({
		console,
		setTimeout(fn) { return fn(); },
		clearTimeout() {},
		...globals
	});
	for (const rel of relPaths) {
		vm.runInContext(readAddon(rel), context, { filename: rel });
	}
	return context;
}

/** Load namespace + state + storage + annotations + notifier modules. */
export function loadCoreModules(zoteroStub) {
	return loadScripts(
		[
			'content/zotread.js',
			'content/state.js',
			'content/storage.js',
			'content/annotations.js',
			'content/notifier.js'
		],
		{ Zotero: zoteroStub }
	);
}

/** Minimal DOM-free element recorder for renderCell tests. */
export function makeFakeDoc(l10nTable) {
	function element(tag) {
		return {
			tag,
			className: '',
			style: {},
			children: [],
			attrs: new Map(),
			append(child) { this.children.push(child); },
			appendChild(child) { this.children.push(child); },
			setAttribute(name, value) { this.attrs.set(name, String(value)); },
			getAttribute(name) { return this.attrs.get(name); },
			removeAttribute(name) { this.attrs.delete(name); }
		};
	}
	const table = l10nTable ?? {
		'zotread-status-unread': 'Não lido',
		'zotread-status-read': 'Lido',
		'zotread-status-annotated': 'Lido e anotado'
	};
	return {
		createElement: element,
		defaultView: {
			document: {
				l10n: {
					formatValueSync(id) {
						if (id in table) return table[id];
						throw new Error('missing message: ' + id);
					}
				}
			}
		}
	};
}
