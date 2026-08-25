// State-machine tests for ZotRead's reading-status model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts } from './helpers/load.mjs';

const ctx = loadScripts(['content/zotread.js', 'content/state.js']);
const State = ctx.ZotRead.State;
const STATUS = ctx.ZotRead.STATUS;
const NOW = '2026-08-24T12:00:00.000Z';

test('new item with no stored state defaults to unread', () => {
	const record = State.defaultRecord();
	assert.equal(record.read, false);
	assert.equal(State.statusOf(record, false), 'unread');
});

test('existing item without recorded state normalizes to unread', () => {
	const record = State.normalize(null);
	assert.equal(State.statusOf(record, false), 'unread');
	const partial = State.normalize({});
	assert.equal(partial.read, false);
	assert.equal(partial.firstOpenedAt, null);
	assert.equal(partial.manuallySetAt, null);
});

test('opening marks the item read and records firstOpenedAt once', () => {
	let record = State.defaultRecord();
	record = State.onOpened(record, NOW);
	assert.equal(record.read, true);
	assert.equal(record.firstOpenedAt, NOW);

	const later = '2027-01-01T00:00:00.000Z';
	const again = State.onOpened(record, later);
	assert.equal(again.firstOpenedAt, NOW, 'firstOpenedAt must not change on re-open');
});

test('manual mark-as-read works', () => {
	let record = State.defaultRecord();
	record = State.markRead(record, NOW);
	assert.equal(record.read, true);
	assert.equal(record.source, 'manual');
	assert.equal(record.manuallySetAt, NOW);
});

test('manual mark-as-unread works', () => {
	let record = State.defaultRecord();
	record = State.markRead(record, NOW);
	record = State.markUnread(record, NOW);
	assert.equal(record.read, false);
	assert.equal(record.source, 'manual');
	assert.equal(State.statusOf(record, true), 'unread');
});

test('explicit unread policy: red dot wins while unread even if annotated', () => {
	// Item was read+annotated, then manually marked unread.
	let record = State.defaultRecord();
	record = State.onOpened(record, NOW);      // opened
	record = State.markUnread(record, NOW);    // manual unread; annotations kept
	assert.equal(State.statusOf(record, true), 'unread', 'indicator stays red while explicitly unread');

	// Opening the article again restores the green/yellow indicator.
	const reopened = State.onOpened(record, NOW);
	assert.equal(State.statusOf(reopened, true), 'annotated');
});

test('annotation creation marks parent read and annotated', () => {
	let record = State.defaultRecord();
	record = State.onAnnotationCreated(record, NOW);
	assert.equal(record.read, true);
	assert.equal(State.statusOf(record, true), 'annotated');
});

test('deleting the final annotation removes yellow but preserves read state', () => {
	let record = State.defaultRecord();
	record = State.onAnnotationCreated(record, NOW);
	// Annotation deleted -> hasAnnotations becomes false
	assert.equal(State.statusOf(record, false), 'read');
	assert.equal(record.read, true, 'read state preserved');
});

test('sort values are ordered unread < read < annotated', () => {
	assert.equal(State.sortValue('unread'), STATUS.UNREAD);
	assert.equal(State.sortValue('read'), STATUS.READ);
	assert.equal(State.sortValue('annotated'), STATUS.ANNOTATED);
	assert.ok(STATUS.UNREAD < STATUS.READ && STATUS.READ < STATUS.ANNOTATED);
	assert.equal(State.sortValue('bogus'), '');
});

test('record equality ignores identity of copies but respects fields', () => {
	const a = State.markRead(State.defaultRecord(), NOW);
	const b = State.markRead(State.defaultRecord(), NOW);
	assert.ok(State.equals(a, b));
	const c = State.markUnread(a, NOW);
	assert.ok(!State.equals(a, c));
});
