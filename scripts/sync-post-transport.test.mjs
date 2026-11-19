import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createServer,request as httpsRequest} from 'node:https';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,unlinkSync,rmdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {makeSyncPost} from '../lib/sync-post-transport.mjs';
import {readSyncResponse,safeFailure,SafeSyncTransportError} from '../lib/sync-response-diagnostics.mjs';
const endpoint='https://sexytw.cc/api/profile-sync';
const canary='SYNTHETIC_SECRET_NOT_REAL';
const payload=JSON.stringify({mode:'commit',createOnly:true,capturedAt:'synthetic-time',profiles:[{sourceKey:'synthetic-1'}]});

function fakeTransport(actions,{timeoutMs=1000,connectTimeoutMs=100}={}) {
  const observed={requests:0,sends:0,retries:[],pauses:[],bodies:[]};
  const post=makeSyncPost({timeoutMs,connectTimeoutMs,pause:async ms=>observed.pauses.push(ms),request:(url,options,respond)=>{
    assert.equal(url,endpoint);assert.equal(options.agent.keepAlive,false);assert.equal(options.headers.Connection,'close');
    assert.equal(options.headers.Authorization,'Bearer '+canary);
    const req=new EventEmitter(),socket=new EventEmitter();
    const action=actions[observed.requests++];
    req.destroyed=false;req.destroy=()=>{req.destroyed=true;};
    req.end=body=>{
      observed.sends++;observed.bodies.push(body);
      if(action==='sent-reset')return queueMicrotask(()=>req.emit('error',Object.assign(new Error(canary),{code:'ECONNRESET'})));
      const res=new EventEmitter();res.complete=true;res.statusCode=200;res.headers={'content-type':'application/json'};
      respond(res);queueMicrotask(()=>{res.emit('data',Buffer.from('{"ok":true}'));res.emit('end');});
    };
    queueMicrotask(()=>{
      req.emit('socket',socket);
      if(action==='stall')return;
      if(action!=='ok'&&action!=='sent-reset')return req.emit('error',Object.assign(new Error(canary),{code:action}));
      assert.equal(observed.sends,0);socket.emit('secureConnect');
    });
    return req;
  }});
  return {observed,send:()=>post(endpoint,{secret:canary,body:payload,onRetry:d=>observed.retries.push(d)})};
}
test('transient failure before TLS retries slowly; sends exactly one identical POST',async()=>{
  const {observed,send}=fakeTransport(['ECONNRESET','EAI_AGAIN','ok']);
  assert.deepEqual(await (await send()).json(),{ok:true});
  assert.equal(observed.requests,3);assert.equal(observed.sends,1);assert.deepEqual(observed.bodies,[payload]);
  assert.deepEqual(observed.pauses,[2000,5000]);assert(observed.retries.every(d=>d.sent===false&&d.phase==='connect'));
  assert(!JSON.stringify(observed.retries).includes(canary));
});
test('three failed connects stop without sending any POST',async()=>{
  const {observed,send}=fakeTransport(['EAI_AGAIN','EAI_AGAIN','EAI_AGAIN']);
  await assert.rejects(send(),e=>e.diagnostic.attempt===3&&e.diagnostic.sent===false);
  assert.equal(observed.requests,3);assert.equal(observed.sends,0);
});
test('uncertain mutation delivery never replays',async()=>{
  const {observed,send}=fakeTransport(['sent-reset','ok']);
  await assert.rejects(send(),e=>e.diagnostic.code==='ECONNRESET'&&e.diagnostic.sent===true&&e.diagnostic.phase==='request');
  assert.equal(observed.requests,1);assert.equal(observed.sends,1);assert.deepEqual(observed.pauses,[]);
});
test('permanent TLS, unknown and DNS-not-found errors are not retried or disclosed',async()=>{
  for(const code of ['CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','ERR_TLS_CERT_ALTNAME_INVALID','ENOTFOUND',canary]) {
    const {observed,send}=fakeTransport([code]);
    await assert.rejects(send(),e=>!safeFailure(e).includes(canary));
    assert.equal(observed.requests,1);assert.equal(observed.sends,0);
  }
});
test('stalled handshake is bounded and cannot emit a POST',async()=>{
  const {observed,send}=fakeTransport(['stall','stall','stall'],{connectTimeoutMs:10});
  await assert.rejects(send(),e=>e.diagnostic.code==='SYNC_CONNECT_TIMEOUT');
  assert.equal(observed.requests,3);assert.equal(observed.sends,0);
});
test('wrong targets rejected before any secret or payload transmission',async()=>{
  let requests=0;const post=makeSyncPost({request:()=>{requests++;throw Error('should not send');}});
  for(const url of ['https://sexy00.cc/api/profile-sync','http://sexytw.cc/api/profile-sync',endpoint+'?redirect=evil','https://sexytw.cc.evil/api/profile-sync']) {
    await assert.rejects(post(url,{secret:canary,body:payload}),/dedicated sexytw/);
  }
  assert.equal(requests,0);
});
test('transport error diagnostics allow fixed fields only',()=>{
  const e=new SafeSyncTransportError({code:canary,phase:canary,sent:canary,attempt:canary,elapsedMs:Infinity,url:canary,message:canary});
  assert.deepEqual(JSON.parse(safeFailure(e)),{kind:'sync-transport',code:'UNKNOWN',phase:'unknown',sent:false,attempt:0,elapsedMs:0});
});

