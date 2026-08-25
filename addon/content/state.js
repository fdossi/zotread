/*
 * Pure state-management logic for ZotRead.
 *
 * This file must remain free of Zotero dependencies so the exact shipped
 * code can be unit-tested under Node (see tests/state.test.mjs).
 *
 * Conceptual record stored per item (libraryID + itemKey):
 *   {
 *     read: boolean,            // reading state
 *     source: 'auto'|'manual',  // what last set the read flag
 *     firstOpenedAt: string|null,
 *     manuallySetAt: string|null
 *   }
 * Annotation presence is computed live from library data and never stored.
 */

/* global ZotRead */

ZotRead.State = (function () {
	const SOURCE_AUTO = 'auto';
	const SOURCE_MANUAL = 'manual';

	/**
	 * Default record for an item with no stored history: unread.
	 */
	function defaultRecord() {
		return {
			read: false,
			source: SOURCE_AUTO,
			firstOpenedAt: null,
			manuallySetAt: null
		};
	}

	/** Normalize a possibly-partial/persisted record into a canonical one. */
	function normalize(raw) {
		if (!raw || typeof raw !== 'object') {
			return defaultRecord();
		}
		return {
			read: !!raw.read,
			source: raw.source === SOURCE_MANUAL ? SOURCE_MANUAL : SOURCE_AUTO,
			firstOpenedAt: typeof raw.firstOpenedAt === 'string' ? raw.firstOpenedAt : null,
			manuallySetAt: typeof raw.manuallySetAt === 'string' ? raw.manuallySetAt : null
		};
	}

	/**
	 * The visible status given a stored record and live annotation presence.
	 *
	 * Policy: while an item is explicitly unread its indicator stays red even
	 * if annotations exist; the annotated green/yellow pair returns as soon as
	 * it becomes read again (annotations are kept in storage and re-detected).
	 */
	function statusOf(record, hasAnnotations) {
		return record.read ? (hasAnnotations ? 'annotated' : 'read') : 'unread';
	}

	/** Column data-provider value ('0'..'2'); '' means "no indicator". */
	function sortValue(status) {
		switch (status) {
			case 'unread': return ZotRead.STATUS.UNREAD;
			case 'read': return ZotRead.STATUS.READ;
			case 'annotated': return ZotRead.STATUS.ANNOTATED;
			default: return '';
		}
	}

	/**
	 * Item was opened in the reader.
	 * Marks read; records firstOpenedAt once. Manual unread is overridden by
	 * actually opening the item again.
	 */
	function onOpened(record, now) {
		let next = normalize(record);
		next.read = true;
		next.source = SOURCE_AUTO;
		if (!next.firstOpenedAt) {
			next.firstOpenedAt = now;
		}
		return next;
	}

	/**
	 * Manual "Mark as read".
	 */
	function markRead(record, now) {
		let next = normalize(record);
		next.read = true;
		next.source = SOURCE_MANUAL;
		next.manuallySetAt = now;
		return next;
	}

	/**
	 * Manual "Mark as unread".
	 *
	 * Policy: sets reading state to unread. Existing annotations remain
	 * stored/detectable; the indicator shows red until the item is opened or
	 * manually marked read again.
	 */
	function markUnread(record, now) {
		let next = normalize(record);
		next.read = false;
		next.source = SOURCE_MANUAL;
		next.manuallySetAt = now;
		return next;
	}

	/**
	 * Highlight/annotation creation: marks parent read + annotated.
	 */
	function onAnnotationCreated(record, now) {
		return onOpened(record, now);
	}

	/** Whether two records differ in anything user-visible or persisted. */
	function equals(a, b) {
		a = normalize(a);
		b = normalize(b);
		return a.read === b.read
			&& a.source === b.source
			&& a.firstOpenedAt === b.firstOpenedAt
			&& a.manuallySetAt === b.manuallySetAt;
	}

	return {
		SOURCE_AUTO,
		SOURCE_MANUAL,
		defaultRecord,
		normalize,
		statusOf,
		sortValue,
		onOpened,
		markRead,
		markUnread,
		onAnnotationCreated,
		equals,

		// Test hook: stable timestamp factory used by callers that don't have
		// a clock injected; real callers pass `new Date().toISOString()`.
		now() {
			return new Date().toISOString();
		}
	};
})();
