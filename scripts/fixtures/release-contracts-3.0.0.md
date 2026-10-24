# Historical 3.0.0 release contract fixture

`release-contracts-3.0.0.json` preserves the exact bytes of
`scripts/release-contracts.json` at commit
`979056d734f5e4ff42ab09c2da6e1084046ed7d3`.
Its SHA-256 is
`bd4802df6d071b9847a136836b426dec1c4b4d88595215f4d8ecc6783c358510`.

Tests use this snapshot for the historical L-57, L-60 and L-66 policies and
3.0 milestone behavior. It is not the live release contract, a new approval,
or evidence that any later release has completed a gate. Synthetic mutations
of this fixture exercise refusals and readiness; they confer no release credit.
The live contract remains `scripts/release-contracts.json` and has separate
shape, version-binding and pending-gate checks in `scripts/release.test.mjs`.
