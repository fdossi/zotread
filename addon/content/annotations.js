/*
 * Annotation aggregation for ZotRead.
 *
 * Determines whether a bibliographic parent item has reader annotations.
 *
 * Resolution chain: annotation -> attachment (annotation.parentItemID)
 *                   -> bibliographic parent (attachment.parentItemID).
 * Multiple attachments of the same parent are aggregated; any qualifying
 * annotation on any of them sets the annotated flag.
 *
 * Presence is computed live from library data (never stored), so
 * annotations that already existed when the plugin was installed are
 * detected immediately, and sync/undo/restore changes are picked up through
 * notifier invalidation. A small memo cache keeps rendering O(1) for visible
 * rows without repeated child-item lookups; it is invalidated precisely per
 * affected parent/attachment when relevant notifications arrive.
 */

/* global Zotero, ZotRead */

ZotRead.Annotations = (function () {
	function makeAnnotations(deps) {
		let memo = new Map(); // parentItemID -> boolean

		/** True if the annotation item's type qualifies for the yellow dot. */
		function isQualifying(annotation) {
			if (!annotation || !annotation.isAnnotation || !annotation.isAnnotation()) {
				return false;
			}
			if (annotation.deleted) {
				return false;
			}
			return deps.qualifyingTypes.includes(annotation.annotationType);
		}

		/**
		 * Count qualifying annotations across all file attachments of a
		 * regular item. Synchronous: uses Zotero's in-memory child-item data.
		 * Returns -1 when presence cannot be determined yet.
		 */
		function countForParent(parent) {
			if (!parent || !parent.isRegularItem()) {
				return 0;
			}
			try {
				let attachmentIDs = parent.getAttachments() || [];
				let count = 0;
				for (let attachmentID of attachmentIDs) {
					let attachment = Zotero.Items.get(attachmentID);
					if (!attachment || !attachment.isFileAttachment()) {
						continue;
					}
					for (let annotation of attachment.getAnnotations()) {
						if (isQualifying(annotation)) {
							count++;
						}
					}
				}
				return count;
			}
			catch (e) {
				deps.logError(e);
				return -1;
			}
		}

		function hasAnnotationsSync(parentItemID) {
			if (memo.has(parentItemID)) {
				return memo.get(parentItemID);
			}
			let parent = Zotero.Items.get(parentItemID);
			let count = countForParent(parent);
			// Unknown (-1) is cached as false and re-checked on the next
			// invalidation burst; avoids throwing during render.
			let has = count > 0;
			memo.set(parentItemID, has);
			return has;
		}

		function invalidate(parentItemIDs) {
			for (let id of parentItemIDs) {
				memo.delete(id);
			}
		}

		function invalidateAll() {
			memo.clear();
		}

		/**
		 * Given notified item objects (annotations, attachments or parents),
		 * resolve the set of top-level parent item IDs whose aggregate state
		 * may have changed.
		 */
		function resolveParentIDs(items) {
			let parentIDs = new Set();
			for (let item of items) {
				if (!item) continue;
				try {
					if (item.isAnnotation()) {
						// annotation -> attachment -> parent
						let attachment = Zotero.Items.get(item.parentItemID);
						if (attachment && attachment.parentItemID) {
							parentIDs.add(attachment.parentItemID);
						}
					}
					else if (item.isFileAttachment()) {
						if (item.parentItemID) {
							parentIDs.add(item.parentItemID);
						}
					}
					else if (item.isRegularItem()) {
						parentIDs.add(item.id);
					}
				}
				catch (e) {
					deps.logError(e);
				}
			}
			return [...parentIDs];
		}

		return {
			isQualifying,
			hasAnnotationsSync,
			invalidate,
			invalidateAll,
			resolveParentIDs,
			countForParent
		};
	}

	return {
		makeAnnotations,

		init() {
			this._impl = makeAnnotations({
				qualifyingTypes: ZotRead.QUALIFYING_ANNOTATION_TYPES,
				logError: e => Zotero.logError(e)
			});
		},

		hasAnnotationsSync(item) {
			return this._impl.hasAnnotationsSync(item.id);
		},

		invalidate(itemIDs) {
			this._impl.invalidate(itemIDs);
		},

		invalidateAll() {
			this._impl.invalidateAll();
		},

		resolveParentIDs(items) {
			return this._impl.resolveParentIDs(items);
		},

		countForParent(item) {
			return this._impl.countForParent(item);
		},

		shutdown() {
			this._impl = null;
		}
	};
})();
