// Verbatim upstream excerpt: Astro astro@7.2.10
// Source: https://github.com/withastro/astro/blob/2fdf731428aa738d5dcf3041b4e78eb9d036968c/packages/astro/src/transitions/swap-functions.ts#L356-L363
// Original lines 356-363; context omitted. Not standalone executable code.
// License: MIT and supplied notices; see ../licenses/framework-LICENSE.txt.

export const swap = (doc: Document) => {
	deselectScripts(doc);
	swapRootAttributes(doc);
	swapHeadElements(doc);
	const restoreFocusFunction = saveFocus();
	swapBodyElement(doc.body, document.body);
	restoreFocusFunction();
};
