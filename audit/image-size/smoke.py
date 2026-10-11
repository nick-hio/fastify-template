import json, os, pathlib, sqlite3, subprocess, sys, tempfile, time, urllib.request, urllib.error
OUT = pathlib.Path(__file__).resolve().parent / 'results'
OUT.mkdir(exist_ok=True)
DATA = pathlib.Path('/home/t3svc/workloads/fastify-size-audit')
DATA.mkdir(parents=True, exist_ok=True)

def cmd(*args, check=True):
    p = subprocess.run(args, text=True, capture_output=True, timeout=45)
    if check and p.returncode:
        raise RuntimeError(f'{args}: {p.stdout} {p.stderr}')
    return p

def request(base, path, status=200, method='GET', body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(base+path, data=data, method=method, headers={'Content-Type':'application/json'} if data is not None else {})
    try:
        response=urllib.request.urlopen(r, timeout=5)
    except urllib.error.HTTPError as e:
        response=e
    raw=response.read()
    assert response.status==status, (method, path, response.status, raw)
    return json.loads(raw) if raw else None

def smoke(tag):
    name='fastify-size-audit-'+tag
    data=pathlib.Path(tempfile.mkdtemp(prefix=tag+'-', dir=DATA))
    result={'tag':tag, 'data_dir':str(data), 'checks':[], 'expected_limitations':[]}
    def passed(check): result['checks'].append(check)
    try:
        cmd('docker','run','-d','--name',name,'--read-only','--cap-drop=ALL','--security-opt=no-new-privileges:true','--user',f'{os.getuid()}:{os.getgid()}', '--mount',f'type=bind,src={data},dst=/data','-p','127.0.0.1::3000', 'fastify-size-audit:'+tag)
        port=cmd('docker','port',name,'3000/tcp').stdout.strip().split(':')[-1]
        base='http://127.0.0.1:'+port
        for _ in range(100):
            try:
                assert request(base,'/health')=={'status':'ok'}
                break
            except (OSError,AssertionError): time.sleep(.1)
        else: raise RuntimeError('server did not start: '+cmd('docker','logs',name).stdout)
        passed('HTTP health')
        db=sqlite3.connect(data/'database.db')
        assert db.execute('select count(*) from __drizzle_migrations').fetchone()[0]==2
        db.close()
        passed('both migrations applied')
        created=request(base,'/example',201,'POST',{'key':'size-audit','value':'before'})
        assert created['createdAt'] and created['id']
        row=f"/example/{created['id']}"
        assert request(base,row)==created
        assert request(base,'/example?limit=1')['items']==[created]
        request(base,'/example',409,'POST',{'key':'size-audit','value':'duplicate'})
        invalid=request(base,'/example',400,'POST',{'key':'','value':'bad'})
        assert invalid['issues']
        assert request(base,row,200,'PATCH',{'value':'after'})['value']=='after'
        passed('create, read, cursor list, update, conflict and validation')
        for key in ['page-a','page-b']:
            request(base,'/example',201,'POST',{'key':key,'value':'v'})
        first=request(base,'/example?limit=1')
        second=request(base,f"/example?limit=1&cursor={first['nextCursor']}")
        assert first['nextCursor'] and first['items'][0]['id']!=second['items'][0]['id']
        passed('cursor advances')
        package=cmd('docker','exec',name, *(['server','backup'] if tag=='compiled' else ['bun','run','db:backup']),'/data/package-backup.db',check=False)
        result['backup_script_exit']=package.returncode
        if 'distroless' in tag:
            assert package.returncode!=0 and 'MissingShell' in package.stderr, package.stderr
            result['expected_limitations'].append('bun run db:backup fails with MissingShell')
            backup='app/backup.js' if tag.startswith('bundled') else 'src/db/backup.ts'
            cmd('docker','exec',name,'bun',backup,'/data/package-backup.db')
        else:
            assert package.returncode==0, package.stderr
        db=sqlite3.connect(data/'package-backup.db')
        assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
        assert db.execute('select value from kv where key=?',('size-audit',)).fetchone()[0]=='after'
        db.close()
        passed('live backup integrity and persisted content')
        if tag != 'compiled':
            tls=cmd('docker','exec',name,'bun','-e','const r=await fetch("https://example.com"); if(!r.ok)process.exit(1); console.log(r.status)',check=False)
            result['https_exit']=tls.returncode
            result['https_output']=tls.stdout+tls.stderr
            assert tls.returncode==0, tls.stderr
            passed('outbound HTTPS and DNS')
            cmd('docker','exec',name,'bun','-e','if(process.getuid()!==Number(Bun.argv.at(-1)))process.exit(1); try{require("node:fs").writeFileSync("/usr/src/app/must-not-write", "x");process.exit(1)}catch(e){if(e.code!=="EROFS"&&e.code!=="EACCES")throw e}',str(os.getuid()))
            passed('non-root UID override and read-only application directory')
        for _ in range(80):
            health=cmd('docker','inspect','--format','{{.State.Health.Status}}',name).stdout.strip()
            if health=='healthy': break
            time.sleep(.25)
        assert health=='healthy', health
        passed('Docker HEALTHCHECK')
        cmd('docker','stop','--time','10',name)
        state=json.loads(cmd('docker','inspect',name).stdout)[0]['State']
        assert state['ExitCode']==0, state
        logs=cmd('docker','logs',name).stdout
        assert 'Server closed' in logs
        passed('SIGTERM graceful shutdown, exit 0')
        cmd('docker','start',name)
        port=cmd('docker','port',name,'3000/tcp').stdout.strip().split(':')[-1]
        base='http://127.0.0.1:'+port
        for _ in range(100):
            try:
                assert request(base,row)['value']=='after'
                break
            except (OSError,AssertionError): time.sleep(.1)
        else: raise RuntimeError('restart failed')
        db=sqlite3.connect(data/'database.db')
        assert db.execute('select count(*) from __drizzle_migrations').fetchone()[0]==2
        db.close()
        request(base,row,204,'DELETE')
        request(base,row,404)
        passed('restart persistence, migrations not repeated, delete and 404')
        result['ok']=True
    except Exception as e:
        result['ok']=False
        result['error']=str(e)
    finally:
        logs=cmd('docker','logs',name,check=False)
        (OUT/f'smoke-{tag}.log').write_text(logs.stdout+logs.stderr)
        cmd('docker','rm','-f',name,check=False)
        (OUT/f'smoke-{tag}.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result),flush=True)
    return result['ok']

if __name__=='__main__':
    success=True
    for tag in sys.argv[1:]: success=smoke(tag) and success
    sys.exit(0 if success else 1)
