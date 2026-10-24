// Inlined by report.mjs inside the report's closure (it uses D, S, esc, fmt, md, mdInline, views).
// The reader's views: who is racing, what each race measures, the measurements beyond the score,
// the Forma report and the race log. Data: results/guide.json, cars.json, forma-report.json and
// summary.telemetry (score.mjs).
var G = D.guide || {}, C = D.cars || { server: [], client: [], signals: [] }, FR = D.formaReport, T = S.telemetry || { server: {}, dom: {}, signals: {}, signalsVersionCheck: {} };
var multicoreCpus = S.resourceProfile ? Number(S.resourceProfile.classB.cpus) : 4;
function nf(v, d) { return v == null || isNaN(v) ? '-' : (+v).toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }) }
function mops(v) { v = v / 1e6; return v >= 1 ? nf(v, 2) : nf(v, 3) }
function mb(b) { return b == null ? '-' : (b / 1e6).toFixed(1) + ' MB' }
function kb(b) { return b == null ? '-' : b >= 1e4 ? (b / 1e3).toFixed(1) + ' kB' : nf(b) + ' B' }
function isForma(c) { return /^forma/.test(c) }
function order(event, part) { var c = S.contests.filter(function (x) { return x.event === event && (!part || x.id === event + '-' + part) })[0]; return c ? c.standings.map(function (s) { return s.car }) : [] }
// cols: [label, leftAlign?]; rows: [car, [cells]]
function table(cols, rows, caption) {
  return (caption ? '<p class="note">' + caption + '</p>' : '') + '<div class="scroll"><table><thead><tr>' + cols.map(function (c) { return '<th' + (c[1] ? ' class="l"' : '') + '>' + esc(c[0]).replace(/µ/g, '<span style="text-transform:none">µ</span>') + '</th>' }).join('') + '</tr></thead><tbody>' +
    rows.map(function (r) { return '<tr' + (isForma(r[0]) ? ' class="fr"' : '') + '>' + r[1].map(function (x, i) { return '<td' + (cols[i] && cols[i][1] ? ' class="l"' : '') + '>' + x + '</td>' }).join('') + '</tr>' }).join('') + '</tbody></table></div>'
}
function card(c, fields) {
  return '<div class="carcard' + (isForma(c.id) ? ' fc' : '') + '"><div class="ct"><b>' + esc(c.name) + '</b> <code>' + esc(c.id) + '</code></div><dl>' +
    fields.filter(function (f) { return c[f[0]] != null && c[f[0]] !== '' }).map(function (f) { var v = c[f[0]]; if (f[2]) v = f[2](v); else v = mdInline(String(v)); return '<dt>' + esc(f[1]) + '</dt><dd>' + v + '</dd>' }).join('') + '</dl></div>'
}
function explain(id) {
  var e = (G.events || {})[id]; if (!e) return '';
  return '<div class="panel explain"><div class="exg">' + [['What it measures', e.what], ['How it is measured', e.how], ['Why it matters', e.why], ['What it tests in Forma', e.forma]].map(function (x) { return '<div><h4>' + x[0] + '</h4><p>' + mdInline(x[1]) + '</p></div>' }).join('') + '</div></div>'
}
views.intro = function () {
  var ev = (D.events || []).map(function (e) { var x = (G.events || {})[e.id] || {}; var c = S.contests.filter(function (k) { return k.event === e.id })[0]; return [e.id, ['<b>' + e.n + '</b>', esc(e.title), mdInline(x.what || ''), c ? esc(c.unit + ', ' + c.better + ' is better') : '', c ? String(c.standings.length) : '']] });
  var srv = C.server.map(function (c) { return card(c, [['runtime', 'Runtime'], ['framework', 'Framework'], ['httpServer', 'HTTP server'], ['render', 'How it renders'], ['multicore', 'With ' + multicoreCpus + ' CPUs'], ['pageExtras', 'Page carries'], ['build', 'Build'], ['startCommand', 'Start'], ['baseImage', 'Base image'], ['imageMB', 'Image', function (v) { return nf(v, 0) + ' MB' + (c.buildImageMB ? ' (build image ' + nf(c.buildImageMB, 0) + ' MB)' : '') }], ['compressesWhenAsked', 'Compresses when asked', function (v) { return v ? 'yes' : 'no' }], ['notes', 'Notes']]) }).join('');
  var cli = C.client.map(function (c) { return card(c, [['library', 'Library'], ['approach', 'How it updates the DOM'], ['build', 'Build'], ['bundleBrotli', 'Bundle', function (v) { return nf(v) + ' B Brotli (' + nf(c.bundleRaw) + ' B raw)' }], ['notes', 'Notes']]) }).join('');
  var sig = C.signals.map(function (c) { return card(c, [['package', 'Package'], ['role', 'Role'], ['notes', 'Adapter']]) }).join('');
  return '<h2>Start here</h2><div class="panel">' + md(G.intro) + '</div><div class="panel"><h3>Who is racing, and what "vanilla" means</h3>' + md(G.naming) + '</div><div class="panel"><h3>The track</h3>' + md(G.track) + '</div>' +
    '<h2>The eleven events</h2><div class="panel">' + table([['#'], ['Event', 1], ['What it measures', 1], ['Scored by', 1], ['Cars']], ev) + '<p class="note">Each event tab opens with what it measures, how, why it matters and what it tests in Forma, then the podium, every run, more measurements and the commentary.</p></div>' +
    '<h2>The grid: 14 server cars (events 1 to 8)</h2><div class="cards">' + srv + '</div>' +
    '<h2>The grid: 7 client cars (events 9 and 10)</h2><div class="cards">' + cli + '</div>' +
    '<h2>The grid: 5 reactive cores (event 11)</h2><div class="cards">' + sig + '</div>' +
    '<div class="cols"><div class="panel"><h3>Classes and limits</h3>' + md(G.classes) + '</div><div class="panel"><h3>The machine</h3>' + md(G.machine) + '</div></div>' +
    '<div class="panel"><h3>How to read this report</h3>' + md(G.howToRead) + '</div><div class="panel"><h3>Glossary</h3>' + md(G.glossary) + '</div>'
};
function loadRows(event) {
  return order(event).map(function (car) {
    var t = T.server[car] || {}, x = t[event] || {};
    var cells = ['<span class="l">' + esc(car) + '</span>', nf(x.rps, x.rps < 100 ? 1 : 0), nf(x.p50, 1), nf(x.p95, 1), nf(x.p99, 1), nf(x.max, 0), nf(x.mbPerS, 0), kb(x.bytes)];
    if (event === 'endurance') cells.push(nf((1e6 / t.endurance.rps - 1e6 / t.sprint.rps) / 900, 1), nf(t.nsPerByte, 1), nf(t.loss100to1000, 1) + 'x');
    if (event === 'multicore') cells.push(nf(t.scaling == null ? t.scaling4 : t.scaling, 2) + 'x');
    if (event === 'sprint') cells.push(nf(t.usPerPage100, 0));
    return [car, cells];
  });
}
function more(id) {
  var h = '', cols;
  if (id === 'sprint' || id === 'endurance' || id === 'multicore') {
    cols = [['Car', 1], ['req/s'], ['p50 ms'], ['p95 ms'], ['p99 ms'], ['max ms'], ['MB/s'], ['page']];
    if (id === 'endurance') cols.push(['µs per row'], ['ns per byte'], ['loss 100 to 1,000']);
    if (id === 'multicore') cols.push(['scaling 1 to ' + multicoreCpus + ' CPUs']);
    if (id === 'sprint') cols.push(['µs per page']);
    h = table(cols, loadRows(id), 'Latency is what the 64 waiting connections saw, mean of the runs. MB/s is req/s times the page size, so it compares cars that send different pages.' + (id === 'endurance' ? ' µs per row and ns per byte are the marginal cost from 100 to 1,000 rows on one CPU; loss is how many times throughput falls when the page has ten times the rows (10x is linear).' : id === 'multicore' ? ' Scaling is Multi-core req/s over Sprint req/s; ' + nf(multicoreCpus, 2) + 'x is ideal linear scaling.' : ' µs per page is one CPU\'s time per 100-row page (1,000,000 / req/s).'));
  } else if (id === 'reaction') {
    h = table([['Car', 1], ['p99 ms'], ['mean ms'], ['p50 ms'], ['max ms'], ['µs per page under load']], order('reaction').map(function (car) { var t = T.server[car] || {}, r = t.reaction || {}; return [car, [esc(car), nf(r.p99, 2), nf(r.mean, 2), nf(r.p50, 2), nf(r.max, 1), nf(t.usPerPage100, 0)]] }), 'One request at a time. The last column is the Sprint\'s CPU time per page, for comparison.');
  } else if (id === 'fuel') {
    h = table([['Car', 1], ['peak MiB'], ['idle MiB'], ['req/s per MiB']], order('fuel').map(function (car) { var t = T.server[car] || {}; return [car, [esc(car), nf(t.peakMiB, 1), nf(t.idleMiB, 1), nf(t.rpsPerMiB, 0)]] }), 'Idle is the container\'s memory before load. req/s per MiB is Sprint throughput over peak memory: pages served per unit of memory paid for.');
  } else if (id === 'grid') {
    h = table([['Car', 1], ['to first 200 ms'], ['Docker start ms'], ['app boot ms']], order('grid').map(function (car) { var g = (T.server[car] || {}).grid || {}; return [car, [esc(car), nf(g.total, 0), nf(g.dockerRun, 0), nf(g.appBoot, 0)]] }), 'Docker start is the time until docker run returned (container created and started). App boot is the rest: from a running container to the first 200. Docker start is shared overhead; app boot is the stack.');
  } else if (id === 'weight') {
    h = table([['Car', 1], ['image'], ['build image'], ['page raw'], ['page gzip'], ['gzip ratio'], ['compresses when asked']], order('weight', 'image').map(function (car) { var t = T.server[car] || {}, cc = (C.server.filter(function (x) { return x.id === car })[0]) || {}; return [car, [esc(car), mb(t.imageBytes), cc.buildImageMB ? nf(cc.buildImageMB, 0) + ' MB' : '-', kb(t.rawBytes), kb(t.gzipBytes), t.rawBytes ? (t.rawBytes / t.gzipBytes).toFixed(1) + 'x' : '-', t.compressesWhenAsked ? esc(t.compressesWhenAsked) : 'no']] }), 'Compresses when asked: whether the server itself sent Content-Encoding when the harness asked for gzip. Without it, a proxy or CDN must compress.');
  } else if (id === 'pitstop') {
    h = table([['Car', 1], ['build ms']], order('pitstop').map(function (car) { var t = T.server[car] || {}; return [car, [esc(car), nf(t.buildMs, 0)]] }));
    var f = (T.server.forma || {}).buildSplit; if (f) h += '<div class="panel"><b>Forma\'s build, split.</b> FMIR build ' + nf(f.fmirMs, 0) + ' ms, then the app crate\'s release compile ' + nf(f.appCompileMs, 0) + ' ms (dependencies already compiled), mean of three runs. Cold compile from an empty target, every dependency included: ' + nf(f.coldRustMs, 0) + ' ms (one run, not scored).</div>';
  } else if (id === 'dom') {
    var cars = order('dom'), ops = Object.keys(T.dom[cars[0]] || {});
    h = table([['Operation', 1]].concat(cars.map(function (c) { return [c] })).concat([['Forma vs best']]), ops.map(function (op) {
      var vals = cars.map(function (c) { return (T.dom[c] || {})[op] ? T.dom[c][op].mean : null }), best = Math.min.apply(null, vals.filter(function (v) { return v != null }));
      var fv = (T.dom.forma || {})[op] ? T.dom.forma[op].mean : null;
      return [op, [esc(op)].concat(vals.map(function (v) { return v === best ? '<b>' + nf(v, 1) + '</b>' : nf(v, 1) })).concat([fv == null ? '-' : fv === best ? 'best' : '+' + nf((fv / best - 1) * 100, 0) + '%'])];
    }), 'Mean ms per operation, five runs; bold is the fastest. Readings below Chrome\'s 0.1 ms clock step show as 0.1.');
  } else if (id === 'bundle') {
    h = table([['Car', 1], ['Brotli'], ['gzip'], ['raw']], order('bundle').map(function (car) { var r = (D.raw.bundle || {})[car] || {}; return [car, [esc(car), nf(r.brotli) + ' B', nf(r.gzip) + ' B', nf(r.bytes) + ' B']] }));
  } else if (id === 'signals') {
    var libs = order('signals'), benches = Object.keys(((T.signals[libs[0]] || {}).benches) || {});
    h = table([['Benchmark', 1]].concat(libs.map(function (c) { return [c + ' ' + ((T.signals[c] || {}).version || '')] })).concat([['Forma / alien-signals']]), benches.map(function (b) {
      var vals = libs.map(function (c) { return T.signals[c].benches[b].mean }), best = Math.max.apply(null, vals);
      return [b, [esc(b)].concat(vals.map(function (v) { return (v === best ? '<b>' : '') + mops(v) + (v === best ? '</b>' : '') })).concat([nf(T.signals.forma.benches[b].mean / T.signals['alien-signals'].benches[b].mean * 100, 0) + '%'])];
    }), 'Millions of operations per second, mean of five runs; bold is the fastest. Vue\'s reactivity has no public batch, so its adapter runs the batch benchmark unbatched.');
    var V = T.signalsVersionCheck; if (V && V.forma && V['alien-signals-3.1.2']) {
      h += '<h3>Version check: Forma against the alien-signals it is built on</h3>' + table([['Benchmark', 1], ['forma 3.0.0'], ['alien-signals 3.1.2 (Forma\'s copy)'], ['alien-signals 3.2.1'], ['Forma / its own alien']], Object.keys(V.forma.benches).map(function (b) { var f = V.forma.benches[b].mean, a = V['alien-signals-3.1.2'].benches[b].mean, a2 = V['alien-signals'].benches[b].mean; return [b, [esc(b), mops(f), mops(a), mops(a2), '<b>' + nf(f / a * 100, 0) + '%</b>']] }).concat([['geo', ['<b>geometric mean</b>', mops(V.forma.geomean), mops(V['alien-signals-3.1.2'].geomean), mops(V['alien-signals'].geomean), '<b>' + nf(V.forma.geomean / V['alien-signals-3.1.2'].geomean * 100, 0) + '%</b>']]]), '@getforma/core 3.0.0 resolves alien-signals 3.1.2; the raced reference was 3.2.1. All three ran back to back (' + esc((V.forma.measuredAt || '').slice(0, 16).replace('T', ' ')) + ' UTC), not scored. 3.1.2 is as fast as 3.2.1, so the gap is Forma\'s own layer: effects.');
    }
  }
  return h ? '<div class="panel"><h3>More measurements</h3>' + h + '</div>' : '';
}
views.__explain = explain; views.__more = more;
function times(c, f) { if (c.better === 'higher') return c.standings[0].mean / f.mean; return f.mean / c.standings[0].mean }
function round2Report() {
  var r = D.round2;
  if (!r) return '';
  var h = '<h2>Round 2: measured changes</h2><div class="panel"><p>' + esc(r.status) + '</p><p class="note">' + esc(r.method) + '</p></div>';
  (r.sections || []).forEach(function (section) {
    h += '<div class="panel"><h3>' + esc(section.title) + '</h3><p>' + esc(section.description) + '</p>';
    if (section.columns && section.rows) h += table(section.columns.map(function (column, i) { return [column, i === 0 ? 1 : 0] }),
      section.rows.map(function (row) { return ['', row.map(esc)] }), esc(section.note || ''));
    (section.sources || []).forEach(function (source) {
      // Only recorded HTTPS sources become links; data cannot inject a scheme.
      h += '<p class="note">' + (/^https:\/\//.test(source.url) ? '<a href="' + esc(source.url) + '" target="_blank" rel="noopener noreferrer">' + esc(source.label) + '</a>' : esc(source.label)) + '</p>';
    });
    h += '</div>';
  });
  return h;
}
views.forma = function () {
  if (!FR) return '<p class="note">results/forma-report.json missing.</p>';
  var rows = S.contests.map(function (c) {
    var f = c.standings.filter(function (s) { return s.car === 'forma' })[0]; if (!f) return null;
    var w = c.standings[0], fw = c.standings.filter(function (s) { return !/^vanilla|^alien|^forma/.test(s.car) })[0];
    var gap = function (o) { if (!o) return '-'; if (o.car === 'forma') return '-'; var x = c.better === 'higher' ? o.mean / f.mean : f.mean / o.mean; return x <= 1 ? '<span class="good">ahead ' + nf(1 / x, 1) + 'x</span>' : nf(x, 2) + 'x' };
    return ['forma', [esc(c.n + ' ' + c.title), '<span class="rank r' + f.rank + '">' + f.rank + '</span> of ' + c.standings.length, esc(fmt(f.mean, c.unit)), esc(w.car) + '<br><span class="note">' + esc(fmt(w.mean, c.unit)) + '</span>', f.rank === 1 ? '<span class="good">wins</span>' : gap(w), fw ? esc(fw.car) + '<br><span class="note">' + esc(fmt(fw.mean, c.unit)) + '</span>' : '-', gap(fw), String(+f.points.toFixed(1))]];
  }).filter(Boolean).map(function (r) { r[0] = 'x'; return r });
  var sc = table([['Event', 1], ['Place'], ['Forma'], ['Winner', 1], ['Gap'], ['Best framework', 1], ['Gap'], ['Pts']], rows, 'Best framework leaves out the vanilla cars and alien-signals, which are references, not frameworks. Gap: how many times better the other car is on that event\'s measure (1.60x: 60% better); "ahead" when Forma leads.');
  var st = FR.strengths.map(function (s) { return '<div class="panel sw good-b"><h3>' + esc(s.title) + '</h3><p>' + mdInline(s.evidence) + '</p><p class="note"><b>Keep it:</b> ' + mdInline(s.keep) + '</p></div>' }).join('');
  var wk = FR.weaknesses.map(function (w, i) { return '<div class="panel sw"><h3><span class="pri p' + w.priority.slice(1) + '">' + esc(w.priority) + '</span> ' + (i + 1) + '. ' + esc(w.title) + '</h3><p class="note">Events: ' + esc(w.events) + (w.tickets ? ' · Tickets: <b>' + esc(w.tickets.join(', ')) + '</b> (~/dev/Forma/Tickets/0-backlog/)' : '') + '</p><dl class="wk">' + [['Evidence', w.evidence], ['Cause', w.cause], ['Change', w.change], ['Expected effect', w.estimate], ['How to verify', w.verify]].map(function (x) { return '<dt>' + x[0] + '</dt><dd>' + mdInline(x[1]) + '</dd>' }).join('') + '</dl></div>' }).join('');
  return round2Report() + '<h2>Original Forma 3.0.0 report</h2><div class="panel">' + md(FR.summary) + '</div><h2>Original scorecard</h2><div class="panel">' + sc + '</div><h2>Weaknesses, in the order to fix them</h2>' + wk + '<h2>Strengths to keep</h2>' + st +
    '<div class="cols"><div class="panel"><h3>What this race did not test</h3>' + md(FR.notTested) + '</div><div class="panel"><h3>The next race</h3>' + md(FR.nextRace) + (FR.nextRaceTickets ? '<p class="note">Ticket: <b>' + esc(FR.nextRaceTickets.join(', ')) + '</b></p>' : '') + '</div></div>'
};
views.telemetry = function () {
  var cars = order('sprint'), t = T.server;
  var r1 = cars.map(function (c) { var x = t[c]; return [c, [esc(c), nf(x.sprint.rps, 0), nf(x.endurance.rps, 0), nf(x.multicore.rps, 0), nf(x.scaling == null ? x.scaling4 : x.scaling, 2) + 'x', nf(x.loss100to1000, 1) + 'x', nf(x.usPerPage100, 0), nf(x.nsPerByte, 1), nf(x.sprint.mbPerS, 0), kb(x.sprint.bytes)]] });
  var r2 = cars.map(function (c) { var x = t[c]; return [c, [esc(c), nf(x.sprint.p50, 1), nf(x.sprint.p99, 1), nf(x.sprint.max, 0), nf(x.endurance.p50, 0), nf(x.endurance.p99, 0), nf(x.endurance.p99 / x.endurance.p50, 2), nf(x.reaction.p50, 2), nf(x.reaction.p99, 2)]] });
  var r3 = cars.map(function (c) { var x = t[c]; return [c, [esc(c), nf(x.idleMiB, 1), nf(x.peakMiB, 1), nf(x.rpsPerMiB, 0), nf(x.grid.total, 0), nf(x.grid.appBoot, 0), mb(x.imageBytes), kb(x.gzipBytes), x.compressesWhenAsked ? esc(x.compressesWhenAsked) : 'no', nf(x.buildMs, 0)]] });
  return '<h2>Telemetry: every server car, every measurement</h2><p class="note">Derived from the recorded runs (results/summary.json, telemetry). Rows in Sprint order. Not scored: these explain the scores.</p>' +
    '<div class="panel"><h3>Throughput and render cost</h3>' + table([['Car', 1], ['Sprint req/s'], ['Endurance req/s'], ['Multi-core req/s'], ['1 to ' + multicoreCpus + ' CPUs'], ['100 to 1,000 rows'], ['µs per page'], ['ns per byte'], ['MB/s'], ['page']], r1, 'µs per page: one CPU\'s time per 100-row page. ns per byte: marginal render cost per byte of HTML from 100 to 1,000 rows. 100 to 1,000 rows: how many times throughput falls (10x is linear).') + '</div>' +
    '<div class="panel"><h3>Latency</h3>' + table([['Car', 1], ['Sprint p50'], ['Sprint p99'], ['Sprint max'], ['Endurance p50'], ['Endurance p99'], ['Endurance p99/p50'], ['Reaction p50'], ['Reaction p99']], r2, 'Milliseconds. Sprint and Endurance hold 64 connections; Reaction sends one request at a time. p99/p50 near 1 is a steady tail; large values are pauses (often garbage collection).') + '</div>' +
    '<div class="panel"><h3>Memory, start, weight, build</h3>' + table([['Car', 1], ['idle MiB'], ['peak MiB'], ['req/s per MiB'], ['first 200 ms'], ['app boot ms'], ['image'], ['page gzip'], ['compresses'], ['build ms']], r3) + '</div>'
};
views.log = function () {
  var c = D.cleanup;
  return '<h2>Race log</h2><div class="panel">' + md(G.raceLog) + '</div>' + (c ? '<div class="panel"><h3>Disk</h3><p>Free disk before the race: <b>' + esc(c.diskBefore) + '</b>, before cleanup: <b>' + esc(c.diskBeforeCleanup) + '</b>, after cleanup: <b>' + esc(c.diskAfterCleanup) + '</b>.</p></div>' : '') +
    '<div class="panel"><h3>Files</h3>' + md('- `PROTOCOL.md`: the rules and the three amendments\n- `CONTRACT.md`, `shared/PAGE-SPEC.md`, `client-race/SPEC.md`, `signals-race/SPEC.md`: what every car had to do\n- `results/raw/<event>/<car>.json`: every run, with the machine state\n- `results/summary.json`: scores, standings and telemetry\n- `results/commentary.json`, `results/guide.json`, `results/cars.json`, `results/forma-report.json`: the words in this report\n- `harness/`: the race, the scoring, this report and the cleanup') + '</div>'
};
