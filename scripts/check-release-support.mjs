#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readSupportHistory, assertPublicationAllowed } from './release-support-history.mjs';
try {
  assert.equal(process.env.GITHUB_REPOSITORY, 'getforma-dev/forma');
  const tag = process.env.GITHUB_REF_NAME;
  assert.equal(process.env.GITHUB_REF, `refs/tags/${tag}`);
  const history = await readSupportHistory({ targetTag: tag });
  assertPublicationAllowed(history, tag);
  console.log(JSON.stringify({ tag, passed: true, sources: history.sources, inventorySha256: history.inventorySha256, existingPublishedAt: history.targetMetadata?.published_at ?? null }));
} catch (error) { console.error(`release-support: ${error.message}`); process.exitCode = 1; }
