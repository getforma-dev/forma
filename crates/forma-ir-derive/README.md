# forma-ir-derive

Derive macros for [forma-ir](https://crates.io/crates/forma-ir), part of the
[Forma](https://github.com/getforma-dev/forma) stack.

**Version 0.0.0 is a placeholder that exports nothing.** It exists so every later version is
published only by the repository's release workflow, through crates.io's trusted publishing.

The first working version ships with Forma 3.0.0. It provides `#[derive(PageProps)]`, which
describes a Rust struct as a page's props so that forma-server can check, when the server starts,
that the struct matches the props the page's compiled template declares. forma-ir re-exports it;
depend on forma-ir, not on this crate.

Licensed under the MIT licence.
