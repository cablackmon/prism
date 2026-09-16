#!/usr/bin/env python3
"""Fixed authenticated operator. No live action without exact MAIN NOX release.
Durable server grant/publication is the sole issuance ledger, including screenshots.
"""
import argparse,base64,datetime,hashlib,importlib.util,json,os,pathlib,subprocess,time,urllib.request
HERE=pathlib.Path(__file__).resolve().parent
URL='https://kyst-board.fly.dev/api/kyst-diagnostics'
PHASE={'bootstrap':'diagnostic-load','identity-frame':'identity-capture','scrolled-frame':'scrolled-capture','restored-frame':'restored-capture','classic-frame':'classic-capture','nox-frame':'nox-return-capture'}
IDS={'bootstrap':'nox11625-diagnostic-load','identity-frame':'nox11625-diagnostic-identity-frame','scrolled-frame':'nox11625-final-scroll-frame','restored-frame':'nox11625-final-restored-frame','classic-frame':'nox11625-final-classic-frame','nox-frame':'nox11625-final-nox-frame'}
def token():
 for line in pathlib.Path('/home/cameronblackmon/.openclaw/credentials/kyst-board-auth.env').read_text().splitlines():
  if line.startswith('KYST_AUTH_SERVICE_TOKEN='):return line.split('=',1)[1].strip().strip('"\'')
 raise RuntimeError('KYST_AUTH_SERVICE_TOKEN key not found in inspected auth file')
def call(session,action,body):
 request=urllib.request.Request(URL,data=json.dumps({'session':session,'action':action,'body':body}).encode(),headers={'Content-Type':'application/json','x-kyst-service-token':token()},method='POST')
 with urllib.request.urlopen(request,timeout=8) as response:return json.load(response)
def remote(script):
 spec=importlib.util.spec_from_file_location('kiosk_client','/home/cameronblackmon/.openclaw/workspace/scripts/kiosk_agent.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 encoded=base64.b64encode(script.encode('utf-16le')).decode()
 p=subprocess.run(m._base_ssh()+['powershell.exe -NoProfile -NonInteractive -EncodedCommand '+encoded],capture_output=True,text=True,timeout=45)
 if p.returncode:raise RuntimeError(p.stderr or p.stdout)
 return json.loads(p.stdout)
def dispatch(a):
 until=datetime.datetime.fromisoformat(a.until.replace('Z','+00:00'))
 if not datetime.datetime.now(datetime.timezone.utc)<until<=datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=45):raise RuntimeError('Fresh <=45minute window required')
 phase=PHASE[a.operation];cmdid=IDS[a.operation];qhash=hashlib.sha256((HERE/'queue-phase.ps1').read_bytes()).hexdigest()
 invoke=f"$ErrorActionPreference='Stop';$f='C:\\NoxAgent\\review\\nox-11625-diagnostic-load\\queue-phase.ps1';if((Get-FileHash $f -Algorithm SHA256).Hash.ToLowerInvariant() -cne '{qhash}'){{throw 'Publisher pin mismatch'}};& $f -Phase {phase} -ApprovedUntilUtc {until.strftime('%Y-%m-%dT%H:%M:%SZ')} "
 remote(invoke+'-PreflightOnly')
 grant=call(a.session,'arm',{'operation':a.operation})
 # A lost response from either call consumes the operation; never recover by replay.
 publication=call(a.session,'publish',{'operation':a.operation,'grant':grant['id']})
 if publication['commandId']!=cmdid:raise RuntimeError('Wrong fixed publication command')
 outcome={'grant':grant,'publication':publication,'status':'publication_may_start','release':a.release}
 out=pathlib.Path(a.out);out.mkdir(parents=True,exist_ok=True)
 def save(): (out/(cmdid+'.operator.json')).write_text(json.dumps(outcome,indent=2))
 save()
 try:
  outcome['queued']=remote(invoke+'-Execute');save()
  end=time.monotonic()+90
  while time.monotonic()<end:
   receipt=remote("$s=Get-Content C:\\NoxAgent\\state.json -Raw|ConvertFrom-Json;$r=@($s.commandReceipts|Where-Object {$_.commandId -ceq '"+cmdid+"'});if($r.Count -gt 1){throw 'Ambiguous receipt'};@{receipt=if($r.Count){$r[0]}else{$null};active=$s.lastResult}|ConvertTo-Json -Depth 6")
   if receipt['receipt']:break
   time.sleep(1)
  else:raise RuntimeError('Missing terminal receipt; no retry or forced cleanup')
  r=receipt['receipt'];outcome['receipt']=r
  if r['result']!='ok':raise RuntimeError('Native command failed: '+json.dumps(r))
  body={'operation':a.operation,'grant':grant['id'],'ok':True,'commandReceipt':hashlib.sha256(json.dumps(r,sort_keys=True).encode()).hexdigest()}
  if a.operation!='bootstrap':
   frame=remote("$ErrorActionPreference='Stop';$f='C:\\NoxAgent\\media\\"+cmdid+".png';Add-Type -AssemblyName System.Drawing;$im=[Drawing.Image]::FromFile($f);try{@{width=$im.Width;height=$im.Height;capturedAt=([DateTimeOffset](Get-Item $f).LastWriteTimeUtc).ToUnixTimeMilliseconds();sha256=(Get-FileHash $f -Algorithm SHA256).Hash.ToLowerInvariant();data=[Convert]::ToBase64String([IO.File]::ReadAllBytes($f))}|ConvertTo-Json}finally{$im.Dispose()}")
   image=base64.b64decode(frame.pop('data'));(out/(cmdid+'.png')).write_bytes(image)
   if hashlib.sha256(image).hexdigest()!=frame['sha256'] or frame['width']!=3840 or frame['height']!=2160:raise RuntimeError('Frame hash/geometry mismatch')
   body.update(frame)
  outcome['collector']=call(a.session,'capture-terminal',body);outcome['status']='terminal';save()
 except Exception as e:
  outcome['error']=str(e);save()
  # Do not fabricate a native terminal on timeout. Durable issued state blocks further work.
  raise
 return outcome
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('action',choices=['begin','status','verify','arm','dispatch','disable']);p.add_argument('--session',required=True);p.add_argument('--body-file');p.add_argument('--operation',choices=list(PHASE));p.add_argument('--until');p.add_argument('--out');p.add_argument('--release');p.add_argument('--execute',action='store_true');a=p.parse_args()
 if not a.execute or not a.release:raise SystemExit('Review only; exact release and --execute required')
 if a.action=='dispatch':
  if not all([a.operation,a.until,a.out]):raise SystemExit('Operation/window/output required')
  value=dispatch(a)
 else:value=call(a.session,a.action,json.loads(pathlib.Path(a.body_file).read_text()) if a.body_file else {})
 print(json.dumps(value,indent=2))
