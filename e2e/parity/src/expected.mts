/**
 * Known divergences, as data (`e2e/parity/expected-divergent.json`). The harness never skips
 * (TESTING.md P7): a case that cannot pass yet is run and must report the divergence its entry
 * predicts, and an entry that predicts a divergence the run no longer shows fails the run, so an
 * entry is removed the day its ticket lands (the SSR lane's `test.fail()` discipline, in data).
 *
 * An entry matches a difference by module, state index (or `*`), check, kind and, when given,
 * path and a pattern over both values; an entry of kind `error` matches a report whose verdict is
 * `error` by a pattern over its message. A report is expected-divergent when every one of its
 * differences (or its error) is matched; one unmatched difference keeps it `different`.
 */
import { readFileSync } from 'node:fs';
import type { Difference, DiffKind, Report } from './compare.mts';

export interface ExpectedEntry {
  readonly module: string;
  readonly index: number | '*';
  readonly check: 'P1' | 'P2' | 'P3';
  readonly kind: DiffKind | 'error';
  readonly path?: string;
  /** A regular expression tested against `server → client` of the difference, or the error message. */
  readonly match?: string;
  /** The ticket whose change clears it, or `finding:` and where it was reported. */
  readonly ticket: string;
  readonly note: string;
}

const KINDS: ReadonlySet<string> = new Set([
  'tag', 'namespace', 'attribute-missing', 'attribute-extra', 'missing', 'extra',
  'attribute-value', 'attribute-namespace', 'text', 'comment', 'key', 'mutation', 'activation-error', 'error',
]);

/**
 * Why an entry cannot be used, or null. An entry names its module, check and kind, the ticket that
 * clears it and why; a state index, or `*` only together with a path (an error has no path, and is
 * pinned by its message); and a pattern: the message for `error`, both values for every other kind
 * (`server → client`), so a changed value is never swallowed by an entry written for another.
 */
export function invalidEntry(entry: Partial<ExpectedEntry>): string | null {
  if (typeof entry.module !== 'string' || !entry.module) return 'it names no module';
  if (!['P1', 'P2', 'P3'].includes(entry.check as string)) return `its check ${JSON.stringify(entry.check)} is not P1, P2 or P3`;
  if (typeof entry.kind !== 'string' || !KINDS.has(entry.kind)) return `its kind ${JSON.stringify(entry.kind)} is not a difference kind or error`;
  if (typeof entry.ticket !== 'string' || !entry.ticket) return 'it names no ticket';
  if (typeof entry.note !== 'string' || !entry.note) return 'it says nothing of why';
  const numeric = typeof entry.index === 'number' && Number.isInteger(entry.index) && entry.index >= 0;
  if (!numeric && entry.index !== '*') return `its index ${JSON.stringify(entry.index)} is neither a state index nor "*"`;
  if (entry.index === '*' && entry.kind !== 'error' && (typeof entry.path !== 'string' || !entry.path)) return 'index "*" needs a path';
  if (typeof entry.match !== 'string' || !entry.match) return entry.kind === 'error' ? 'an error entry needs a message pattern (match)' : 'it needs a value pattern (match, over "server → client")';
  try { new RegExp(entry.match, 'u'); } catch (error) { return `its match is not a pattern: ${error instanceof Error ? error.message : String(error)}`; }
  return null;
}

/** The expected list, every entry validated; one invalid entry fails the run, naming it. */
export function readExpected(file: URL | string = new URL('../expected-divergent.json', import.meta.url)): readonly ExpectedEntry[] {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { entries: Partial<ExpectedEntry>[] };
  if (!Array.isArray(parsed.entries)) throw new Error(`${String(file)}: no entries array`);
  parsed.entries.forEach((entry, i) => {
    const why = invalidEntry(entry);
    if (why) throw new Error(`${String(file)}: entry ${i} (${entry.module ?? '?'} ${entry.check ?? '?'} ${entry.kind ?? '?'}) is invalid: ${why}`);
  });
  return parsed.entries as ExpectedEntry[];
}

function covers(entry: ExpectedEntry, report: Report): boolean {
  return entry.module === report.module && entry.check === report.check && (entry.index === '*' || entry.index === report.index);
}

function matchesDifference(entry: ExpectedEntry, difference: Difference): boolean {
  if (entry.kind !== difference.kind) return false;
  if (entry.path !== undefined && entry.path !== difference.path) return false;
  if (entry.match !== undefined && !new RegExp(entry.match, 'u').test(`${difference.server ?? ''} → ${difference.client ?? ''}`)) return false;
  return true;
}

function matchesError(entry: ExpectedEntry, report: Report): boolean {
  return entry.kind === 'error' && report.verdict === 'error' && (entry.match === undefined || new RegExp(entry.match, 'u').test(report.error ?? ''));
}

export interface Applied {
  readonly reports: readonly Report[];
  /** Entries for modules and states this run covered that matched nothing: the divergence is gone. */
  readonly unexpectedPasses: readonly ExpectedEntry[];
}

/** Mark the reports every entry explains; list the entries that explained nothing. */
export function applyExpected(reports: readonly Report[], entries: readonly ExpectedEntry[]): Applied {
  const used = new Set<ExpectedEntry>();
  const out = reports.map(report => {
    const candidates = entries.filter(entry => covers(entry, report));
    if (!candidates.length) return report;
    if (report.verdict === 'error') {
      const entry = candidates.find(candidate => matchesError(candidate, report));
      if (!entry) return report;
      used.add(entry);
      return { ...report, verdict: 'expected-divergent' as const, expected: { ticket: entry.ticket, note: entry.note } };
    }
    if (report.verdict !== 'different') return report;
    const tickets = new Set<string>();
    let all = true;
    for (const difference of report.differences) {
      const entry = candidates.find(candidate => matchesDifference(candidate, difference));
      if (!entry) { all = false; continue; }
      used.add(entry);
      tickets.add(entry.ticket);
    }
    return all ? { ...report, verdict: 'expected-divergent' as const, expected: { ticket: [...tickets].join(', '), note: candidates.filter(c => used.has(c)).map(c => c.note).join(' / ') } } : report;
  });
  const ran = (entry: ExpectedEntry) => reports.some(report => covers(entry, report));
  return { reports: out, unexpectedPasses: entries.filter(entry => ran(entry) && !used.has(entry)) };
}
