# Whole-page SSR mount retirement: historical controls

Exact original test files from `9c3159c422ba6e23c26cb6cd7713f4fed84d0752` are
recorded in `manifest.json` with Git path, byte length and SHA-256. These are
historical evidence; they are not active tests and are not rewritten.

The current `mount.test.ts` replaces whole-page SSR adoption and empty-root
fallback expectations with a coded refusal before component/root/effect/listener
creation or DOM writes. Its ordinary Browser mounting remains supported.

The other eight unit files and three native-browser fixtures retain their
adoption assertions through the public
`hydrateIsland()` API under explicit caller-owned `createRoot()` scopes. The test
helper forwards thrown errors, releases its own root on an exception, and
provides explicit disposal without clearing DOM. It does not reconstruct the
retired mount adapter or grant compiled state authority. The packed development/
production browser fixture adds the same refusal and a Browser unmount control
for both actual export conditions. Namespace, raw-markup,
list, node identity, form-state, handler and reactive-disposal controls remain.

One fragment control intentionally changes the old adapter's automatic failed
root disposal/DOM-clearing assertion to explicit caller disposal while preserving
server DOM, coded reporting and stopped effects. The new mount refusal tests
prove that this retired path cannot run a component at all. Historical source
comments and changelog entries remain historical; current references name the
retained direct API. FORMA-104's strict adoption transaction and the complete
FORMA-105 compiler/template integration are separate work.
