# Original reconstruction sketch: full-HTML client navigation

This is original explanatory pseudocode derived from the behavior described in [the report](../report.md). It is **not an Astro excerpt**, a drop-in library, or a claim that Astro uses exactly these data structures. In particular, generation checks, a version fence, an explicit commit queue, and mutation fallback are proposed implementation policies. Keep these separate from the attributed verbatim excerpts in this folder.

```ts
// Illustrative contracts; browser/platform details omitted intentionally.
type Intent = {
  url: URL;
  kind: "push" | "replace" | "traverse";
  historyEntry?: { index: number; scroll: [number, number] };
  form?: { method: "GET" | "POST"; body?: FormData };
  source?: Element;
};
let generation = 0;
let current: { id: number; abort: AbortController } | undefined;
let commitTail: Promise<void> = Promise.resolve();

async function navigate(intent: Intent) {
  current?.abort.abort();
  const transaction = { id: ++generation, abort: new AbortController() };
  current = transaction;
  const isCurrent = () =>
    current === transaction && !transaction.abort.signal.aborted;

  // Preserve browser semantics; same-origin alone is not enough.
  if (!currentDocumentOptsIn() || intent.url.origin !== location.origin) {
    return nativeNavigate(intent);
  }
  saveOutgoingScroll();
  if (canUseFragmentOnlyPath(intent)) return commitHashAndScroll(intent);

  try {
    const preparation = makePreparationEvent(intent, transaction.abort.signal);
    dispatchBeforePreparation(preparation);
    await preparation.loader(); // default loader is sketched below
    if (!isCurrent()) return;
    if (preparation.delegateToBrowser) return mutationAwareFallback(intent);

    // Proposed: inspect an app-owned protocol version. Astro's reviewed files
    // did not contain this explicit release compatibility comparison.
    if (!compatibleDocumentProtocol(preparation.document)) {
      return mutationAwareFallback(intent);
    }
    await waitForNewStyles(preparation.document, transaction.abort.signal);
    if (!isCurrent()) return;
    dispatchAfterPreparation(preparation);

    // A queued commit always checks ownership again after waiting.
    const job = commitTail.catch(reportPreviousCommitFailure).then(async () => {
      if (!isCurrent()) return;
      await skipPreviousAnimationAndFinishItsDOMUpdate();
      if (!isCurrent()) return;
      const swap = makeSwapEvent(preparation);
      dispatchBeforeSwap(swap);
      if (!isCurrent()) return;
      await visualTransition(async () => {
        if (!isCurrent()) return;
        // Keep this default swap synchronous. Custom async hooks must not
        // create an uncontrolled interleaving between destructive DOM steps.
        reconcileDocument(swap.document);
        commitHistory(intent, swap.finalURL);
        restoreScrollForIntent(intent);
        dispatchAfterSwap();
      }).updateCallbackDone;
      // Define whether stale work here may run, and why. This sketch suppresses it.
      if (!isCurrent()) return;
      await activateNewScriptsInOrder();
      if (!isCurrent()) return;
      dispatchPageLoad();
      announceDestination();
    });
    commitTail = job;
    await job;
  } catch (error) {
    if (!isCurrent()) return; // cancellation is not a request for native fallback
    reportNavigationFailure(error);
    return mutationAwareFallback(intent);
  }
}
```

The sketch deliberately exposes policy decisions instead of hiding them in `fetch()`:

```ts
async function defaultLoader(intent, signal) {
  const response = await fetch(intent.url, makeRequest(intent, signal));
  if (!isHTMLMediaType(response.headers)) return delegateToBrowser();
  const finalURL = resolveFinalURLAndFragment(response, intent.url);
  if (!sameOrigin(finalURL)) return delegateToBrowser();
  const parsed = parseHTML(await response.text());
  removeParsedNoscriptNodes(parsed);
  if (!incomingDocumentOptsIn(parsed) && intent.form?.method !== "POST") {
    return delegateToBrowser();
  }
  return { document: parsed, finalURL, status: response.status };
}

function reconcileDocument(nextDocument) {
  markPreviouslyExecutedScripts(nextDocument);
  reconcileRootAttributes(nextDocument.documentElement);
  reconcileHeadByExplicitRules(nextDocument.head);
  const focus = capturePersistedFocusAndSelection();
  const live = collectLivePersistenceMatches(document.body, nextDocument.body);
  keepPersistentNodesConnectedDuringBodyReplacement(live);
  document.body.replaceWith(nextDocument.body);
  placeOriginalNodesAtMatchingPlaceholders(live);
  updatePersistedIslandPropsAccordingToPolicy(live);
  upgradeDeclarativeShadowRoots();
  initializeNewlyParsedMediaWithoutReplacingLivePersistedMedia(live);
  restorePersistedFocusAndSelection(focus);
}
```

`mutationAwareFallback` must be specified before it is implemented. A GET may be delegated to a normal page load. A POST may already have committed on the server even if its response was lost; blindly submitting again risks duplicate mutation, while assigning its URL performs a GET with different semantics. Choose idempotency keys, an explicit recovery page, or another server-supported contract. The pseudocode intentionally does not pretend there is a universally safe one-line answer.

A click adapter should inspect `event.defaultPrevented`, primary button/modifiers, composed path, href, download, target, reload opt-out, and URL origin before preventing default. A form adapter should use the submitter, handle named fields shadowing form properties, preserve dialog behavior, and avoid creating a second mutation during fallback. A history adapter should distinguish push/replace/traverse, remember the outgoing URL, snapshot scroll before a destructive update, and cooperate with other state users.

Keep observability explicit: transaction ID, requested/final URL, preparation start/end, abort reason, commit ownership, swap start/end, scripts complete, page-load, and animation finished are separate facts. Tests should assert both the visible result and the absence of stale commits, extra history entries, duplicate submissions, and retained subscriptions.
