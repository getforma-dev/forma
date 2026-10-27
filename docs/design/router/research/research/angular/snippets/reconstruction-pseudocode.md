# Original reconstruction sketches

These sketches are original explanatory pseudocode derived from the architectural analysis. They are not copied Angular code, executable modules, or an Angular compatibility implementation. The four neighboring `.excerpt.ts` files are the attributed upstream excerpts.

## Separate route transactions from the browser adapter

```text
requestNavigation(target, trigger):
    reserve a monotonically increasing navigation id
    make this id the sole owner of the pending transition
    cancel the old transition's abort signal
    # Cancellation can synchronously invoke user callbacks and request a newer id.
    if this id no longer owns the transition: return superseded

    parse target into a URL model
    recognize a complete route branch, with bounded redirect handling
    after every awaited stage, and after every callback:
        if this id no longer owns the transition: return superseded

    run leaving guards and entering guards
    resolve required data and code using the chosen ordering contract
    prepare target render state without changing the visible page
    ask the browser adapter to coordinate the URL commit
    enter a deliberately controlled commit phase
    activate the render plan
    finalize title and completion events
    schedule scroll/focus after the new layout is ready
```

Key decisions left explicit: eager versus deferred URL updates, handling of a browser cursor that has already traversed, what callbacks may re-enter the commit phase, and whether activation can fail partway through. A production implementation needs its own error/rollback policy. Angular's observable pipeline and Navigation API precommit integration provide more machinery than this sketch.

The important invariant is that cancelling work and revoking ownership are different operations. A cached Promise can complete usefully after its original navigation is superseded; it must not regain permission to replace the current UI.

## Recognize an ordered branch

```text
recognize(remaining segments, ordered candidates, parent context):
    for candidate in configured order:
        match path and obtain consumed segments + parameters
        if path cannot match: continue
        if canMatch returns false: continue
        if canMatch returns redirect: propagate redirect outcome
        if candidate redirects: apply redirect and restart within budget
        recognize the candidate's child branch/outlets
        if a required child branch fails: continue with next candidate
        return the complete route snapshot branch
    return no-match
```

A flat first-prefix search loses child failure, outlet structure, and fallback semantics. This sketch omits Angular's URL-tree grammar, lazy route discovery, injectors, empty-path merging, and exact redirect rules; implement those only if the chosen product contract requires them.

## Give caches a specific purpose

| Cache | Typical key | Value | Lifetime question |
| --- | --- | --- | --- |
| Route-code loader | Route configuration identity | In-flight Promise and loaded component/routes | When is route configuration replaced or released? |
| Public document content | Normalized content path plus a release key if needed | Promise of generated HTML/content | Is it session-scoped, bounded, invalidated on release, retryable after failure? |
| Authenticated data | Resource/query identity plus user context | Data/version, not a universal HTML fragment | How do mutations, authorization changes, expiry, and sign-out invalidate it? |
| History scroll | Browser entry identity | Coordinates or anchor intent | How are replaced/truncated history entries retired? |

The inspected docs app visibly uses a path-to-Promise content cache. It does not establish the extra release-key, capacity, or authenticated-data policies shown as questions above.

## Put lifecycle ownership next to the view

```text
mount a routed view:
    establish route identity and parent shell ownership
    install content or component tree
    attach only the view's listeners/widgets
    expose a single disposal handle

leave a routed view:
    either retain it under an explicit reuse strategy
    or dispose listeners/widgets/resources before removing it

reuse a view:
    update route inputs deliberately
    separately decide which data reruns
```

Same component type, same route object, same URL, and same data identity are not interchangeable. The reconstruction should state which one controls retention. See [the report](../report.md) and [verification matrix](../questions.md) for the source evidence and acceptance cases.
