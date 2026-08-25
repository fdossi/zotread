// Manifest, prefs and localization source validation (Zotero 10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ADDON = join(ROOT, 'addon');

const manifest = JSON.parse(readFileSync(join(ADDON, 'manifest.json'), 'utf8'));

test('manifest declares valid Zotero 10 compatibility', () => {
	assert.equal(manifest.manifest_version, 2);
	const app = manifest.applications?.zotero;
	assert.ok(app, 'applications.zotero required');
	assert.equal(app.id, 'zotread@fdossi.github.io');
	assert.equal(app.strict_max_version, '10.0.*');
	assert.ok(
		typeof app.strict_min_version === 'string' && /^\d+\.\d+$/.test(app.strict_min_version),
		'strict_min_version must be a plain version'
	);
});

test('manifest update URL is HTTPS and points at the stable updates manifest', () => {
	const url = new URL(manifest.applications.zotero.update_url);
	assert.equal(url.protocol, 'https:');
	assert.ok(url.pathname.endsWith('/updates.json'));
});

test('plugin id is consistent across manifest and code references', () => {
	const sources = [
		'bootstrap.js',
		'content/zotread.js',
		'content/column.js',
		'content/menu.js'
	];
	for (const rel of sources) {
		const src = readFileSync(join(ADDON, rel), 'utf8');
		assert.ok(!src.includes('make-it-red@example.com'), `${rel} must not leak sample IDs`);
	}
});

test('prefs.js defines defaults under the zotread branch', () => {
	const prefs = readFileSync(join(ADDON, 'prefs.js'), 'utf8');
	for (const name of ['autoDetectRead', 'showAnnotationDots', 'colorUnread', 'colorRead', 'colorAnnotated']) {
		assert.ok(
			prefs.includes(`extensions.zotero.zotread.${name}`),
			`missing default pref: ${name}`
		);
	}
});

test('default colors match the accessible palette from the spec', () => {
	const prefs = readFileSync(join(ADDON, 'prefs.js'), 'utf8');
	assert.match(prefs, /colorUnred|colorUnread", "#E53935"|colorUnread", '#E53935'/);
	assert.match(prefs, /#66BB6A/);
	assert.match(prefs, /#FBC02D/);
});

test('localization resources define identical message sets in en-US and pt-BR', () => {
	function ids(file) {
		const set = new Set();
		for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
			const m = /^([A-Za-z][\w-]*)\s*=/.exec(line);
			if (m) set.add(m[1]);
		}
		return set;
	}
	const en = ids(join(ADDON, 'locale', 'en-US', 'zotread.ftl'));
	const pt = ids(join(ADDON, 'locale', 'pt-BR', 'zotread.ftl'));
	assert.deepEqual([...en].sort(), [...pt].sort(), 'message IDs must match across locales');
	for (const required of [
		'zotread-column-label',
		'zotread-status-unread',
		'zotread-status-read',
		'zotread-status-annotated',
		'zotread-menu-mark-read',
		'zotread-menu-mark-unread',
		'zotread-menu-refresh-annotations'
	]) {
		assert.ok(en.has(required), `missing localized message: ${required}`);
	}
});
