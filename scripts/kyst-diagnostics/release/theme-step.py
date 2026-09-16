#!/usr/bin/env python3
"""Review-only pinned theme step. --execute requires a separately recorded MAIN NOX release.
This does not refresh, click, navigate, measure, or modify kiosk settings.
"""
import argparse,datetime,hashlib,json,os,pathlib,subprocess,urllib.request,urllib.error
HERE=pathlib.Path(__file__).resolve().parent
FLY=pathlib.Path('/home/cameronblackmon/.fly/bin/flyctl')
import re
release=json.loads((HERE/'candidate.json').read_text())
IMAGE=release.get('image','')
if not re.fullmatch(r'registry\.fly\.io/kyst-board@sha256:[a-f0-9]{64}',IMAGE):raise RuntimeError('Candidate immutable image not sealed; no operation')
def credentials(path):
 out={}
 for line in pathlib.Path(path).read_text().splitlines():
  if '=' in line and not line.lstrip().startswith('#'):
   k,v=line.split('=',1);out[k.removeprefix('export ').strip()]=v.strip().strip('\"\'')
 return out
def run(args,env):
 p=subprocess.run([str(FLY)]+args+['-a','kyst-board'],env=env,capture_output=True,text=True,timeout=60)
 if p.returncode:raise RuntimeError('Fly read failed: '+p.stderr)
 return json.loads(p.stdout)
def main():
 ap=argparse.ArgumentParser();ap.add_argument('phase',choices=['classic','nox-return']);ap.add_argument('--execute',action='store_true');ap.add_argument('--approved-until');ap.add_argument('--release-comment');a=ap.parse_args()
 config=HERE/('fly.classic.toml' if a.phase=='classic' else 'fly.nox.toml')
 cmd=[str(FLY),'deploy','-a','kyst-board','-c',str(config),'--image',IMAGE,'--strategy','rolling']
 if not a.execute:print(json.dumps({'reviewOnly':True,'command':cmd,'requires':'MAIN NOX release; sole-builder/native-queue and terminal preflight; reviewed context entry if measuring'}));return
 if not a.approved_until or not a.release_comment:raise RuntimeError('Concrete release reference and window required')
 deadline=datetime.datetime.fromisoformat(a.approved_until.replace('Z','+00:00'));now=datetime.datetime.now(datetime.timezone.utc)
 if deadline.tzinfo is None or not now<deadline<=now+datetime.timedelta(minutes=45):raise RuntimeError('Invalid/expired release window')
 if a.phase=='classic' and deadline-now<datetime.timedelta(minutes=25):raise RuntimeError('Reserve at least25minutes for classic and NOX recovery')
 pins=json.loads((HERE/'pins.json').read_text())
 for name in ['fly.classic.toml','fly.nox.toml','expected-config.json']:
  if hashlib.sha256((HERE/name).read_bytes()).hexdigest()!=pins[name]:raise RuntimeError('Packet bytes changed: '+name)
 env=os.environ.copy();env.update(credentials('/home/cameronblackmon/.openclaw/credentials/fly.env'))
 live=run(['config','show'],env);expected=json.loads((HERE/'expected-config.json').read_text());classic=json.loads(json.dumps(expected));classic['env']['KYST_THEME']='classic'
 permitted=[expected] if a.phase=='classic' else [classic,expected]
 if live not in permitted:raise RuntimeError('Live configuration drift; no rebase')
 machines=run(['machine','list','--json'],env)
 if len(machines)!=1 or machines[0]['id']!='48e664eb023468' or machines[0]['state']!='started' or machines[0]['image_ref']['digest']!=IMAGE.split('@')[1]:raise RuntimeError('Machine/image/state drift')
 secrets=run(['secrets','list','--json'],env)
 if any((s.get('Name') or s.get('name'))=='KYST_THEME' for s in secrets):raise RuntimeError('Secret overrides theme')
 ledger=pathlib.Path('/home/cameronblackmon/.openclaw/state/nox11625-final-acceptance');ledger.mkdir(mode=0o700,parents=True,exist_ok=True)
 claim=ledger/(a.phase+'.claimed.json');outcome=ledger/(a.phase+'.result.json')
 with claim.open('x') as f:json.dump({'phase':a.phase,'started':now.isoformat(),'release':a.release_comment,'retryAllowed':False},f);f.flush();os.fsync(f.fileno())
 result={'phase':a.phase,'status':'may_have_started','release':a.release_comment,'image':IMAGE};outcome.write_text(json.dumps(result,indent=2))
 try:
  if a.phase=='nox-return' and live==expected:result['deploy']='not needed; effective NOX already matches pinned config'
  else:
   if datetime.datetime.now(datetime.timezone.utc)>=deadline:raise RuntimeError('Window expired before deploy')
   p=subprocess.run(cmd,env=env,capture_output=True,text=True,timeout=600)
   result['exitCode']=p.returncode;result['stdout']=p.stdout;result['stderr']=p.stderr
   if p.returncode:raise RuntimeError('Deploy nonzero; no retry')
  want=classic if a.phase=='classic' else expected
  post=run(['config','show'],env);mm=run(['machine','list','--json'],env)
  if post!=want or len(mm)!=1 or mm[0]['image_ref']['digest']!=IMAGE.split('@')[1] or mm[0]['state']!='started':raise RuntimeError('Post-deploy config/image/state unverified')
  token=credentials('/home/cameronblackmon/.openclaw/credentials/kyst-board-auth.env')['KYST_AUTH_SERVICE_TOKEN'];checks=[]
  for path,wanted,auth in [('/api/health',200,False),('/api/tasks',401,False),('/api/layouts',200,True)]:
   req=urllib.request.Request('https://kyst-board.fly.dev'+path,headers={'x-kyst-service-token':token} if auth else {})
   try:
    with urllib.request.urlopen(req,timeout=20) as response:status=response.status;data=response.read()
   except urllib.error.HTTPError as e:status=e.code;data=e.read()
   checks.append({'path':path,'status':status,'expected':wanted,'sha256':hashlib.sha256(data).hexdigest()})
  result['checks']=checks
  if any(c['status']!=c['expected'] for c in checks):raise RuntimeError('Health/auth check failure')
  if checks[2]['sha256']!='175155fc5fb3e2b27b5b957e044d7473db826aaf0268ec204efe7c8ee4dd6147':raise RuntimeError('Saved layout response changed; reconcile before kiosk action')
  result['status']='server_verified_kiosk_unverified';result['releases']=run(['releases','--json'],env)[:2]
 except Exception as e:result['error']=str(e);raise
 finally:result['completed']=datetime.datetime.now(datetime.timezone.utc).isoformat();outcome.write_text(json.dumps(result,indent=2));print(json.dumps({'status':result['status'],'outcome':str(outcome)}))
if __name__=='__main__':main()
