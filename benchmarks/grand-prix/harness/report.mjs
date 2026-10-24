#!/usr/bin/env node
// node harness/report.mjs  -> report/index.html (one self-contained file; run score.mjs first)
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, EVENTS } from './lib.mjs';
import { validateSummaryProfile } from './score-profile.mjs';

const argv = process.argv.slice(2);
const option = (name, fallback) => argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback;
const results = path.resolve(option('--baseline-results', path.join(ROOT, 'results')));
const output = path.resolve(option('--out', path.join(ROOT, 'report', 'index.html')));
const rd = (p, fallback = null) => { try { return fs.readFileSync(p.startsWith('results/') ? path.join(results, p.slice(8)) : path.join(ROOT, p), 'utf8'); } catch { return fallback; } };
const rj = (p, fb = null) => { const t = rd(p); if (t == null) return fb; try { return JSON.parse(t); } catch { return fb; } };

const summary = rj('results/summary.json');
if (!summary) { console.error('results/summary.json missing: run node harness/score.mjs first'); process.exit(2); }

// raw runs for the expandable sections
const raw = {};
const base = path.join(results, 'raw');
for (const ev of fs.readdirSync(base)) {
  const dir = path.join(base, ev);
  if (!fs.statSync(dir).isDirectory()) continue;
  raw[ev] = {};
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) { try { raw[ev][f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch {} }
}

const qualification = validateSummaryProfile(summary, raw);
Object.assign(summary, qualification);

// the protocol's own sections, rendered from PROTOCOL.md so the report never paraphrases it
function section(md, title) {
  const m = md.match(new RegExp('^## ' + title + '\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))', 'm'));
  return m ? m[1].trim() : '';
}
const protocol = rd('PROTOCOL.md', '');
const method = { intro: protocol.split(/^## /m)[0].replace(/^# .*\n/, '').trim(), grid: section(protocol, 'The grid'), fairness: section(protocol, 'Fairness'), events: section(protocol, 'Events and points'), runs: section(protocol, 'Runs and outputs'), hygiene: section(protocol, 'Docker hygiene'), amendments: [...protocol.matchAll(/^## (Amendment[^\n]*)\n([\s\S]*?)(?=^## |(?![\s\S]))/gm)].map(m => ({ title: m[1].trim(), body: m[2].trim() })) };
if (qualification.resourceProfile) method.amendments.push({ title: 'Round 2: Linux qualification and resource profile amendments', body: rd('ROUND-2.md', '') });

const data = {
  summary, raw, method,
  commentary: rj('results/commentary.json'),
  cleanup: rj('results/cleanup.json'),
  guide: rj('results/guide.json'), cars: rj('results/cars.json'), formaReport: rj('results/forma-report.json'),
  round2: argv.includes('--round2') ? JSON.parse(fs.readFileSync(path.resolve(option('--round2')), 'utf8')) : rj('results/round-2.json'),
  dockerBefore: rd('results/docker-before.md'),
  events: EVENTS,
  generated: new Date().toISOString(),
};
const json = JSON.stringify(data).replace(/</g, '\\u003c');
const readerViews = rd('harness/report-views.js', '').replace(/<\/script/gi, '<\\/script');

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${data.round2 ? 'Framework Grand Prix: rounds 1 and 2' : 'FORMA-254 Framework Grand Prix'}</title>
<style>
:root{--bg:#f6f5f1;--panel:#fff;--ink:#16181d;--mute:#5d6470;--line:#d9d6cc;--accent:#d6361f;--forma:#0b6e5f;--bar:#7a8aa3;--g1:#c9971c;--g2:#8d949e;--g3:#a8683a;--chip:#eceae2;--warn:#fff3cd;--warnink:#5a4300;--grid:#ebe8dd}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0f1115;--panel:#181b21;--ink:#ecebe6;--mute:#9aa1ad;--line:#2b303a;--accent:#ff6a4d;--forma:#3ed1b4;--bar:#6f819c;--g1:#e2b73e;--g2:#aeb4bd;--g3:#c98650;--chip:#222732;--warn:#3a3112;--warnink:#f2dd9a;--grid:#20242c}}
:root[data-theme=dark]{--bg:#0f1115;--panel:#181b21;--ink:#ecebe6;--mute:#9aa1ad;--line:#2b303a;--accent:#ff6a4d;--forma:#3ed1b4;--bar:#6f819c;--g1:#e2b73e;--g2:#aeb4bd;--g3:#c98650;--chip:#222732;--warn:#3a3112;--warnink:#f2dd9a;--grid:#20242c}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
header{padding:28px 20px 12px;max-width:1100px;margin:0 auto;border-bottom:6px solid var(--accent);background:repeating-linear-gradient(90deg,var(--ink) 0 14px,transparent 14px 28px) bottom/100% 6px no-repeat}
h1{margin:0;font-size:30px;letter-spacing:.5px;text-transform:uppercase}h1 small{display:block;font-size:13px;font-weight:500;color:var(--mute);letter-spacing:0;text-transform:none;margin-top:4px}
h2{margin:30px 0 10px;font-size:20px}h3{margin:18px 0 8px;font-size:16px}main{max-width:1100px;margin:0 auto;padding:8px 20px 60px}
nav{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line);padding:8px 20px}nav .in{max-width:1100px;margin:0 auto;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
nav button,.tab{font:inherit;border:1px solid var(--line);background:var(--panel);color:var(--ink);padding:5px 10px;border-radius:6px;cursor:pointer}
nav button[aria-selected=true]{background:var(--ink);color:var(--bg);border-color:var(--ink)}nav .sp{flex:1}
.banner{background:var(--warn);color:var(--warnink);padding:10px 14px;border-radius:8px;margin:14px 0;border:1px solid var(--line)}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:12px 0}
.podium{display:flex;align-items:flex-end;justify-content:center;gap:10px;margin:14px 0 6px;min-height:150px}
.pod{flex:1 1 0;max-width:230px;text-align:center}.pod .car{font-weight:700;font-size:16px;overflow-wrap:anywhere}.pod .val{color:var(--mute);font-size:13px}
.pod .blk{margin-top:6px;border-radius:8px 8px 0 0;color:#111;font-weight:800;font-size:26px;padding-top:6px;display:flex;justify-content:center;align-items:flex-start}
.pod.p1 .blk{height:96px;background:var(--g1)}.pod.p2 .blk{height:72px;background:var(--g2)}.pod.p3 .blk{height:54px;background:var(--g3)}.pod .pts{font-size:12px;color:var(--mute)}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{background:var(--chip);border-radius:20px;padding:2px 10px;font-size:13px}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}th:first-child,td:first-child,th.l,td.l{text-align:left}
th{color:var(--mute);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.4px}tr.win td{background:var(--grid);font-weight:600}.scroll{overflow-x:auto}
.rank{display:inline-block;min-width:1.6em;height:1.6em;line-height:1.6em;text-align:center;border-radius:4px;background:var(--ink);color:var(--bg);font-weight:700;font-size:12px;margin-right:6px}
.rank.r1{background:var(--g1);color:#111}.rank.r2{background:var(--g2);color:#111}.rank.r3{background:var(--g3);color:#111}
details{margin:6px 0}summary{cursor:pointer;color:var(--mute)}pre{background:var(--chip);padding:10px;border-radius:6px;overflow:auto;font-size:12px;max-height:340px}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}.note{color:var(--mute);font-size:13px}.comm{border-left:4px solid var(--accent);padding:2px 12px;margin:12px 0}.comm.ph{border-color:var(--line);color:var(--mute);font-style:italic}
svg text{fill:var(--ink);font:12px system-ui,sans-serif}svg .mute{fill:var(--mute)}svg .ax{stroke:var(--line)}svg .bar{fill:var(--bar)}svg .bar.forma{fill:var(--forma)}svg .bar.first{stroke:var(--g1);stroke-width:2}svg .wh{stroke:var(--ink);stroke-width:1.5}
code{background:var(--chip);padding:1px 5px;border-radius:4px;font-size:13px}.md p{margin:6px 0}.md ul{margin:6px 0;padding-left:22px}.grid-start{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:6px;margin:8px 0}
.slot{border:1px dashed var(--line);border-radius:6px;padding:4px 8px;font-size:13px}.slot b{color:var(--accent);margin-right:4px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(480px,1fr));gap:12px}.carcard{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px;font-size:13px}.carcard.fc{border:2px solid var(--forma)}.carcard .ct{font-size:15px;margin-bottom:6px}
.carcard dl,.wk{margin:0;display:grid;grid-template-columns:max-content 1fr;gap:3px 10px}.carcard dt,.wk dt{color:var(--mute);font-weight:600}.carcard dd,.wk dd{margin:0;overflow-wrap:anywhere}
.explain{border-left:4px solid var(--forma)}.exg{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:4px 18px}.exg h4{margin:4px 0 2px;font-size:12px;text-transform:uppercase;letter-spacing:.4px;color:var(--mute)}.exg p{margin:0 0 6px}
tr.fr td{background:color-mix(in srgb,var(--forma) 12%,transparent);font-weight:600}.good{color:var(--forma);font-weight:600}.sw h3{margin-top:2px}.good-b{border-left:4px solid var(--forma)}
.pri{display:inline-block;border-radius:4px;padding:0 6px;font-size:12px;color:#fff;background:var(--accent)}.pri.p2{background:#b4690e}.pri.p3{background:var(--mute)}
@media (max-width:600px){.cards{grid-template-columns:1fr}.wk,.carcard dl{grid-template-columns:1fr}h1{font-size:22px}.pod .blk{font-size:20px}}
</style></head><body>
<header><h1>${data.round2 ? 'Framework Grand Prix: rounds 1 and 2' : 'FORMA-254 Framework Grand Prix'}<small id="sub"></small></h1></header>
<nav><div class="in" role="tablist" id="tabs"></div></nav>
<main id="main"></main>
<script id="data" type="application/json">${json}</script>
<script>
(function(){
var D=JSON.parse(document.getElementById('data').textContent),S=D.summary;
var $=function(h){var t=document.createElement('template');t.innerHTML=h.trim();return t.content.firstChild};
function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function fmt(v,unit){if(v==null||isNaN(v))return '-';var a=Math.abs(v);
 if(unit==='bytes'||unit==='bytes Brotli'){return a>=1e6?(v/1e6).toFixed(1)+' MB':a>=1e3?(v/1e3).toFixed(1)+' kB':Math.round(v)+' B'}
 if(unit==='ms build'||unit==='ms'||unit==='ms p99'||unit==='ms geomean'){return a>=10000?(v/1000).toFixed(1)+' s':a>=100?v.toFixed(0)+' ms':a>=10?v.toFixed(1)+' ms':v.toFixed(2)+' ms'}
 if(unit==='MiB peak')return v.toFixed(1)+' MiB';
 return a>=1000?Math.round(v).toLocaleString('en-US'):a>=10?v.toFixed(1):v.toFixed(2)}
function num(v,u){return fmt(v,u)}
function ord(n){return n===1?'1st':n===2?'2nd':n===3?'3rd':n+'th'}
function mdInline(s){return esc(s).replace(/\`([^\`]+)\`/g,'<code>$1</code>').replace(/\\*\\*([^*]+)\\*\\*/g,'<b>$1</b>').replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g,'$1')}
function md(t){if(!t)return '';var out='',lines=t.split('\\n'),i=0;
 while(i<lines.length){var l=lines[i];
  if(/^\\s*[-*] /.test(l)){out+='<ul>';while(i<lines.length&&/^\\s*[-*] /.test(lines[i])){var it=lines[i].replace(/^\\s*[-*] /,'');i++;while(i<lines.length&&/^\\s{2,}\\S/.test(lines[i])){it+=' '+lines[i].trim();i++}out+='<li>'+mdInline(it)+'</li>'}out+='</ul>';continue}
  if(/^\\|/.test(l)){var rows=[];while(i<lines.length&&/^\\|/.test(lines[i])){rows.push(lines[i]);i++}
   out+='<div class="scroll"><table>';rows.forEach(function(r,k){if(/^\\|\\s*-/.test(r))return;var c=r.replace(/^\\||\\|\\s*$/g,'').split('|');var tg=k===0?'th':'td';out+='<tr>'+c.map(function(x){return '<'+tg+' class="l">'+mdInline(x.trim())+'</'+tg+'>'}).join('')+'</tr>'});out+='</table></div>';continue}
  if(l.trim()===''){i++;continue}
  var p=l;i++;while(i<lines.length&&lines[i].trim()!==''&&!/^\\s*[-*] |^\\|/.test(lines[i])){p+=' '+lines[i];i++}out+='<p>'+mdInline(p)+'</p>'}
 return '<div class="md">'+out+'</div>'}
function commentary(keys){var c=D.commentary;if(c){for(var i=0;i<keys.length;i++){var v=(c.events&&c.events[keys[i]])||c[keys[i]];if(v){if(typeof v==='object')v=v.text||v.commentary||'';if(v)return '<div class="comm"><b>Commentary.</b> '+esc(v).replace(/\\n\\n/g,'</p><p>')+'</div>'}}}
 return '<div class="comm ph">Commentary pending: the race director writes it after the race (results/commentary.json).</div>'}
function carName(c){return c}
function podium(st,unit,pointsLabel){if(!st.length)return '<p class="note">No car has a result for this yet.</p>';var top=st.slice(0,3),order=[top[1],top[0],top[2]].filter(Boolean);
 return '<div class="podium">'+order.map(function(s){var r=top.indexOf(s)+1;return '<div class="pod p'+r+'"><div class="car">'+esc(carName(s.car))+'</div><div class="val">'+esc(s.valLabel)+'</div><div class="blk">'+ord(s.rank)+'</div><div class="pts">'+esc(s.ptsLabel)+'</div></div>'}).join('')+'</div>'}
function bars(st,unit,better){if(!st.length)return '';var W=760,L=150,R=90,rowH=26,H=st.length*rowH+34,mx=0;
 st.forEach(function(s){mx=Math.max(mx,s.mean+s.sd)});if(!mx)mx=1;var sc=(W-L-R)/mx;
 var g='<svg viewBox="0 0 '+W+' '+H+'" width="100%" role="img" aria-label="Bar chart, '+esc(unit)+', '+(better==='higher'?'higher':'lower')+' is better. Bars start at zero; whiskers are one standard deviation.">';
 [0,.25,.5,.75,1].forEach(function(f){var x=L+f*mx*sc;g+='<line class="ax" x1="'+x+'" x2="'+x+'" y1="4" y2="'+(H-24)+'"/><text class="mute" x="'+x+'" y="'+(H-8)+'" text-anchor="middle">'+esc(fmt(f*mx,unit))+'</text>'});
 st.forEach(function(s,i){var y=8+i*rowH,w=Math.max(1,s.mean*sc),isF=/^forma/.test(s.car);
  g+='<text x="'+(L-8)+'" y="'+(y+14)+'" text-anchor="end">'+esc(s.car)+'</text><rect class="bar'+(isF?' forma':'')+(s.rank===1?' first':'')+'" x="'+L+'" y="'+y+'" width="'+w+'" height="18" rx="3"><title>'+esc(s.car+': '+fmt(s.mean,unit)+' (sd '+fmt(s.sd,unit)+')')+'</title></rect>';
  if(s.sd>0&&s.n>1){var x1=L+Math.max(0,s.mean-s.sd)*sc,x2=L+(s.mean+s.sd)*sc,cy=y+9;g+='<line class="wh" x1="'+x1+'" x2="'+x2+'" y1="'+cy+'" y2="'+cy+'"/><line class="wh" x1="'+x1+'" x2="'+x1+'" y1="'+(cy-5)+'" y2="'+(cy+5)+'"/><line class="wh" x1="'+x2+'" x2="'+x2+'" y1="'+(cy-5)+'" y2="'+(cy+5)+'"/>'}
  g+='<text class="mute" x="'+(L+(s.mean+s.sd)*sc+6)+'" y="'+(y+14)+'">'+esc(fmt(s.mean,unit))+'</text>'});
 return g+'</svg>'}
function decorate(c){c.standings.forEach(function(s){s.valLabel=fmt(s.mean,c.unit);s.ptsLabel=s.points+' pts'+(s.tied?' (tied)':'')});return c}
function contestTable(c){var h='<div class="scroll"><table><thead><tr><th>Pos</th><th class="l">Car</th><th>Mean</th><th>Std dev</th><th>Min to max</th><th>Runs</th><th>Points</th><th class="l">Notes</th></tr></thead><tbody>';
 c.standings.forEach(function(s){var notes=[];if(s.extra&&s.extra.bytesPerRequest)notes.push('response '+fmt(s.extra.bytesPerRequest,'bytes'));if(s.extra&&s.extra.nonOk)notes.push(s.extra.nonOk+' non-200');if(s.extra&&s.extra.rawBytes)notes.push('raw '+fmt(s.extra.rawBytes,'bytes'));if(s.reportedApart)notes.push(s.reportedApart.label+': '+fmt(s.reportedApart.ms,'ms'));
  h+='<tr'+(s.rank===1?' class="win"':'')+'><td><span class="rank r'+s.rank+'">'+s.rank+'</span></td><td class="l">'+esc(s.car)+'</td><td>'+fmt(s.mean,c.unit)+'</td><td>'+fmt(s.sd,c.unit)+'</td><td>'+fmt(s.min,c.unit)+' to '+fmt(s.max,c.unit)+'</td><td>'+s.n+'</td><td>'+s.points+(s.tied?' (tied)':'')+'</td><td class="l note">'+esc(notes.join(', '))+'</td></tr>'});
 return h+'</tbody></table></div>'}
function rawRuns(c){var ev=D.raw[c.event]||{};if(!c.standings.length)return '';var h='<h3>Every raw run</h3>';
 c.standings.forEach(function(s){var r=ev[s.car];if(!r)return;
  var rows='';if(r.runs&&r.runs.length&&typeof r.runs[0]==='object'){var keys={};r.runs.forEach(function(x){Object.keys(x).forEach(function(k){if(typeof x[k]!=='object')keys[k]=1})});var ks=Object.keys(keys);
   rows='<div class="scroll"><table><thead><tr>'+ks.map(function(k){return '<th>'+esc(k)+'</th>'}).join('')+'</tr></thead><tbody>'+r.runs.map(function(x){return '<tr>'+ks.map(function(k){var v=x[k];return '<td>'+(typeof v==='number'?(Math.abs(v)>=100?Math.round(v*10)/10:Math.round(v*1000)/1000):esc(v==null?'':v))+'</td>'}).join('')+'</tr>'}).join('')+'</tbody></table></div>'}
  var vals=c.event==='weight'?'':'<p class="note">Values used for the mean: '+esc(s.values.map(function(v){return +v.toPrecision(6)}).join(', '))+'</p>';
  var slim=JSON.parse(JSON.stringify(r));if(slim.samples&&slim.samples.length>40)slim.samples=slim.samples.slice(0,40).concat(['... '+(r.samples.length-40)+' more in results/raw/'+c.event+'/'+s.car+'.json']);
  h+='<details><summary>'+esc(s.car)+': '+s.n+' run'+(s.n>1?'s':'')+'</summary>'+vals+rows+'<details><summary>Raw JSON, machine state included</summary><pre>'+esc(JSON.stringify(slim,null,1))+'</pre></details></details>'});
 return h}
function machineBlock(ev){var m=S.machine&&S.machine[ev];if(!m)return '';var b=m.before||m;if(!b||!b.at)return '';var a=m.after;
 return '<details><summary>Machine state for this event</summary><div class="chips" style="margin:8px 0">'+['Docker '+b.dockerCpus+' CPUs','Docker '+b.dockerMemGB+' GB','host load '+(b.hostLoadAvg||[]).join(' / ')+(a&&a.hostLoadAvg?' (before) to '+a.hostLoadAvg.join(' / ')+' (after)':''),b.hostCpuModel,'Docker '+b.dockerVersion,b.dockerKernel,'Node '+b.node,b.quiet?'machine quiet at start':'NOT quiet at start (load average above 2)'].map(function(x){return '<span class="chip">'+esc(x)+'</span>'}).join('')+'</div><pre>'+esc(JSON.stringify(m,null,1))+'</pre></details>'}
function resourceBanner(){var groups=Object.keys(S.campaigns||{});return '<div class="banner">'+esc(S.profileLabel)+(S.resourceProfile?(S.diagnostic?'. Diagnostic measurements are unqualified and remain separate from the Linux baseline.':'. Each championship group uses one measured VM/job. Server and client points are normalized within their events; raw timings from different campaigns are not compared.'):'. Historical observations remain separate from the new Linux baseline.')+(groups.length?'<details><summary>Measurement campaigns</summary>'+groups.map(function(group){return '<p>'+esc(group)+': '+esc(S.campaigns[group].id)+'</p>'}).join('')+'</details>':'')+'</div>'}
function cfgBanner(){var bad=[],defaults={duration:10,warmup:5,runs:3,starts:5,buildRuns:3,concurrency:64};Object.keys(S.configs||{}).forEach(function(k){var c=S.configs[k];if(!c)return;Object.keys(defaults).forEach(function(d){if(c[d]!=null&&c[d]!==defaults[d])bad.push(d+'='+c[d]+' (protocol '+defaults[d]+')')});if(c.forced)bad.push('some events ran on a loaded machine (forced)')});
 return bad.length?'<div class="banner"><b>Not a protocol run.</b> '+esc(bad.filter(function(x,i,a){return a.indexOf(x)===i}).join('; '))+'</div>':''}
function champ(key,title){var l=S.championships[key];var st=l.map(function(e){return {car:e.car,rank:e.rank,mean:key==='overall'?e.mean:e.points,sd:0,n:1,valLabel:key==='overall'?e.mean.toFixed(1)+' pts per event':e.points+' pts',ptsLabel:e.events+' events entered'}});
 var h='<div class="panel"><h3>'+title+'</h3>'+podium(st)+'<div class="scroll"><table><thead><tr><th>Pos</th><th class="l">Car</th><th>Points</th><th>Events entered</th><th>Points per event</th></tr></thead><tbody>'+l.map(function(e){return '<tr'+(e.rank===1?' class="win"':'')+'><td><span class="rank r'+e.rank+'">'+e.rank+'</span></td><td class="l">'+esc(e.car)+'</td><td>'+(+e.points.toFixed(2))+'</td><td>'+e.events+'</td><td>'+e.pointsPerEvent.toFixed(2)+'</td></tr>'}).join('')+'</tbody></table></div></div>';
 return h}
function grid(){var cars={};S.contests.forEach(function(c){c.standings.forEach(function(s){cars[s.car]=1})});Object.keys(S.smoke||{}).forEach(function(k){cars[k]=1});var names=Object.keys(cars).sort();
 return '<div class="grid-start">'+names.map(function(n,i){var sm=S.smoke&&S.smoke[n];return '<div class="slot"><b>'+(i+1)+'</b>'+esc(n)+(sm&&!sm.pass?' <span class="note">(out: failed smoke)</span>':'')+'</div>'}).join('')+'</div>'}
var views={};
${readerViews}
views.overall=function(){var h=cfgBanner()+'<h2>Overall podium</h2><div class="panel">'+(function(){var l=S.championships.overall.map(function(e){return {car:e.car,rank:e.rank,mean:e.mean,sd:0,n:1,valLabel:e.mean.toFixed(1)+' pts per event',ptsLabel:(+e.points.toFixed(2))+' pts in '+e.events+' events'+(e.stack&&e.stack.length?' (client: '+e.stack.join(', ')+')':' (no client entry)')}});return podium(l)})()+'</div>'+commentary(['overall'])+
 '<h2>Championships</h2><div class="cols">'+champ('server','Server championship (events 1 to 8)')+champ('client','Client championship (events 9 to 11)')+'</div>'+champ('overall','Overall: points per event entered')+commentary(['server','client','championships'])+
 '<h2>On the grid</h2><div class="panel">'+grid()+'<p class="note">Cars enter only the events they can; Overall divides by events entered so a car is not rewarded for entering more. Event 7 has two halves (image size and gzip bytes), scored apart, each worth half an event. Overall ranks stacks: each server car with the client results of the library it ships (Amendment 2).</p>'+
 (S.dnq&&S.dnq.length?'<p><b>Did not qualify (failed the smoke test, so untimed):</b> '+esc(S.dnq.join(', '))+'</p>':'')+'</div>'+smokeBlock();return h};
function smokeBlock(){var ks=Object.keys(S.smoke||{});if(!ks.length)return '';return '<details><summary>Smoke test results (body verified against expected(n) before any timing)</summary><div class="scroll"><table><thead><tr><th>Car</th><th>Result</th><th>Checks</th></tr></thead><tbody>'+ks.map(function(k){var s=S.smoke[k];return '<tr><td class="l">'+esc(k)+'</td><td>'+(s.pass?'pass':'FAIL')+'</td><td class="l note">'+esc((s.checks||[]).map(function(c){return c.name+': '+c.detail}).join(' | '))+'</td></tr>'}).join('')+'</tbody></table></div></details>'}
function eventView(e){return function(){var cs=S.contests.filter(function(c){return c.event===e.id});if(!cs.length)return '<h2>'+e.n+'. '+esc(e.title)+'</h2><p class="note">No results recorded.</p>'+commentary([e.id,String(e.n)]);
 var h='<h2>'+e.n+'. '+esc(e.title)+'</h2>'+views.__explain(e.id);
 cs.forEach(function(c){decorate(c);h+='<div class="panel"><h3>'+esc(c.title)+' <span class="note">('+esc(c.unit)+', '+c.better+' is better)</span></h3>'+podium(c.standings)+bars(c.standings,c.unit,c.better)+contestTable(c)+rawRuns(c)+'</div>'});
 if(e.id==='pitstop'){var fr=(D.raw.pitstop||{}).forma;if(fr&&fr.rust)h+='<div class="panel"><b>Reported apart, not scored.</b> '+esc(fr.rust.note||'')+(fr.rust.buildMs!=null?' Forma Rust compile: '+fmt(fr.rust.buildMs,'ms')+'.':'')+'</div>'}
 h+=views.__more(e.id)+commentary([e.id,String(e.n)].concat(e.id==='weight'?['7a','7b']:[]))+machineBlock(e.id);return h}};
views.method=function(){var m=D.method;var h='<h2>Method and fairness</h2><div class="panel">'+md(m.intro)+'<h3>The grid</h3>'+md(m.grid)+'<h3>Fairness</h3>'+md(m.fairness)+'<h3>Events and points</h3>'+md(m.events)+'<h3>Runs and outputs</h3>'+md(m.runs)+'</div>'+(m.amendments||[]).map(function(x){return '<div class="panel"><h3>'+esc(x.title)+'</h3>'+md(x.body)+'</div>'}).join('')+commentary(['deviations','method']);
 h+='<div class="panel"><h3>How this harness measures</h3><ul><li>Each car runs alone on its own Docker network with the <code>gp264/loadgen</code> container (oha, recorded image architecture, <code>--cpus='+esc(S.resourceProfile?S.resourceProfile.loadgen.cpus:4)+'</code>, compression off). Throughput is requests per second answered with 200; any non-200 is shown in the table.</li><li>Fuel is sampled with <code>docker stats</code> back to back through the Sprint warm-up and runs; the peak per run is the largest sample (the cgroup figure Docker reports, which counts page cache the container holds).</li><li>Grid start is timed on the host from just before <code>docker run -d</code> to the first 200 on <code>/ssr?rows=100</code> through a loopback-published port.</li><li>Gzip bytes are the body of <code>/ssr?rows=100</code> compressed at level 9 by the harness; the report also notes whether a car compresses by itself when asked.</li><li>Pit stop runs <code>/gp/build.sh</code> in <code>gp264/&lt;car&gt;-build</code> with <code>--cpus=4</code> and takes the <code>GP_BUILD_MS</code> it prints.</li><li>The numbers are means of the runs shown; the spread is the sample standard deviation. Nothing was tuned after a result was seen.</li></ul></div>';
 var c=D.cleanup;h+='<div class="panel"><h3>Docker hygiene and disk</h3>'+md(m.hygiene)+(c?'<p>Host free disk before the race: <b>'+esc(c.diskBefore||'?')+'</b>, before cleanup: <b>'+esc(c.diskBeforeCleanup||'?')+'</b>, after cleanup: <b>'+esc(c.diskAfterCleanup||'?')+'</b>.</p>':'<p class="note">Cleanup has not run yet (results/cleanup.json missing).</p>')+(D.dockerBefore?'<details><summary>Docker state before the race</summary><pre>'+esc(D.dockerBefore)+'</pre></details>':'')+'</div>';return h};
var tabs=[['intro','Start here'],['overall','Overall'],['forma','Forma report']].concat(D.events.map(function(e){return [e.id,e.n+' '+e.title]})).concat([['telemetry','Telemetry'],['method','Method'],['log','Race log']]);
var tabsEl=document.getElementById('tabs'),main=document.getElementById('main');
tabs.forEach(function(t){var b=document.createElement('button');b.textContent=t[1];b.setAttribute('role','tab');b.dataset.t=t[0];b.onclick=function(){show(t[0])};tabsEl.appendChild(b)});
var sp=document.createElement('span');sp.className='sp';tabsEl.appendChild(sp);
var tb=document.createElement('button');tb.textContent='Light/dark';tb.onclick=function(){var r=document.documentElement,cur=r.getAttribute('data-theme')||(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');r.setAttribute('data-theme',cur==='dark'?'light':'dark')};tabsEl.appendChild(tb);
function show(id){[].forEach.call(tabsEl.querySelectorAll('button[data-t]'),function(b){b.setAttribute('aria-selected',b.dataset.t===id)});var e=D.events.filter(function(x){return x.id===id})[0];main.innerHTML=resourceBanner()+(views[id]||eventView(e))();try{history.replaceState(null,'','#'+id)}catch(_){}window.scrollTo(0,0)}
document.getElementById('sub').textContent='Forma 3.0.0 against the stacks people choose instead. Generated '+D.generated.slice(0,16).replace('T',' ')+' UTC. Every number is the mean of the runs shown, with its spread.';
var h=location.hash.slice(1);show(tabs.some(function(t){return t[0]===h})?h:'intro');
})();
</script></body></html>`;
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, html);
console.log('wrote', output, (html.length / 1024).toFixed(0) + ' kB');
