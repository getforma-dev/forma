"""Render the public round-two data without embedding historical machine records."""
from html import escape
import json
from pathlib import Path
from urllib.parse import urlsplit

root = Path(__file__).resolve().parent
data = json.loads((root / 'round-2.json').read_text())

def text(value):
    return escape(str(value), quote=True)

parts = []
links = []
for index, section in enumerate(data['sections'], 1):
    anchor = f'section-{index}'
    links.append(f'<a href="#{anchor}">{text(section["title"])}</a>')
    columns = section['columns']
    rows = section['rows']
    assert all(len(row) == len(columns) for row in rows), section['title']
    header = ''.join(f'<th scope="col">{text(column)}</th>' for column in columns)
    body = ''.join('<tr>' + ''.join(
        f'<th scope="row">{text(cell)}</th>' if col == 0 else f'<td>{text(cell)}</td>'
        for col, cell in enumerate(row)) + '</tr>' for row in rows)
    sources = []
    for source in section.get('sources', []):
        url = urlsplit(source['url'])
        assert url.scheme == 'https' and url.hostname == 'github.com' and not url.username and not url.password
        sources.append(f'<a href="{text(source["url"])}">{text(source["label"])}</a>')
    parts.append(f'''<section id="{anchor}" aria-labelledby="{anchor}-title">
<h2 id="{anchor}-title">{text(section['title'])}</h2>
<p>{text(section['description'])}</p>
<div class="scroll" role="region" aria-label="{text(section['title'])} data" tabindex="0">
<table><thead><tr>{header}</tr></thead><tbody>{body}</tbody></table></div>
<p class="note">{text(section['note'])}</p>
<p class="sources">{' · '.join(sources)}</p></section>''')

html = '''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><title>Forma Grand Prix — Round 2 evidence</title>
<style>
:root{font:16px/1.55 system-ui,sans-serif;color:#182126;background:#f7f6f2;--panel:#fff;--line:#d2d9d7;--muted:#455b61;--accent:#076b5a;--warning:#fff1c7}
*{box-sizing:border-box}body{margin:0}main{max-width:1200px;margin:auto;padding:32px 24px 64px}header{border-top:6px solid var(--accent)}h1{font-size:clamp(1.75rem,4vw,2.5rem);line-height:1.15}h2{font-size:1.3rem;line-height:1.3;margin-top:0}p{max-width:95ch}a{color:var(--accent);overflow-wrap:anywhere}.status{background:var(--warning);padding:16px;border-radius:8px;font-weight:600}section{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:24px;margin:24px 0;scroll-margin-top:16px}.scroll{overflow:auto;width:100%;border:1px solid var(--line);border-radius:6px}table{border-collapse:collapse;min-width:100%;font-size:.85rem}th,td{padding:9px 12px;border-bottom:1px solid var(--line);white-space:nowrap;text-align:right}th:first-child{text-align:left}thead{background:color-mix(in srgb,var(--accent) 8%,var(--panel))}tbody th{font-weight:500}.note,.sources{font-size:.87rem;color:var(--muted)}.eyebrow{text-transform:uppercase;letter-spacing:.12em;font-size:.78rem;color:var(--muted)}nav{display:grid;gap:8px;margin:16px 0}details{padding:12px 0}summary{cursor:pointer;font-weight:600}:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
@media(max-width:600px){main{padding:20px 14px 40px}section{padding:16px 12px;margin:20px 0}th,td{padding:8px;font-size:.8rem}}
@media(prefers-color-scheme:dark){:root{color:#e8f0ed;background:#101917;--panel:#17241f;--line:#3c5249;--muted:#b0c6bb;--accent:#7be2c4;--warning:#3c3419}}
</style></head><body><main><header><p class="eyebrow">Forma · benchmark programme · 24 October 2026</p>
<h1>Grand Prix: Round 2 evidence</h1></header>
'''
html += f'<p class="status">{text(data["status"])}</p><p>{text(data["method"])}</p>'
html += '<p class="note">This public view contains the curated Round 2 tables. Historical October 23 standings and original machine records remain in their separate report. Source archives for the measurements shown here, including failed trials, accompany this file.</p>'
html += '<details><summary>Jump to a result</summary><nav aria-label="Results">' + ''.join(links) + '</nav></details>'
html += ''.join(parts)
html += '<footer class="note">Reproduce these tables with assemble-report.py and render-report.py. Verify every snapshot file with verify.py. No package release or deployment is established by this evidence.</footer></main></body></html>\n'
(root / 'index.html').write_text(html)
print(root / 'index.html')
