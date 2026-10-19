# L-66-QUOTA — release verification timing and quota recovery

Recorded 2026-10-19 from the founder's instructions in the Forma release chat. This is a decision record, not an audit acceptance, test result or proof of publication. The historical L-66 browser-trace attribution decision is unchanged; the quota directive reused that number, so this record uses the distinct identifier L-66-QUOTA.

## Primary instructions

The founder's October17 quota directive explicitly listed:

> Full 3,600-second active `L-62` burn-in soak (deferred to run as a post-release verification gate on Thursday).

It separately deferred:

> Final `L-65` clean-room sign-off on the combined doc/helper delta.

The founder then authorized only focused independent review and merging PR112 with green CI, retaining the later audit/soak work. PR112 merged after that focused approval; this did not satisfy whole-release audit or authorize an otherwise failing tag.

On October19 the founder corrected the schedule:

> Check main CI once and update the Thursday handoff to today, it was not Thursday it was Monday in which we had to keep going. Thus continue the goal.

The resume date is therefore **Monday, October19,2026**. Earlier Thursday scheduling and the operational pause are superseded. The post-release placement of the soak remains the explicit timing decision; no instruction changes its workload, credited duration or zero-fault requirement.

## Applied scope

- Resume the independent whole-release audit before publishing the RC. Preserve the original beta → independently audited RC → final release sequence.
- Permit final publication before the L-62 soak only through a narrowly scoped, reviewed implementation for3.0.0 that authenticates the published RC set, original P17/audit evidence and the reviewed canonical final delta.
- Represent the soak as **deferred, zero credited active seconds**, never passed. Preserve the ordinary completed-soak route for cases that have actual evidence.
- Run the unchanged3600-second active zero-fault packed RC burn-in after final publication, against the exact authenticated RC used to qualify final. Record its actual later outcome separately; never rewrite the final release's original deferred claim as if the run had occurred earlier.
- Keep trusted OIDC publishing, immutable tags, independent source review, green CI, source-bound packed verification and all product/security tests. No generic publish override or fabricated audit/soak reference.
- After final publication and post-release verification, update the v3 as-built record with actual results and halt before AppendixE consumer migrations. FORMA192/147 external application work remains excluded.

## Current implementation status

Main ee7e5751 prepares3.0.0 but cannot yet publish final: current validators still require the original completed-soak reference. The narrow implementation is being prepared before the final RC audit freeze so final-diff validation does not need an exception for new release code after RC. No actualRC tag, audit acceptance, burn-in reference or final publication is created by this record. Existing failed runs remain failed.