test('real HTTPS: verified TLS, fresh sockets, no redirects/replays, original response gates',async t=>{
  // Disposable loopback-only certificate. Never a production credential and
  // never trusted globally or used with rejectUnauthorized:false.
  const fixtureRoot=resolve('outputs');mkdirSync(fixtureRoot,{recursive:true});
  const temp=mkdtempSync(join(fixtureRoot,'sync-transport-tls-'));
  const keyPath=join(temp,'key.pem'),certPath=join(temp,'cert.pem');
  const gitOpenSsl='C:\\Program Files\\Git\\usr\\bin\\openssl.exe';
  const openssl=process.platform==='win32'&&existsSync(gitOpenSsl)?gitOpenSsl:'openssl';
  execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyPath,'-out',certPath,'-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost','-days','1'],{stdio:'ignore'});
  const ca=readFileSync(certPath);let requests=0;const sockets=new Set();let behavior='ok';
  const server=createServer({key:readFileSync(keyPath),cert:ca},(req,res)=>{
    requests++;sockets.add(req.socket.remotePort);
    assert.equal(req.headers.connection,'close');assert.equal(req.headers.authorization,'Bearer '+canary);
    const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{
      assert.equal(Buffer.concat(chunks).toString(),payload);
      if(behavior==='reset'){req.socket.destroy();return;}
      if(behavior==='stall-response')return;
      if(behavior==='truncated'){res.writeHead(200,{'content-type':'application/json','content-length':'500'});res.end('{"ok":');return;}
      if(behavior==='redirect'){res.writeHead(302,{location:'https://example.invalid/'+canary});res.end();return;}
      if(behavior==='limit'){res.writeHead(200,{'content-type':'application/json'});res.end('x'.repeat(1024*1024+1));return;}
      res.writeHead(behavior==='500'?500:behavior==='207'?207:200,{'content-type':'application/json'});
      res.end(behavior==='malformed'?canary:JSON.stringify(behavior==='207'?{ok:false,result:{errors:[{message:canary}]}}:behavior==='500'?{error:canary}:{ok:true,summary:{received:1},result:{created:0,updated:0,errors:[]}}));
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));unlinkSync(keyPath);unlinkSync(certPath);rmdirSync(temp);});
  let retries=0;
  const localRequest=trusted=>(url,options,callback)=>{
    assert.equal(url,endpoint);
    return httpsRequest(new URL('https://127.0.0.1:'+server.address().port+'/api/profile-sync'),{...options,servername:'localhost',...(trusted?{ca}:{})},callback);
  };
  const post=makeSyncPost({request:localRequest(true),timeoutMs:3000});
  const send=()=>post(endpoint,{secret:canary,body:payload,onRetry:()=>retries++});
  for(let i=0;i<2;i++)assert.equal((await readSyncResponse(await send(),{batch:true})).ok,true);
  assert.equal(requests,2);assert.equal(sockets.size,2);
  for(const next of ['500','redirect','malformed']){
    behavior=next;const before=requests;
    await assert.rejects(async()=>readSyncResponse(await send(),{batch:true}),e=>!safeFailure(e).includes(canary));
    assert.equal(requests,before+1);
  }
  behavior='207';const partial=await readSyncResponse(await send(),{batch:true});assert.equal(partial.ok,false);
  for(const next of ['reset','truncated','limit']){
    behavior=next;const before=requests;
    await assert.rejects(send(),e=>e instanceof SafeSyncTransportError&&e.diagnostic.sent===true&&!safeFailure(e).includes(canary));
    assert.equal(requests,before+1);
  }
  const untrusted=makeSyncPost({request:localRequest(false),timeoutMs:3000});const before=requests;
  await assert.rejects(untrusted(endpoint,{secret:canary,body:payload}),e=>e.diagnostic.code==='DEPTH_ZERO_SELF_SIGNED_CERT'&&!e.diagnostic.sent);
  assert.equal(requests,before);assert.equal(retries,0);
  behavior='stall-response';const beforeTimeout=requests;
  const bounded=makeSyncPost({request:localRequest(true),timeoutMs:500});
  await assert.rejects(bounded(endpoint,{secret:canary,body:payload,onRetry:()=>retries++}),e=>e.diagnostic.code==='ABORT_ERR'&&e.diagnostic.sent);
  assert.equal(requests,beforeTimeout+1);assert.equal(retries,0);
});
