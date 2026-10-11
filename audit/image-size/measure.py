import http.client, json, pathlib, socket
class Docker(http.client.HTTPConnection):
    def __init__(self): super().__init__('localhost')
    def connect(self):
        self.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
        self.sock.connect('/var/run/docker.sock')
def api(path):
    c=Docker(); c.request('GET',path); r=c.getresponse(); data=json.load(r); c.close(); return data
result=[]
for tag in ['baseline','nopeer','alpine','distroless','bundled-alpine','bundled-distroless','compiled','pruned-alpine']:
    name='fastify-size-audit:'+tag
    info=api('/images/'+name+'/json')
    if 'Id' not in info: continue
    history=api('/images/'+name+'/history')
    result.append({'tag':tag,'id':info['Id'],'disk_bytes':info['Size'],'snapshot_bytes':sum(x['Size'] for x in history),'history':[{'bytes':h['Size'],'instruction':h['CreatedBy']} for h in history if h['Size']],'layers':info['RootFS']['Layers']})
output=pathlib.Path(__file__).resolve().parent / 'results'
output.mkdir(exist_ok=True)
(output / 'measurements.json').write_text(json.dumps(result,indent=2)+'\n')
for row in result: print(row['tag'], row['disk_bytes']/1e6, row['snapshot_bytes']/1e6, (row['disk_bytes']-row['snapshot_bytes'])/1e6)
