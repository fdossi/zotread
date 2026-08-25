// Preference-name contract tests.
// Review finding claimed a namespace mismatch between the runtime accessor
// ('zotread.<name>' via Zotero.Prefs) and defaults/pane ('extensions.zotero.
// zotread.<name>'). Verified against Zotero 10 source (xpcom/prefs.js):
// get/set/registerObserver auto-prefix ZOTERO_CONFIG.PREF_BRANCH
// ("extensions.zotero.") unless called with global=true, so BOTH paths hit
// identical keys. These tests pin that contract so future drift fails CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ADDON = join(dirname(fileURLToPath(import.meta.url)), '..', 'addon');
const PREF_NAMES = [
	'autoDetectRead',
	'showAnnotationDots',
	'colorUnread',
	'colorRead',
	'colorAnnotated'
];
const BRANCH = 'extensions.zotero.zotread.';

test('prefs.js defines a default for every known preference on the absolute branch', () => {
	const prefs = readFileSync(join(ADDON, 'prefs.js'), 'utf8');
	for (const name of PREF_NAMES) {
		assert.ok(
			prefs.includes(`pref("${BRANCH}${name}"`),
			`missing default: ${BRANCH}${name}`
		);
	}
});

test('options pane binds the exact absolute preference keys', () => {
	const js = readFileSync(join(ADDON, 'content', 'preferences.js'), 'utf8');
	for (const name of PREF_NAMES) {
		assert.ok(
			js.includes(`'${BRANCH}${name}'`),
			`pane must reference ${BRANCH}${name}`
		);
	}
});

test('runtime accessor composes the relative branch Zotero auto-prefixes', () => {
	const zotread = readFileSync(join(ADDON, 'content', 'zotread.js'), 'utf8');
	assert.match(zotread, /Zotero\.Prefs\.get\('zotread\.'\s*\+\s*name\)/,
		'pref() must read extensions.zotero.zotread.<name> via auto-prefix');
	assert.match(zotread, /Zotero\.Prefs\.set\('zotread\.'\s*\+\s*name/,
		'setPref() must write the same branch');
	assert.match(zotread, /registerObserver\('zotread\.'\s*\+\s*name/,
		'observers must watch the same branch');
});

test('every preference observed or rendered has a shipped default', () => {
	const zotread = readFileSync(join(ADDON, 'content', 'zotread.js'), 'utf8');
	const prefs = readFileSync(join(ADDON, 'prefs.js'), 'utf8');

	const observed = new Set();
	for (const m of zotread.matchAll(/registerPrefObserver\('([\w]+)'/g)) {
		observed.add(m[1]);
	}
	for (const m of zotread.matchAll(/(?:this\.)?pref\('([\w]+)'\)/g)) {
		observed.add(m[1]);
	}
	for (const name of observed) {
		assert.ok(
			prefs.includes(`pref("${BRANCH}${name}"`),
			`'${name}' is used at runtime but has no default in prefs.js`
		);
	}
});
