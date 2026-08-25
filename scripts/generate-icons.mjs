// Generates the ZotRead PNG icons (overlapping green + yellow dots).
// Run: node scripts/generate-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drawIcon } from './lib/png.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'addon', 'icons');
mkdirSync(outDir, { recursive: true });

for (const size of [16, 32, 48, 96]) {
	const png = drawIcon(size);
	writeFileSync(join(outDir, `zotread-${size}.png`), png);
	console.log(`wrote addon/icons/zotread-${size}.png (${png.length} bytes)`);
}
