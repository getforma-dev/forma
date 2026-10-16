# Frame TCP reachability control repair qualification

At reviewed source c281faaf96dc5b61d6242a6c853ae9f2b22531bd, the three unchanged frame control bodies passed once in all three Playwright 1.64.1 engines (9/9, 13.8 seconds). A subsequent independently authorized full WebKit core run rebuilt core and passed all 411 cases (1.3 minutes), including the native select baseline repair. Node 24.22.0 and at most two Playwright workers were used. All owned commands exited zero; fixture/counter ports had no remaining listeners.

The HTTP responder fixes only the host Image positive-control protocol: every raw TCP connection still increments the counter before HTTP parsing, and all socket/server/client errors remain failures. The original protected zero-connection, DOM and coded-refusal assertions and positive reachability assertions are unchanged. The exact phase diagnostic is preserved at `../../archive/frame-tcp-control-diagnostic/`; the earlier 408/3 failed qualification remains at `../webkit-native-select-baseline/`. These runs follow reviewed causal changes; no unchanged-source retry or threshold change occurred.

The result records exact source/runtime/lock hashes and commands. This is local correctness evidence; current hosted CI and Linux engine qualification remain pending. It is not release performance or full-release acceptance.
