# Same-binary runtime image comparison

`harness/compare-runtime.mjs` compares the original Forma Debian-slim image with
an optional distroless image. It exports `/usr/local/bin/grandprix` from the
original image, builds `contestants/forma/Dockerfile.runtime` from those exact
bytes, and checks the exported copy's SHA-256 before starting either server.
The ordinary Forma Dockerfile and the fourteen-car baseline are unchanged.

Run this after building a Forma image and before removing it. Pass the immutable
image ID from `docker image inspect`, the exact source commit recorded for that
build, an existing builder, and a new evidence directory:

```sh
GP_RUN_ID=runtime-example node harness/compare-runtime.mjs \
  --source-image sha256:FULL_IMAGE_ID \
  --source-commit FULL_SOURCE_COMMIT \
  --builder EXISTING_BUILDER \
  --out results/runtime-example
```

The source image must have the `grandprix=forma-264` label. Generated containers
and the comparison image receive both that label and this invocation's
`gp264run` label. The helper removes only the container IDs and comparison image
ID it created, including on failure. It retains the original image and leaves
the supplied builder and its cache intact. `harness/cleanup.mjs` can recover
labelled resources from an interrupted invocation using the same `GP_RUN_ID`.

The alternative base is `gcr.io/distroless/cc-debian13:nonroot`, pinned to the
multi-architecture image index
`sha256:3ee00291cf386ec52a552e6a858d555debd74776eb4bfa53fa3df2cd6677515e`.
The [upstream image catalogue](https://github.com/GoogleContainerTools/distroless#what-images-are-available)
lists this C/C++ runtime base and its supported architectures. This comparison
retains the Bookworm-built glibc binary and uses the base's UID 65532; it does
not claim a statically linked binary or silently replace the Debian baseline.

Evidence includes both complete image-inspection records, image byte sizes,
release-binary size and SHA-256, Dockerfile hash, and raw response bodies and
headers. Both containers run with one CPU and 1 GiB of memory. `/health` must
return `200 ok`; `/ssr` must return the requested 10, 100 and 1,000 rows with
identical HTML and response policy. Only the nonce advertised by each same
response's CSP is normalized before comparison. No markup or data is removed.

This is an image-size and HTTP correctness comparison. Its output explicitly
sets `performanceQualified: false`: it measures no startup, memory, throughput
or latency, and it does not replace any original race or budget result. An
application using outbound TLS, local writes or other OS services needs its
own deployment checks before choosing this runtime base.
