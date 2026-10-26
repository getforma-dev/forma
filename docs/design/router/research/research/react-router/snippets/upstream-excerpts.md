# Pinned upstream excerpts

These are short exact source excerpts for study, not standalone implementations. The full source is retained in `.local/upstream`; the MIT copyright/permission notices are retained in [router license](../licenses/LICENSE-react-router.md) and [website license](../licenses/LICENSE-website.md). Line numbers and source commit are explicit.

## Library click eligibility

[packages/react-router/lib/dom/dom.ts, lines 34–43](https://github.com/remix-run/react-router/blob/4fe4525102870a2b21a4a0568a651d118f5e5dbb/packages/react-router/lib/dom/dom.ts#L34-L43)

```ts
export function shouldProcessLinkClick(
  event: LimitedMouseEvent,
  target?: string,
) {
  return (
    event.button === 0 && // Ignore everything but left clicks
    (!target || target === "_self") && // Let browser handle "target=_blank" etc.
    !isModifiedEvent(event) // Ignore clicks with modifier keys
  );
}
```

## History entry identity

[packages/react-router/lib/router/history.ts, lines 552–565](https://github.com/remix-run/react-router/blob/4fe4525102870a2b21a4a0568a651d118f5e5dbb/packages/react-router/lib/router/history.ts#L552-L565)

```ts
function getHistoryState(location: Location, index: number): HistoryState {
  return {
    usr: location.state,
    key: location.key,
    idx: index,
    masked: location.mask
      ? {
          pathname: location.pathname,
          search: location.search,
          hash: location.hash,
        }
      : undefined,
  };
}
```

## Ranked branch scoring

[packages/react-router/lib/router/utils.ts, lines 1380–1427](https://github.com/remix-run/react-router/blob/4fe4525102870a2b21a4a0568a651d118f5e5dbb/packages/react-router/lib/router/utils.ts#L1380-L1427)

```ts
function rankRouteBranches(branches: RouteBranch[]): void {
  branches.sort((a, b) =>
    a.score !== b.score
      ? b.score - a.score // Higher score first
      : compareIndexes(
          a.routesMeta.map((meta) => meta.childrenIndex),
          b.routesMeta.map((meta) => meta.childrenIndex),
        ),
  );
}

const paramRe = /^:[\w-]+$/;
const partialParamRe = /^:[\w-]+/;
const partialDynamicSegmentValue = 3.5;
const dynamicSegmentValue = 3;
const indexRouteValue = 2;
const emptySegmentValue = 1;
const staticSegmentValue = 10;
const splatPenalty = -2;
const isSplat = (s: string) => s === "*";

function computeScore(path: string, index: boolean | undefined): number {
  let segments = path.split("/");
  let initialScore = segments.length;
  if (segments.some(isSplat)) {
    initialScore += splatPenalty;
  }

  if (index) {
    initialScore += indexRouteValue;
  }

  return segments
    .filter((s) => !isSplat(s))
    .reduce(
      (score, segment) =>
        // prettier-ignore
        score + (
          paramRe.test(segment) ? dynamicSegmentValue :
          partialParamRe.test(segment) ? partialDynamicSegmentValue :
          segment === "" ? emptySegmentValue :
          staticSegmentValue
        ),
      initialScore,
    );
}

function compareIndexes(a: number[], b: number[]): number {
```

## Navigation interruption boundary

[packages/react-router/lib/router/router.ts, lines 1963–1982](https://github.com/remix-run/react-router/blob/4fe4525102870a2b21a4a0568a651d118f5e5dbb/packages/react-router/lib/router/router.ts#L1963-L1982)

```ts
    },
  ): Promise<void> {
    if (pendingDiscoveryCancellation) await pendingDiscoveryCancellation;
    // Abort any in-progress navigations and start a new one. Unset any ongoing
    // uninterrupted revalidations unless told otherwise, since we want this
    // new navigation to update history normally
    pendingNavigationController && pendingNavigationController.abort();
    pendingNavigationController = null;
    pendingAction = historyAction;
    isUninterruptedRevalidation =
      (opts && opts.startUninterruptedRevalidation) === true;

    // Save the current scroll position every time we start a new navigation,
    // and track whether we should reset scroll on completion
    saveScrollPosition(state.location, state.matches);
    pendingPreventScrollReset = (opts && opts.preventScrollReset) === true;

    pendingViewTransitionEnabled = (opts && opts.enableViewTransition) === true;

    let matches =
```

## History commit boundary

[packages/react-router/lib/router/router.ts, lines 1605–1620](https://github.com/remix-run/react-router/blob/4fe4525102870a2b21a4a0568a651d118f5e5dbb/packages/react-router/lib/router/router.ts#L1605-L1620)

```ts
        location.state?._isRedirect !== true);

    // Commit any in-flight routes at the end of the HMR revalidation "navigation"
    dataRoutes.commitHmrRoutes();

    if (isUninterruptedRevalidation) {
      // If this was an uninterrupted revalidation then do not touch history
    } else if (pendingAction === NavigationType.Pop) {
      // Do nothing for POP - URL has already been updated
    } else if (pendingAction === NavigationType.Push) {
      init.history.push(location, location.state);
    } else if (pendingAction === NavigationType.Replace) {
      init.history.replace(location, location.state);
    }

    let viewTransitionOpts: ViewTransitionOpts | undefined;
```

## Website markdown link interception and cleanup

[app/ui/delegate-markdown-links.ts, lines 18–38](https://github.com/remix-run/react-router-website/blob/e9b619c5b05209d1eaf0ba02218633732347c789/app/ui/delegate-markdown-links.ts#L18-L38)

```ts
      if (
        a && // is anchor or has anchor parent
        a.hasAttribute("href") && // has an href
        a.host === window.location.host && // is internal
        event.button === 0 && // left click
        (!a.target || a.target === "_self") && // Let browser handle "target=_blank" etc.
        !(event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) // not modified
      ) {
        event.preventDefault();
        let { pathname, search, hash } = a;
        navigate({ pathname, search, hash });
      }
    };

    if (!node) return;
    node.addEventListener("click", handler);

    return () => {
      node?.removeEventListener("click", handler);
    };
  }, [navigate, nodeRef]);
```
