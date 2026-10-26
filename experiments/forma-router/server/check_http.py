#!/usr/bin/env python3
"""Read/write only the local proof fixture; never follow mutation redirects."""
import argparse, http.cookiejar, json, re, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('origin')
parser.add_argument('--output', default=str(Path(__file__).parent / 'evidence/http-proof.json'))
args = parser.parse_args()
u = urllib.parse.urlparse(args.origin)
if u.scheme != 'http' or u.hostname not in ('127.0.0.1', 'localhost') or u.path:
    raise SystemExit('Only the loopback proof origin is accepted')
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **kw):
        return None
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()), NoRedirect)

def request(path, form=None, enhanced=False, origin=True):
    headers = {}
    if enhanced:
        headers['Accept'] = 'application/vnd.forma.action+json' if form is not None else 'application/vnd.forma.navigation+json'
    if form is not None and origin:
        headers['Origin'] = args.origin
    data = urllib.parse.urlencode(form).encode() if form is not None else None
    req = urllib.request.Request(args.origin+path, data=data, headers=headers)
    try:
        response = opener.open(req, timeout=10)
    except urllib.error.HTTPError as response_error:
        response = response_error
    with response:
        return response.status, dict(response.headers), response.read().decode()
results = []
def check(name, fn):
    fn()
    results.append({'name': name, 'status':'passed'})
def require(value, message):
    assert value, message

def run():
    request('/__proof/reset', {})
    status, headers, html = request('/proof/a')
    require(status == 200 and html.startswith('<!DOCTYPE html>'), 'direct native document')
    require(headers.get('cache-control') == 'no-store', 'document no-store')
    initial = json.loads(re.search(r'<script type="application/json" data-forma-navigation>(.*?)</script>', html).group(1))
    csrf = re.search(r'<input[^>]*name="csrf"[^>]*value="([^"]*)"',html)
    if not csrf:
        # Attribute order is authored/compiler output, not a protocol constraint.
        from html.parser import HTMLParser
        class Inputs(HTMLParser):
            token = None
            def handle_starttag(self, tag, attrs):
                a=dict(attrs)
                if tag=='input' and a.get('name')=='csrf': self.token=a.get('value')
        p=Inputs();p.feed(html);token=p.token
    else: token=csrf.group(1)
    require(token, 'typed native CSRF form control')
    results.append({'name':'direct typed document with admission metadata and native form','status':'passed'})
    status, nh, raw = request('/proof/b', enhanced=True)
    page=json.loads(raw)
    require(status == 200 and nh.get('content-type')=='application/vnd.forma.navigation+json','page negotiation')
    require(page['route']=='/proof/b' and page['policy']==initial['policy'],'same policy across fresh render')
    require(page['assets']==initial['assets'],'same verified group assets')
    require('<script' not in page['html'],'navigation does not replay scripts')
    results.append({'name':'negotiated typed destination keeps policy and asset identity','status':'passed'})
    for query,key in [('policy=changed','policy'),('context=changed','context')]:
        changed=json.loads(request('/proof/b?'+query, enhanced=True)[2])
        require(changed[key]!=page[key], 'explicit incompatible '+key)
    results.append({'name':'policy/context mismatch is explicit in the representation','status':'passed'})
    def admitted_action(raw, status, endpoint='/proof/update'):
        action=json.loads(raw)
        for field in ['version','app','build','group','layout','context','policy']:
            require(action.get(field)==initial[field], 'action admission '+field)
        require(action.get('endpoint')==endpoint, 'exact action endpoint')
        require(action.get('kind')=='action' and action.get('status')==status, 'action HTTP/status admission')
        return action
    status, _, raw=request('/proof/update',{'name':'','csrf':token},enhanced=True)
    require(status==422 and admitted_action(raw,status)['outcome']=='validation','enhanced validation')
    status, _, raw=request('/proof/update',{'name':'','csrf':token})
    require(status==422 and '<!DOCTYPE html>' in raw and 'Name must contain' in raw,'native validation parity')
    results.append({'name':'same handler supports enhanced and no-JS validation','status':'passed'})
    for fields,send_origin in [({'name':'forged','csrf':'wrong'},True),({'name':'forged','csrf':token},False)]:
        status,_,raw=request('/proof/update',fields,enhanced=True,origin=send_origin)
        require(status==403 and admitted_action(raw,status)['outcome']=='error','CSRF/Origin refusal')
    require(json.loads(request('/__proof/state')[2])['posts']==0,'refused submissions did not mutate')
    results.append({'name':'CSRF and Origin refusal precede mutation','status':'passed'})
    status,_,raw=request('/proof/update',{'name':'Updated','csrf':token},enhanced=True)
    require(status==200 and admitted_action(raw,status)['outcome']=='success','successful action')
    require(json.loads(request('/__proof/state')[2])['posts']==1,'one success mutation')
    results.append({'name':'confirmed action mutates once and returns explicit success','status':'passed'})
    status,headers,raw=request('/proof/update',{'name':'Redirected','csrf':token,'redirect':'true'},enhanced=True)
    require(status==200 and 'location' not in headers,'enhanced redirect not HTTP-followed')
    outcome=admitted_action(raw,status)
    require(outcome['outcome']=='redirect' and outcome['data']=={'location':'/proof/b','status':303},'explicit PRG outcome')
    status,headers,_=request('/proof/update',{'name':'Native','csrf':token})
    require(status==303 and headers.get('location')=='/proof/a','native303')
    results.append({'name':'enhanced redirect is a typed 303 decision; native form uses HTTP303','status':'passed'})
    results.append({'name':'all readable actions match bound app/build/group/layout/context/policy/endpoint and actual HTTP status','status':'passed'})
    before=json.loads(request('/__proof/state')[2])['posts']
    status,_,raw=request('/proof/update',{'name':'Outcome unknown','csrf':token,'fail_after':'true'},enhanced=True)
    after=json.loads(request('/__proof/state')[2])['posts']
    require(status==502 and after==before+1,'mutation committed before unreadable outcome')
    require(not raw.startswith('{'), 'unreadable outcome has no admission claim')
    results.append({'name':'unreadable POST remains unknown to client; fixture state independently confirms one mutation, without retry','status':'passed'})
try:
    run()
    passed=True
except Exception as error:
    results.append({'name':'failure','status':'failed','error':str(error)})
    passed=False
output={'observed_at_utc':datetime.now(timezone.utc).isoformat(),'origin':args.origin,'scope':'Real typed Rust handler HTTP smoke checks; not browser identity, resource, or packed release qualification.','results':results,'passed':passed}
Path(args.output).parent.mkdir(parents=True,exist_ok=True)
Path(args.output).write_text(json.dumps(output,indent=2)+'\n')
print(json.dumps(output,indent=2))
raise SystemExit(0 if passed else 1)
