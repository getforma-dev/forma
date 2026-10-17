# Boolean attribute review originals — FORMA-182

These complete source files are frozen at the source commit in `manifest.json`.
The manifest records byte counts and SHA-256. The compiler archive test verifies them.

The native test `dyn_attr_empty_string_is_a_value_not_an_absence` used `disabled`
while claiming ordinary value-attribute semantics. It expected empty string and zero
to disable the control, contradicting fresh core. Its current replacement checks
boolean presence; shared attribute vectors retain ordinary empty-value coverage.

The core vector test used a nonempty string as its alternate value for every
attribute. After boolean presence is normalized, two truthy strings have the same
DOM value and intentionally cause no write. Its current alternate is opposite
truthiness for boolean attributes, preserving the later-write assertion.

Original failure logs are retained in `work/FORMA-182-rules/tmp/codex-attrs-boolean-*`.
No archived source is executed as a current conformance test.
