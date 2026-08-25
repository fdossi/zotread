// Geometry + accessibility tests for the indicator column renderer.
// The overlap contract: dots of 10 px whose centers are 8 px apart, i.e. an
// overlap of exactly 2 px = 20% of one dot's diameter; combined width 18 px.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScripts, makeFakeDoc } from './helpers/load.mjs';

const CSS_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'addon', 'content', 'styles.css');

const ctx = loadScripts(['content/zotread.js', 'content/state.js', 'content/column.js']);
const ColumnFactory = ctx.ZotRead.Column.makeColumn;
const STATUS = ctx.ZotRead.STATUS;

function makeColumn(overrides = {}) {
	return ColumnFactory({
		pluginID: 'zotread@fdossi.github.io',
		pref: name => ({
			colorUnread: '#E53935',
			colorRead: '#66BB6A',
			colorAnnotated: '#FBC02D'
		}[name]),
		formatString: (win, id, args, fallback) => fallback,
		getRecord: () => ({ read: false }),
		hasAnnotations: () => false,
		registerColumn: opts => {
			overrides.registeredOptions = opts;
			return 'zotread@fdossi.github.io_status';
		},
		unregisterColumn: () => true,
		getMainWindows: () => [],
		logError(e) { throw e; },
		...overrides
	});
}

function render(columnImpl, data) {
	const doc = makeFakeDoc();
	const cell = columnImpl.renderCell(0, data, {}, false, doc);
	return { doc, cell };
}

test('geometry constants encode exactly 20% overlap', () => {
	const impl = makeColumn();
	assert.equal(impl.DOT_SIZE, 10);
	assert.equal(impl.OVERLAP_PX, 2); // 20% of 10 px
	assert.equal(impl.DOT_SIZE - impl.OVERLAP_PX, 8, 'center-to-center distance');
	assert.equal(impl.DOT_SIZE * 2 - impl.OVERLAP_PX, 18, 'combined width');
});

test('annotated state: green first, yellow second, overlapping by -2px inline-start', () => {
	const impl = makeColumn();
	const { cell } = render(impl, STATUS.ANNOTATED);

	const container = cell.children[0];
	assert.equal(container.className, 'zotread-dots');
	const [green, yellow] = container.children;

	assert.ok(green.className.includes('zotread-dot-green'), 'green dot first');
	assert.ok(yellow.className.includes('zotread-dot-annotated'), 'yellow dot second');
	assert.equal(yellow.style.marginInlineStart, '-2px', 'overlap must be exactly -2px (20% of 10px)');
	assert.equal(green.style.backgroundColor, '#66BB6A');
	assert.equal(yellow.style.backgroundColor, '#FBC02D');

	// Both dots are 10x10
	for (const dot of [green, yellow]) {
		assert.equal(dot.style.width, '10px');
		assert.equal(dot.style.height, '10px');
	}
});

test('single-dot states render one dot with correct colors', () => {
	const impl = makeColumn();

	const unread = render(impl, STATUS.UNREAD).cell.children[0];
	assert.equal(unread.children.length, 1);
	assert.equal(unread.children[0].style.backgroundColor, '#E53935');

	const read = render(impl, STATUS.READ).cell.children[0];
	assert.equal(read.children.length, 1);
	assert.equal(read.children[0].style.backgroundColor, '#66BB6A');
});

test('no layout shift between one and two indicators', () => {
	// The CSS contract fixes the container to the combined two-dot width so a
	// single red/green dot occupies the same cell footprint as the pair.
	const css = readFileSync(CSS_PATH, 'utf8');
	assert.match(css, /\.zotread-dots\s*{[^}]*width:\s*18px/);
});

test('accessibility: aria-label and title describe status; color is not the only signal', () => {
	const impl = makeColumn();

	const unread = render(impl, STATUS.UNREAD).cell.children[0];
	assert.equal(unread.attrs.get('role'), 'img');
	assert.equal(unread.attrs.get('aria-label'), 'Unread');
	assert.equal(unread.attrs.get('title'), 'Unread');

	const annotated = render(impl, STATUS.ANNOTATED).cell.children[0];
	assert.equal(annotated.attrs.get('aria-label'), 'Read and annotated');
	assert.equal(annotated.attrs.get('title'), 'Read and annotated');
});

test('localized labels come from Fluent when available', () => {
	// This column's formatString mirrors production behavior: resolve via
	// window document l10n first, fall back to English.
	const doc = makeFakeDoc();
	const impl = makeColumn({
		formatString: (win, id, args, fallback) => {
			try {
				return win.document.l10n.formatValueSync(id) || fallback;
			}
			catch {
				return fallback;
			}
		}
	});
	const annotated = impl.renderCell(0, STATUS.ANNOTATED, {}, false, doc).children[0];
	assert.equal(annotated.attrs.get('aria-label'), 'Lido e anotado',
		'fake l10n table returns pt-BR values');
});

test('ineligible rows (empty data) render an empty cell', () => {
	const impl = makeColumn();
	const { cell } = render(impl, '');
	assert.equal(cell.children.length, 0);
});

test('dataProvider maps item eligibility to sort codes', () => {
	let current;
	const impl = makeColumn({
		getRecord: () => ({ read: current.read }),
		hasAnnotations: () => current.annotations
	});
	const item = { isRegularItem: () => true };

	current = { read: false, annotations: false };
	assert.equal(impl.dataProvider(item), STATUS.UNREAD);

	current = { read: true, annotations: false };
	assert.equal(impl.dataProvider(item), STATUS.READ);

	current = { read: true, annotations: true };
	assert.equal(impl.dataProvider(item), STATUS.ANNOTATED);

	// Child items are ineligible
	assert.equal(impl.dataProvider({ isRegularItem: () => false }), '');

	// Errors must never propagate into rendering
	const broken = makeColumn({ getRecord: () => { throw new Error('boom'); }, logError: () => {} });
	assert.equal(broken.dataProvider(item), '');
});

test('registration uses narrow static width and persists user placement', () => {
	let captured = null;
	const impl = makeColumn({
		registerColumn: opts => {
			captured = opts;
			return 'zotread@fdossi.github.io_status';
		}
	});
	impl.register();
	const opts = captured;
	assert.ok(opts, 'registerColumn must be called');
	assert.equal(opts.dataKey, 'status');
	assert.equal(opts.pluginID, 'zotread@fdossi.github.io');
	assert.deepEqual([...opts.enabledTreeIDs], ['main']);
	assert.equal(opts.staticWidth, true);
	assert.equal(opts.noPadding, true);
	assert.ok(opts.zoteroPersist.includes('sortDirection'));
	assert.equal(typeof opts.renderCell, 'function');
});
