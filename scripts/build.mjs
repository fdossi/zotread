// Builds the ZotRead XPI from addon/.
// Run: node scripts/build.mjs
// Output: dist/zotread-<version>.xpi (+ .sha256 checksum file)
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZip } from './lib/zip.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const addonDir = join(root, 'addon');
const distDir = join(root, 'dist');

function walk(dir, base = dir) {
	const files = [];
	for (const name of readdirSync(dir).sort()) {
		if (name === '.' || name === '..' || name.startsWith('.')) continue;
		const full = join(dir, name);
		if (statSync(full).isDirectory()) {
			files.push(...walk(full, base));
		}
		else {
			files.push(full);
		}
	}
	return files;
}

// Read version from the manifest (single source of truth)
const manifest = JSON.parse(readFileSync(join(addonDir, 'manifest.json'), 'utf8'));
const version = manifest.version;

const files = walk(addonDir);
if (!files.length) throw new Error('No files found in addon/');

const entries = files.map(full => ({
	name: relative(addonDir, full).split(sep).join('/'),
	data: readFileSync(full)
}));

// Manifest must be at the archive root
if (!entries.some(e => e.name === 'manifest.json')) {
	throw new Error('manifest.json missing from package root');
}

mkdirSync(distDir, { recursive: true });
const xpiName = `zotread-${version}.xpi`;
const xpiPath = join(distDir, xpiName);
const zip = createZip(entries);
writeFileSync(xpiPath, zip);

const hash = createHash('sha256').update(zip).digest('hex');
writeFileSync(xpiPath + '.sha256', `${hash}  ${xpiName}\n`);

console.log(`Built ${relative(root, xpiPath)} (${zip.length} bytes, ${entries.length} files)`);
console.log(`SHA-256: ${hash}`);
