# FORMA-112 compatibility expectations

`index.tsv` and every `.ir` byte preserve the reviewed FORMA-185 exact-base stage.
`window-expectations.tsv` records the current major/minor window: only the valid
3.0.1 writer changes from LOAD-108 to PASS for a 3.0.0 reader. A newer minor or
different major still fails. Unknown required sections and all structural checks
are unchanged. Rust and TypeScript tests use this explicit overlay.
