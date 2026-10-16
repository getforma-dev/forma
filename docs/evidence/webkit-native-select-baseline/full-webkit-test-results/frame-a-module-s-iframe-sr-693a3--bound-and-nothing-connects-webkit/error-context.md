# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: frame.spec.ts >> a module's iframe srcdoc renders no document: the attribute is removed, written or bound, and nothing connects
- Location: e2e/frame.spec.ts:277:1

# Error details

```
Error: read ECONNRESET
```

# Page snapshot

```yaml
- iframe [ref=e2]:
  - generic [ref=f1e2]:
    - iframe [ref=f1e3]
    - iframe [ref=f1e5]
    - paragraph [ref=f1e6]: x
```