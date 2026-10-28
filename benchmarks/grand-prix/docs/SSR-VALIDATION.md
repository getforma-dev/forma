# Prospective SSR checks in laboratory-1

The maintained laboratory validates every server-rendered table row before timing.
All 10, 100 or 1,000 ordered IDs and all six cells must match the canonical dataset:
ID, label, owner, formatted amount, status and updated date. Missing, repeated,
reordered rows and rows/cells suppressed by `hidden` or inline `display:none` /
`visibility:hidden` fail the same check for every framework. This source validator
does not evaluate external stylesheets; browser appearance remains a separate check. Apparent
rows inside comments, scripts or inert templates do not count as rendered work.

Framework marker comments, additional attributes, the specified status span,
normal HTML whitespace and equivalent character references are allowed. These
semantic allowances never alter the encoded bytes, hashes, response-size measures,
headers or compression evidence retained by the transport harness. New captures
record `semanticValidation: "laboratory-1-rows-v1"`.

The historical Round 1 and Round 2 raw files, reports and protocol records are
unchanged. Their original substring-and-row-count checks were weaker; they are not
retroactively described as having passed laboratory-1 validation. A new run is
required to establish results under the strengthened contract. The negative controls
in `harness/ssr-contract.test.mjs` demonstrate failures that the earlier count and
summary checks could miss.
