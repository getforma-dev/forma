# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: frame.spec.ts >> a module's <link> survives no second parse: foreign content and foster parenting open no connection, after render and after update()
- Location: e2e/frame.spec.ts:247:1

# Error details

```
AggregateError: TCP counter 3906 captured socket errors
```

```
Error: read ECONNRESET
```

```
Error: read ECONNRESET
```

```
Error: read ECONNRESET
```

# Page snapshot

```yaml
- iframe [ref=e2]:
  - generic [ref=f1e2]:
    - math [ref=f1e3]:
      - generic [ref=f1e4]:
        - generic [ref=f1e5]: "-->"
        - table
    - paragraph [ref=f1e6]: 5-updated
```