// Verifies a built XPI: required files, manifest consistency, locales,
// plugin-ID consistency across packaged resources.
// Run: node scripts/verify-package.mjs [path-to-xpi]
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readZip } from './lib/zip.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const argPath = process.argv[2];
let xpiPath = argPath;
if (!xpiPath) {
	const { version } = JSON.parse(readFileSync(join(root, 'addon', 'manifest.json'), 'utf8'));
	xpiPath = join(root, 'dist', `zotread-${version}.xpi`);
}
if (!existsSync(xpiPath)) {
	console.error(`XPI not found: ${xpiPath}`);
	process.exit(1);
}

const zip = readZip(readFileSync(xpiPath));
const names = [...zip.keys()];

const errors = [];
const check = (cond, msg) => {
	if (!cond) errors.push(msg);
};

// 1. Required files
for (const required of [
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
]) {
	check(names.includes(required), `missing required file: ${required}`);
}

// 2. Manifest validity for Zotero 10
const manifest = JSON.parse(zip.get('manifest.json').toString('utf8'));
check(manifest.manifest_version === 2, 'manifest_version must be 2');
const app = manifest.applications?.zotero;
check(!!app, 'applications.zotero missing');
if (app) {
	check(app.id === 'zotread@fdossi.github.io', `unexpected plugin id: ${app.id}`);
	check(app.strict_max_version === '10.0.*', `strict_max_version must be "10.0.*", got ${app.strict_max_version}`);
	check(/^\d+\.\d+/.test(app.strict_min_version || ''), 'strict_min_version missing');
	check(typeof app.update_url === 'string' && app.update_url.startsWith('https://'), 'update_url must be HTTPS');
}
check(/^\d+\.\d+\.\d+$/.test(manifest.version), `version must be semver-ish, got ${manifest.version}`);

// 3. Icons referenced by the manifest exist in the package
for (const icon of Object.values(manifest.icons || {})) {
	check(names.includes(icon), `icon listed in manifest but missing: ${icon}`);
}

// 4. Locale parity: en-US and pt-BR define the same message IDs
function ftlIDs(buf) {
	const ids = new Set();
	for (const line of buf.toString('utf8').split(/\r?\n/)) {
		const m = /^([A-Za-z][\w-]*)\s*=/.exec(line);
		if (m) ids.add(m[1]);
	}
	return ids;
}
const en = ftlIDs(zip.get('locale/en-US/zotread.ftl'));
const pt = ftlIDs(zip.get('locale/pt-BR/zotread.ftl'));
for (const id of en) check(pt.has(id), `pt-BR missing message: ${id}`);
for (const id of pt) check(en.has(id), `en-US missing message: ${id}`);
check(en.size >= 10, `expected at least 10 localized messages, found ${en.size}`);

// 5. Plugin ID consistency across code and locale-independent metadata
const allCode = ['bootstrap.js', ...names.filter(n => n.startsWith('content/') && n.endsWith('.js'))]
	.map(n => zip.get(n).toString('utf8'))
	.join('\n');
// Plugin ID should never be hardcoded inconsistently (it comes from manifest)
check(!allCode.includes("pluginID: '"), 'code must take pluginID from the manifest/bootstrap params');
const updatesPath = join(root, 'updates.json');
if (existsSync(updatesPath)) {
	const updates = JSON.parse(readFileSync(updatesPath, 'utf8'));
	check(Object.keys(updates).includes(app?.id), 'updates.json must key by plugin id');
}

// 6. Checksum file matches when sitting next to the XPI
const shaPath = xpiPath + '.sha256';
if (existsSync(shaPath)) {
	const expected = createHash('sha256').update(readFileSync(xpiPath)).digest('hex');
	const recorded = readFileSync(shaPath, 'utf8').trim().split(/\s+/)[0];
	check(expected === recorded, `checksum mismatch: ${recorded} != ${expected}`);
}

// Report
console.log(`Verified ${xpiPath}`);
console.log(`Entries (${names.length}):`);
for (const n of names.sort()) console.log(`  ${n}`);

if (errors.length) {
	console.error('\nFAILURES:');
	for (const e of errors) console.error(' - ' + e);
	process.exit(1);
}
console.log('\nAll package checks passed.');
