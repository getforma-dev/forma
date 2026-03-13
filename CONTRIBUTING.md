# Contributing to Forma

## Setup

```bash
git clone https://github.com/getforma-dev/forma.git
cd forma
cargo test --workspace
cargo clippy --workspace
```

## Development

- `cargo test --workspace` — run all tests
- `cargo clippy --workspace` — lint
- `cargo doc --workspace --no-deps` — build docs

## Crate Structure

- `crates/forma-ir/` — Binary IR format parser and walker
- `crates/forma-server/` — Axum middleware for SSR

## Pull Requests

1. Fork and create a feature branch
2. Add tests for new functionality
3. Ensure `cargo test --workspace` passes
4. Ensure `cargo clippy --workspace -- -D warnings` passes
5. Submit PR with clear description
