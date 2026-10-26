// Verbatim upstream excerpt: Astro astro@7.2.10
// Source: https://github.com/withastro/astro/blob/2fdf731428aa738d5dcf3041b4e78eb9d036968c/packages/astro/src/transitions/router.ts#L472-L499
// Original lines 472-499; context omitted. Not standalone executable code.
// License: MIT and supplied notices; see ../licenses/framework-LICENSE.txt.

	async function abortAndRecreateMostRecentTransition(): Promise<Transition> {
		if (mostRecentTransition) {
			if (mostRecentTransition.viewTransition) {
				try {
					mostRecentTransition.viewTransition.skipTransition();
				} catch {
					// might throw AbortError DOMException. Ignored on purpose.
				}
				try {
					// UpdateCallbackDone might already been settled, i.e. if the previous transition finished updating the DOM.
					// Could not take long, we wait for it to avoid parallel updates
					// (which are very unlikely as long as swap() is not async).
					await mostRecentTransition.viewTransition.updateCallbackDone;
				} catch {
					// There was an error in the update callback of the transition which we cancel.
					// Ignored on purpose
				}
			}
		}
		return (mostRecentTransition = { transitionSkipped: false });
	}

	const currentTransition = await abortAndRecreateMostRecentTransition();

	if (prepEvent.signal.aborted) {
		if (currentNavigation === mostRecentNavigation) mostRecentNavigation = undefined;
		return;
	}
