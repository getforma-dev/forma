# Independent specification fixtures

These Python encoders were recovered from the independently reviewed FMIR v3 specification.
They do not import either production implementation or the shared production constants table.
The frozen byte expectations therefore remain a separate oracle.

Run `python3 -I scripts/fmir-spec/example.py` for the 183-byte example and annotated listing;
run `python3 -I scripts/fmir-spec/fixtures.py` for the 67 rule fixtures and `index.tsv` in
`crates/forma-ir/tests/fixtures/fmir-v3`. The server manifest is an index of those fixtures,
not encoder output. Review every byte diff against `docs/FMIR-FORMAT.md` before committing.
The production corpus is separately emitted by the actual TypeScript compiler.
