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

export function readExpected(file = new URL('../expected-divergent.json', import.meta.url)): readonly ExpectedEntry[] {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { entries: ExpectedEntry[] };
  if (!Array.isArray(parsed.entries)) throw new Error(`${String(file)}: no entries array`);
  for (const entry of parsed.entries) {
    if (!entry.module || entry.index === undefined || !entry.check || !entry.kind || !entry.ticket || !entry.note) {
      throw new Error(`${String(file)}: an entry needs module, index, check, kind, ticket and note: ${JSON.stringify(entry)}`);
    }
  }
  return parsed.entries;
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
