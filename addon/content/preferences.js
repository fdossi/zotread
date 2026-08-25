/*
 * ZotRead preference pane wiring.
 * Binds pane controls to extensions.zotero.zotread.* prefs; changes apply
 * immediately. Zotero loads this script with the pane fragment.
 */

/* global Zotero, document */

(function () {
	const PREFS = {
		autoDetectRead: 'extensions.zotero.zotread.autoDetectRead',
		showAnnotationDots: 'extensions.zotero.zotread.showAnnotationDots',
		colorUnread: 'extensions.zotero.zotread.colorUnread',
		colorRead: 'extensions.zotero.zotread.colorRead',
		colorAnnotated: 'extensions.zotero.zotread.colorAnnotated'
	};

	function init() {
		let autoDetect = document.getElementById('zotread-pref-autodetect');
		let annotationDots = document.getElementById('zotread-pref-annotationdots');
		let colorUnread = document.getElementById('zotread-pref-color-unread');
		let colorRead = document.getElementById('zotread-pref-color-read');
		let colorAnnotated = document.getElementById('zotread-pref-color-annotated');

		autoDetect.checked = Zotero.Prefs.get(PREFS.autoDetectRead, true);
		annotationDots.checked = Zotero.Prefs.get(PREFS.showAnnotationDots, true);
		colorUnread.value = Zotero.Prefs.get(PREFS.colorUnread, true);
		colorRead.value = Zotero.Prefs.get(PREFS.colorRead, true);
		colorAnnotated.value = Zotero.Prefs.get(PREFS.colorAnnotated, true);

		autoDetect.addEventListener('command', () => {
			Zotero.Prefs.set(PREFS.autoDetectRead, autoDetect.checked, true);
		});
		annotationDots.addEventListener('command', () => {
			Zotero.Prefs.set(PREFS.showAnnotationDots, annotationDots.checked, true);
		});
		colorUnread.addEventListener('change', () => {
			Zotero.Prefs.set(PREFS.colorUnread, colorUnread.value, true);
		});
		colorRead.addEventListener('change', () => {
			Zotero.Prefs.set(PREFS.colorRead, colorRead.value, true);
		});
		colorAnnotated.addEventListener('change', () => {
			Zotero.Prefs.set(PREFS.colorAnnotated, colorAnnotated.value, true);
		});

		document.l10n?.translateFragment(document);
	}

	if (document.readyState === 'complete' || document.readyState === 'interactive') {
		init();
	}
	else {
		window.addEventListener('load', init);
	}
})();
