// Minimal PNG writer (truecolor + alpha) for generating ZotRead icons
// without external dependencies.
import { deflateRawSync } from 'node:zlib';
import { crc32 } from './zip.mjs';

function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length, 0);
	const typeBuf = Buffer.from(type, 'ascii');
	const body = Buffer.concat([typeBuf, data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body), 0);
	return Buffer.concat([len, body, crc]);
}

/**
 * Encode RGBA pixel data as PNG.
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} rgba length = width*height*4
 */
export function encodePNG(width, height, rgba) {
	const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // color type RGBA
	ihdr[10] = 0; // compression
	ihdr[11] = 0; // filter
	ihdr[12] = 0; // interlace

	// Raw scanlines with filter byte 0
	const raw = Buffer.alloc(height * (1 + width * 4));
	for (let y = 0; y < height; y++) {
		raw[y * (1 + width * 4)] = 0;
		rgba.subarray(y * width * 4, (y + 1) * width * 4)
			.forEach((v, i) => {
				raw[y * (1 + width * 4) + 1 + i] = v;
			});
	}

	return Buffer.concat([
		sig,
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateRawSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0))
	]);
}

/** Signed distance coverage for an antialiased circle. */
function circleCoverage(px, py, cx, cy, radius) {
	const d = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
	return Math.min(1, Math.max(0, radius - d + 0.5));
}

function hexToRgb(hex) {
	const m = /^#([0-9a-f]{6})$/i.exec(hex);
	if (!m) throw new Error('Bad color: ' + hex);
	return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
}

/**
 * Draw the ZotRead mark: green dot with yellow dot overlapping by exactly
 * 20% of one dot's diameter.
 * @param {number} size canvas size in px
 * @param {{read?: string, annotated?: string}} colors
 * @returns {Buffer} PNG buffer
 */
export function drawIcon(size, { read = '#66BB6A', annotated = '#FBC02D' } = {}) {
	const rgba = new Uint8Array(size * size * 4);

	// Layout mirrors the column indicator:
	//   dot diameter D, overlap O = 20% D, combined width W = 2D - O.
	// Scale everything from a base 18x10 layout.
	const D = size * (10 / 18); // dot diameter relative to combined width
	const O = D * 0.2;
	const W = 2 * D - O;
	const H = D;
	const x0 = (size - W) / 2;
	const y0 = (size - H) / 2;

	const greenC = hexToRgb(read);
	const yellowC = hexToRgb(annotated);

	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const px = x + 0.5;
			const py = y + 0.5;
			const cxg = x0 + D / 2;
			const cxy = x0 + D / 2 + (D - O);
			let covG = circleCoverage(px, py, cxg, y0 + D / 2, D / 2);
			let covY = circleCoverage(px, py, cxy, y0 + D / 2, D / 2);
			// Yellow drawn on top where both cover
			const covTotal = Math.min(1, covG + covY);
			if (covTotal <= 0) continue;
			const mixY = covY > 0 ? covY / Math.max(covTotal, covG + covY) : 0;
			const r = greenC[0] * (covG * (1 - mixY)) + yellowC[0] * covY;
			const g = greenC[1] * (covG * (1 - mixY)) + yellowC[1] * covY;
			const b = greenC[2] * (covG * (1 - mixY)) + yellowC[2] * covY;
			const denom = Math.max(covG * (1 - mixY) + covY, 1e-6);
			const idx = (y * size + x) * 4;
			rgba[idx] = Math.round(r / denom);
			rgba[idx + 1] = Math.round(g / denom);
			rgba[idx + 2] = Math.round(b / denom);
			rgba[idx + 3] = Math.round(covTotal * 255);
		}
	}

	return encodePNG(size, size, rgba);
}
