# FORMA-116 evidence

The corrected source b3d1904c passed six actual compiled production mutants in 40.144 seconds. Every named test passed before, failed with its expected security assertion under the weakening, and passed after restoration. The source scratch was restored. Eighteen raw execution logs and the exact qualifier report are retained. Four detector controls and two classifier controls also passed; both new workflows pass actionlint.

The initial qualifier stopped safely at a real assertion failure because libtest printed the test name and FAILED on separate lines. That first output is retained; no mutation credit was granted until the parser was corrected and independently reviewed. Review also found that an unrelated panic could receive credit; the corrected classifier requires each probe's expected assertion and rejects setup unwrap/panic failures.

The initial npm observation failed with HTTP404 for an incorrect unscoped CLI name. Independent review identified @getforma/create-app as the actual fourth package; the corrected inventory is tested against all four manifests. The complete corrected registry and actual environment reads are retained. They are baseline observations with delivered:false, not a claim of alert delivery. No credential, repository setting, tag, publication, webhook or external notification was created.

Live identity separation, protection activation and outside delivery remain human/configuration gates documented in docs/governance/ROLLOUT.md.
