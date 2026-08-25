// XPI archive inspection. Runs against dist/zotread-<version>.xpi.
// Skips (with a clear message) when the package has not been built yet;
// `npm run ci` always builds first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip } from '../scripts/lib/zip.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'addon', 'manifest.json'), 'utf8'));
const xpiPath = process.env.ZOTREAD_XPI
	?? join(ROOT, 'dist', `zotread-${manifest.version}.xpi`);

const hasXpi = existsSync(xpiPath);

test('built XPI exists and parses as a ZIP', { skip: !hasXpi && 'build the XPI first: npm run build' }, () => {
	const zip = readZip(readFileSync(xpiPath));
	assert.ok(zip.size > 0);
});

test('generated XPI contains all required files', { skip: !hasXpi && 'build the XPI first' }, () => {
	const zip = readZip(readFileSync(xpiPath));
	const required = [
		'manifest.json',
		'bootstrap.js',
		'prefs.js',
		'content/zotread.js',
		'content/state.js',
		'content/storage.js',
		'content/annotations.js',
		'content/reader.js',
		'content/notifier.js',
		'content/column.js',
		'content/menu.js',
		'content/styles.css',
		'content/preferences.xhtml',
		'content/preferences.js',
		'locale/en-US/zotread.ftl',
		'locale/pt-BR/zotread.ftl'
	];
	for (const name of required) {
		assert.ok(zip.has(name), `missing in XPI: ${name}`);
	}
});

test('packaged manifest matches repository manifest and Zotero 10 target', { skip: !hasXpi && 'build the XPI first' }, () => {
	const packaged = JSON.parse(readZip(readFileSync(xpiPath)).get('manifest.json').toString('utf8'));
	assert.deepEqual(packaged, manifest);
	assert.equal(packaged.applications.zotero.strict_max_version, '10.0.*');
});
