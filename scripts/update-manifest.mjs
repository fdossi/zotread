// Adds (or replaces) a release entry in updates.json.
// Usage: node scripts/update-manifest.mjs <version> <sha256:hash> <update_link>
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [version, hash, link] = process.argv.slice(2);
if (!version || !hash || !link) {
	console.error('usage: node scripts/update-manifest.mjs <version> <sha256:hash> <update_link>');
	process.exit(1);
}

const path = join(root, 'updates.json');
const data = JSON.parse(readFileSync(path, 'utf8'));
const id = 'zotread@fdossi.github.io';

data[id] ??= { updates: [] };
data[id].updates = data[id].updates
	.filter(u => u.version !== version)
	.concat({ version, update_link: link, update_hash: hash })
	.sort((a, b) => a.version.localeCompare(b.version));

writeFileSync(path, JSON.stringify(data, null, '\t') + '\n');
console.log(`updates.json now lists ${data[id].updates.length} update(s); latest ${version}`);
