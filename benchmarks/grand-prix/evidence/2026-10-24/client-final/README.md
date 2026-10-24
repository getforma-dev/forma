# Final client campaign 40140319634

This snapshot retains the original 138,657-byte GitHub Actions artifact, its
provider metadata and two independent arithmetic reviews. Its SHA-256 is
`b1c5d2493248a7607dda7105a948a8b57158db41f6e367b233fe2b4268ce8a2c`.
The measured source is `9ac07a446ebe8aaad407a895fa8aaece189bc69e`.

`publication-summary.json` supplies the report's new tables. `independent`
contains the first arithmetic review; `effects-review` contains an independent
recomputation, source comparison and product assessment. The latter keeps its
initial incorrect 53-member assumption and correction to the authenticated
50-member archive. No samples were removed or selected by outcome.

Run `python3 verify.py` from this directory to authenticate the retained ZIP
against retained provider metadata, replay both calculations in temporary
directories and check the report summary. It verifies all 29 timing records and
11 bundle records. `python3 verify.py --write-summary` explicitly regenerates
only the derived publication summary. Neither command runs benchmarks or gives
release qualification. A newly downloaded archive still requires provider
authentication independently of this offline check.

The original fan-out and row-creation targets remain missed. The maintainer's
prospective 3.1 decision accepts the disclosed costs while preserving stable
row/listener behavior. Batching and DOM adverse point estimates remain visible;
observed dispersion does not establish non-regression. See
`effects-review/PRODUCT-ASSESSMENT.md` for the complete reasoning. No packed
qualification, RC publication, burn-in or deployment is claimed here.
