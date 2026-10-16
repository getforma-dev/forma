// One sequential owner accounts for the complete retained attempt, including
// downloaded compressed evidence and its extracted members. Work/build caches
// are separate owned scratch and are never mistaken for retained evidence.
import assert from 'node:assert/strict';
import { closeSync, fsyncSync, lstatSync, openSync, readdirSync, writeSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
export const MAX_EVIDENCE_BYTES = 2 * 1024 * 1024 * 1024;
export function evidenceBytes(root) {
  let total = 0, count = 0;
  const walk = dir => { for (const name of readdirSync(dir)) {
    const path = join(dir, name), stat = lstatSync(path); assert(!stat.isSymbolicLink(), 'evidence symlink');
    if (stat.isDirectory()) walk(path);
    else { assert(stat.isFile()); total += stat.size; assert(++count <= 16384 && total <= MAX_EVIDENCE_BYTES, 'attempt evidence exceeds count/byte limit'); }
  } };
  walk(root); return total;
}
export function evidenceRoom(root, reserve = 0) {
  assert(Number.isSafeInteger(reserve) && reserve >= 0);
  const remaining = MAX_EVIDENCE_BYTES - evidenceBytes(root);
  assert(remaining >= reserve, 'attempt evidence has insufficient bounded room');
  return remaining;
}
export function writeEvidence(root, path, bytes) {
  const name = relative(root, path);
  assert(name && !isAbsolute(name) && !name.startsWith('..'), 'evidence write outside owned root');
  bytes = Buffer.from(bytes); evidenceRoom(root, bytes.length);
  const fd = openSync(path, 'wx');
  try { let offset = 0; while (offset < bytes.length) offset += writeSync(fd, bytes, offset); fsyncSync(fd); }
  finally { closeSync(fd); }
}
