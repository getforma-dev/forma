# Phase-only TCP counter diagnostic

Base ee03d1cc preserves the original 408/3 WebKit failure. This local diagnostic branch instruments only the common TCP counter and three calls immediately before the existing host Image reachability controls. Every original forbidden-connection-zero assertion, security refusal, rendered DOM assertion, 1.5 second observation and positive connection assertion remains unchanged.

Each accepted socket is numbered and logs its acceptance phase. Socket errors record that phase, current phase/count, code and message. The exact original Error objects are retained and rethrown as an AggregateError after owned sockets/server close. ECONNRESET receives no exemption; unknown errors also remain failures. A counter event marks the start of the positive control only after all protected-phase assertions have completed.

The proposed command selects the same three failing WebKit cases once with two workers and the already built unchanged runtime. No browser has run on this diagnostic source. No production source, headers, waits, retries, thresholds or connection criteria change. The original failure evidence remains immutable. This instrumentation is not the proposed final repair.
