# Changelog

## [Unreleased]

- Guard `Link` URLs with core's existing policy without requiring an ambient
  document when the caller supplies one.
- Avoid repeating the unknown-submission warning in the live region while
  retaining the persistent uncertainty marker and no-resend behavior.
- Remove the unused `PreparedView.focus` declaration before stable 3.2.
- Explain how islands and native navigation work together and how one
  application can use different rendering profiles across document boundaries.

The coordinated [3.2.0-rc.3 prerelease](https://github.com/getforma-dev/forma/releases/tag/v3.2.0-rc.3)
is published; the changes above are subsequent work. Stable 3.1.0 remains
available. The [dated publication outcome](../../docs/release/3.2-RC3-PUBLICATION.md)
supplements the historical preparation entry below.

## Original router development scope

- Add optional owned client navigation with ranked routes, persistent layouts,
  History API coordination, safe links, bounded speculation and three explicit
  browser/generated-HTML/native adapters.
- Integrate typed native owner branches and actions with core's optional scoped
  adoption entry and compiler/build navigation groups. Preserve ordinary SSR and
  static routes without router code.
- Add mutation-generation fencing, one-shot POST semantics, persistent unknown
  outcome handling, context revocation, bounded recovery and accessible status,
  focus and scroll behavior.
- Include source and real-browser regressions, packed release integration and an
  opt-in typed Rust starter. These capabilities are included in published RC2
  and RC3 and absent from stable Forma 3.1.0.

## [3.2.0-rc.3] - Prepared; publication pending

- Coordinate this package with the eight-package RC3 set. No package runtime
  behavior changes are introduced by these release-record and harness repairs.
- The finite router placeholder receipt and duplicate-work reduction require new
  exact-source qualification. Published RC2 and all historical entries remain
  unchanged. See [RC3 preparation](../../docs/release/3.2-RC3-PREPARATION.md) for
  evidence and remaining acceptance.
