// Verbatim upstream excerpt: Astro astro@7.2.10
// Source: https://github.com/withastro/astro/blob/2fdf731428aa738d5dcf3041b4e78eb9d036968c/packages/astro/src/transitions/router.ts#L328-L355
// Original lines 328-355; context omitted. Not standalone executable code.
// License: MIT and supplied notices; see ../licenses/framework-LICENSE.txt.

function abortAndRecreateMostRecentNavigation(): Navigation {
	mostRecentNavigation?.controller.abort();
	return (mostRecentNavigation = {
		controller: new AbortController(),
	});
}

async function transition(
	direction: Direction,
	from: URL,
	to: URL,
	options: Options,
	historyState?: State,
	hasUAVisualTransition = false,
) {
	// The most recent navigation always has precedence
	// Yes, there can be several navigation instances as the user can click links
	// while we fetch content or simulate view transitions. Even synchronous creations are possible
	// e.g. by calling navigate() from a transition event.
	// Invariant: all but the most recent navigation are already aborted.

	const currentNavigation = abortAndRecreateMostRecentNavigation();

	// not ours
	if (!transitionEnabledOnThisPage() || location.origin !== to.origin) {
		if (currentNavigation === mostRecentNavigation) mostRecentNavigation = undefined;
		location.href = to.href;
		return;
