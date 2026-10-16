# Native select baseline repair: first qualification

Source 9ac71d6e0c9c7c959117b2d8ca673d1cb872ab93 is test-only. The repaired case passed once in all three current macOS Playwright 1.64.1 engines (3/3, 3.4 seconds). The exact native-only baseline and original hosted failure remain in `../../archive/webkit-native-select-baseline/`.

The one authorized full WebKit core run rebuilt core successfully and passed the repaired case plus 407 others, but failed three existing frame TCP-counter cases with `read ECONNRESET` (408 passed / 3 failed, 1.4 minutes). Its complete original log and failure artifacts are preserved here; no retry was run. Those failures have not been dismissed as a passing suite or resolved by this select repair. A source inspection identified missing socket-error handling in the common counter, but this record does not claim a proven cause.

All original select edited-state, refusal-code, zero-mutation and positive-control assertions remain, with native selected bits/index captured before importing Forma and required unchanged after check/release. There are no product, header, timing or retry changes. Fresh hosted CI and hosted engine qualification remain pending. This evidence is not release acceptance.
