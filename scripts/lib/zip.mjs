// Minimal ZIP writer/reader using only Node stdlib (zlib).
// Deterministic output: fixed timestamps and no extra fields.
import { deflateRawSync, inflateRawSync } from 'node:zlib';

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[n] = c >>> 0;
	}
	return table;
})();

export function crc32(buf) {
	let c = 0xffffffff;
	for (let i = 0; i < buf.length; i++) {
		c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	}
	return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date(2026, 0, 1, 0, 0, 0)) {
	const time =
		((date.getHours() & 0x1f) << 11) |
		((date.getMinutes() & 0x3f) << 5) |
		((Math.floor(date.getSeconds() / 2)) & 0x1f);
	const day =
		(((date.getFullYear() - 1980) & 0x7f) << 9) |
		(((date.getMonth() + 1) & 0xf) << 5) |
		(date.getDate() & 0x1f);
	return { time, day };
}

/**
 * Create a ZIP archive buffer from entries.
 * @param {Array<{name: string, data: Buffer|Uint8Array|string}>} entries
 * @returns {Buffer}
 */
export function createZip(entries) {
	const chunks = [];
	const central = [];
	let offset = 0;
	const { time, day } = dosDateTime();

	for (const entry of entries) {
		const nameBuf = Buffer.from(entry.name, 'utf8');
		let raw;
		if (Buffer.isBuffer(entry.data)) {
			raw = entry.data;
		}
		else if (entry.data instanceof Uint8Array) {
			raw = Buffer.from(entry.data);
		}
		else {
			raw = Buffer.from(String(entry.data), 'utf8');
		}
		const deflated = deflateRawSync(raw, { level: 9 });
		const useDeflate = deflated.length < raw.length;
		const payload = useDeflate ? deflated : raw;
		const method = useDeflate ? 8 : 0;
		const crc = crc32(raw);

		const local = Buffer.alloc(30);
		local.writeUInt32LE(SIG_LOCAL, 0);
		local.writeUInt16LE(20, 4); // version needed
		local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
		local.writeUInt16LE(method, 8);
		local.writeUInt16LE(time, 10);
		local.writeUInt16LE(day, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(payload.length, 18);
		local.writeUInt32LE(raw.length, 22);
		local.writeUInt16LE(nameBuf.length, 26);
		local.writeUInt16LE(0, 28);

		chunks.push(local, nameBuf, payload);

		const centralHeader = Buffer.alloc(46);
		centralHeader.writeUInt32LE(SIG_CENTRAL, 0);
		centralHeader.writeUInt16LE(20, 4); // version made by
		centralHeader.writeUInt16LE(20, 6); // version needed
		centralHeader.writeUInt16LE(0x0800, 8); // flags
		centralHeader.writeUInt16LE(method, 10);
		centralHeader.writeUInt16LE(time, 12);
		centralHeader.writeUInt16LE(day, 14);
		centralHeader.writeUInt32LE(crc, 16);
		centralHeader.writeUInt32LE(payload.length, 20);
		centralHeader.writeUInt32LE(raw.length, 24);
		centralHeader.writeUInt16LE(nameBuf.length, 28);
		centralHeader.writeUInt16LE(0, 30); // extra
		centralHeader.writeUInt16LE(0, 32); // comment
		centralHeader.writeUInt16LE(0, 34); // disk number
		centralHeader.writeUInt16LE(0, 36); // internal attrs
		centralHeader.writeUInt32LE(0, 38); // external attrs
		centralHeader.writeUInt32LE(offset, 42); // local header offset

		central.push(centralHeader, nameBuf);

		offset += local.length + nameBuf.length + payload.length;
	}

	let centralSize = 0;
	for (const buf of central) centralSize += buf.length;

	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(SIG_EOCD, 0);
	eocd.writeUInt16LE(0, 4);
	eocd.writeUInt16LE(0, 6);
	eocd.writeUInt16LE(entries.length, 8);
	eocd.writeUInt16LE(entries.length, 10);
	eocd.writeUInt32LE(centralSize, 12);
	eocd.writeUInt32LE(offset, 16); // central dir offset
	eocd.writeUInt16LE(0, 20);

	return Buffer.concat([...chunks, ...central, eocd]);
}

/**
 * Read all entries of a ZIP buffer.
 * @param {Buffer} buf
 * @returns {Map<string, Buffer>} name -> content
 */
export function readZip(buf) {
	// Find EOCD
	let eocdOffset = -1;
	const minEOCD = Math.max(0, buf.length - 22 - 65535);
	for (let i = buf.length - 22; i >= minEOCD; i--) {
		if (buf.readUInt32LE(i) === SIG_EOCD) {
			eocdOffset = i;
			break;
		}
	}
	if (eocdOffset < 0) throw new Error('Not a ZIP file (no EOCD)');

	const count = buf.readUInt16LE(eocdOffset + 10);
	const centralOffset = buf.readUInt32LE(eocdOffset + 16);

	const files = new Map();
	let p = centralOffset;
	for (let i = 0; i < count; i++) {
		if (buf.readUInt32LE(p) !== SIG_CENTRAL) throw new Error('Bad central directory at ' + p);
		const method = buf.readUInt16LE(p + 10);
		const compSize = buf.readUInt32LE(p + 20);
		const nameLen = buf.readUInt16LE(p + 28);
		const extraLen = buf.readUInt16LE(p + 30);
		const commentLen = buf.readUInt16LE(p + 32);
		const localOffset = buf.readUInt32LE(p + 42);
		const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

		const localNameLen = buf.readUInt16LE(localOffset + 26);
		const localExtraLen = buf.readUInt16LE(localOffset + 28);
		const dataStart = localOffset + 30 + localNameLen + localExtraLen;
		const data = buf.subarray(dataStart, dataStart + compSize);

		files.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
		p += 46 + nameLen + extraLen + commentLen;
	}
	return files;
}
