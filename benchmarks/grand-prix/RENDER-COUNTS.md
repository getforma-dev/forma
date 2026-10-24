# Instrumented walker timing

`harness/render-counts.mjs` measures the existing
`PageResponse.counts().walk_time` for 100 and 1,000 rows. It runs after the main
server races using a separate executable; it never changes a raced image or
adds instrumentation to the framework.

The helper verifies that the retained build image's release binary is byte
identical to the original runtime binary. In a run-owned container it copies
the car's original Rust source, adds four numeric response headers, and rebuilds
only the application with its existing `Cargo.lock` and `--locked --offline`.
The new executable is mounted read-only over the original executable in a
separate one-CPU, 1-GiB runtime container. Both original image IDs and executable
SHA-256 values are recorded; the runtime image ID alone does not identify this
instrumented process.

For each row count, twenty requests warm the instrumented server before 101
serial samples. The headers expose walker time in nanoseconds, root bytes,
nodes and list iterations. The pre-existing walker timer stops before header
formatting, document response transfer, or this instrumentation. Props
conversion and document assembly are also excluded by the public API's timer.
This does not measure complete request latency or throughput.

Every instrumented response body must exactly equal the original car's body at
the same row count. The original must have no instrumentation headers. Both
original HTML bodies, the complete original and instrumented Rust source, a
source diff, consumer lock, both image-inspection records, instrumented
container/mount inspection and raw samples are retained. The report includes
mean, median, p95, p99 and range for walker nanoseconds and nanoseconds per
walker byte, with document bytes reported separately.

```sh
GP_RUN_ID=counts-example node harness/render-counts.mjs \
  --runtime-image sha256:FULL_RUNTIME_IMAGE_ID \
  --build-image sha256:FULL_BUILD_IMAGE_ID \
  --source-commit FULL_SOURCE_COMMIT \
  --out results/counts-example
```

A qualified measurement uses the selected `native-8-v1` or `gha-4-v1` Linux
resource profile and a host load average below two after compilation. Select
`GP_PROFILE=gha-4-v1` only for the dated four-CPU GitHub Actions baseline. The
one-CPU container is pinned to that profile's Class A CPU, and its actual
Docker affinity is checked and retained. Results with different profile names
must not be used to claim before/after gains. `--diagnostic` retains the
same sample count and container limits while marking a smaller or non-Linux
host as diagnostic. Only containers created by this helper are removed; the
original runtime and build images stay available to their owning driver.

The Linux driver runs this separately after the ordinary Forma measurements.
Its paired runner therefore retains published, static-mode, walker-optimization
and combined observations from the exact supplied commits on the same VM,
alongside the uninstrumented HTTP race. Counts from an island route are not
substituted for these no-JavaScript dashboard observations.
