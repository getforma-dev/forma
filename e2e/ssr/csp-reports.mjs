// A fixture-only, bounded HTTP report-uri receiver. Never store raw report
// bodies, samples, query strings or fragments. Append-only cursors let parallel
// tests inspect their own document without resetting another test's evidence.
export function createCspReports({ maxBytes = 65_536, maxReports = 1_024 } = {}) {
  const reports = [];
  function normalized(value) {
    const report = value?.['csp-report'];
    if (!report || typeof report !== 'object' || Array.isArray(report)) return null;
    let document;
    try { document = new URL(report['document-uri']); } catch { return null; }
    if (!['http:', 'https:'].includes(document.protocol)) return null;
    if (document.pathname.length > 256) return null;
    if (!/^\/(?:[a-z0-9-]+\/(?:csr)?|__csp-control\/[a-f0-9-]{36})$/.test(document.pathname)) return null;
    const directive = report['effective-directive'];
    if (typeof directive !== 'string' || !/^[a-z-]{1,64}$/.test(directive)) return null;
    // WebKit's legacy report-uri envelope omits disposition. Retain that
    // absence explicitly; never infer enforcement from receiving a report.
    const disposition = report.disposition === undefined ? null : report.disposition;
    if (disposition !== null && disposition !== 'enforce' && disposition !== 'report') return null;
    if (report.disposition === null) return null;
    return { document: document.pathname, directive, disposition };
  }
  async function handle(req, res, url) {
    const answer = (status, body = '') => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(body);
    };
    if (req.method === 'GET') {
      const raw = url.searchParams.get('after') ?? '0';
      if (!/^\d{1,10}$/.test(raw) || Number(raw) > reports.length) return answer(400);
      return answer(200, JSON.stringify({ cursor: reports.length, reports: reports.slice(Number(raw)) }));
    }
    if (req.method !== 'POST') return answer(405);
    if (req.headers['content-type']?.split(';')[0].trim() !== 'application/csp-report') {
      req.resume(); return answer(415);
    }
    if (reports.length >= maxReports) { req.resume(); return answer(429); }
    let bytes = 0;
    const chunks = [];
    try {
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > maxBytes) { answer(413); req.resume(); return; }
        chunks.push(chunk);
      }
      const report = normalized(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (!report) return answer(400);
      // Recheck after the asynchronous body read: concurrent requests cannot
      // exceed the retained count even if they started below the limit.
      if (reports.length >= maxReports) return answer(429);
      reports.push(report);
      answer(204);
    } catch { if (!res.headersSent) answer(400); }
  }
  return { handle };
}
