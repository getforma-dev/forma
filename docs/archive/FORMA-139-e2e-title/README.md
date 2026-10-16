# R17 title fixture migration

The files recorded by `manifest.json` are byte-exact originals from d360dd4ff21b6af79eec26ef67bc8b0c675b6173. The preserved CI excerpt is from run38833979020, which stopped when the new BUILD-619 rule refused the historical component HTML title. The full original CI log is retained in the task evidence directory; its digest is recorded in the manifest. No historical source or assertion has been rewritten.

The compiler test now runs that original app as an explicit BUILD-619 negative, with its original source location. All nine live SSR fixture entries are checked against strict diagnostics. The live title case uses an ordinary reactive heading, while the typed server render call and explicit Browser shell both receive the document title. Browser tests require exactly one head title, no body title, and real heading updates in each mode.

The original RCDATA title behavior is no longer part of the admitted native component subset; textarea RCDATA cases remain unchanged. This migration does not weaken BUILD-619 or skip the old source.
