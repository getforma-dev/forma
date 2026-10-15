# Candidate template source adapter

These Rust sources are used only while packing coordinated 3.0.x candidates with the `finalized-v1` rendering contract. `stageTemplateSource` authenticates the entire historical A2 main.rs against a reviewed SHA-256 before selecting a replacement; any drift or unsupported contract/version fails closed. The source templates remain byte-identical, and `withStagedTemplates` restores all ten source/manifest/lock files even when packing fails.

The minimal candidate loads the public Pages registry, binds its current empty declared handler contract for SSR, finalizes every route before the listener and renders only via PageHandle. Its browser build declares Browser mode. The dashboard candidate is explicitly Browser, yet still loads/finalizes so an accidental unbound SSR route refuses startup. Neither candidate uses SlotData, raw SSR, caller nonces or executable config scripts. Checked JSON and the dashboard's CSS branding retain their typed homes.

FORMA-144 still owns migration of the source templates and their examples. These adapter files do not complete that ticket or enable publication. P17 tests the actual packed files, policy headers, browser interactions and startup refusals.
