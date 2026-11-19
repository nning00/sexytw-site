// Node-only Actions client. Never imported by the Worker or browser bundle.
import {Agent, request as httpsRequest} from 'node:https';
import {setTimeout as sleep} from 'node:timers/promises';
import {assertSyncEndpoint} from './profile-sync-target.mjs';
import {SafeSyncTransportError} from './sync-response-diagnostics.mjs';

// Do not reuse a TCP socket across hundreds of sequential mutations. TLS
// session resumption remains available without keeping an idle HTTP socket.
const agent = new Agent({keepAlive:false,maxCachedSessions:100});
const transientConnectCodes = new Set(['ECONNRESET','ECONNREFUSED','EAI_AGAIN','ENETUNREACH','EHOSTUNREACH','ETIMEDOUT','SYNC_CONNECT_TIMEOUT']);
function transportCode(error) {
  return typeof error?.code==='string' ? error.code : error?.cause?.code;
}

export function makeSyncPost({request=httpsRequest,pause=sleep,now=Date.now,timeoutMs=120000,connectTimeoutMs=10000,responseLimit=1024*1024}={}) {
  return async function post(endpoint,{secret,body,onRetry=()=>{}}) {
    assertSyncEndpoint(endpoint); // Before constructing an authenticated request.
    if(typeof secret!=='string'||!secret.trim()||typeof body!=='string') throw Error('Invalid sync transport input');
    const signal=AbortSignal.timeout(timeoutMs);
    const started=now();
    for(let attempt=1;attempt<=3;attempt++) {
      try {
        return await new Promise((resolve,reject)=>{
          let sent=false,phase='connect',settled=false,connectTimer;
          const fail=error=>{
            if(settled)return;
            settled=true;clearTimeout(connectTimer);
            reject(new SafeSyncTransportError({code:transportCode(error),phase,sent,attempt,elapsedMs:now()-started}));
          };
          let req;
          try {
            req=request(endpoint,{method:'POST',agent,signal,headers:{
              'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),
              Accept:'application/json','Accept-Encoding':'identity',Connection:'close',Authorization:`Bearer ${secret}`,
            }},res=>{
              phase='response';let size=0;const chunks=[];
              res.on('error',fail);
              res.on('aborted',()=>fail({code:'SYNC_RESPONSE_INCOMPLETE'}));
              res.on('data',chunk=>{
                size+=chunk.length;
                if(size>responseLimit){fail({code:'SYNC_RESPONSE_LIMIT'});res.destroy();req.destroy();return;}
                chunks.push(chunk);
              });
              res.on('end',()=>{
                if(settled)return;
                if(!res.complete){fail({code:'SYNC_RESPONSE_INCOMPLETE'});return;}
                try {
                  const bytes=Buffer.concat(chunks);
                  const response=new Response(bytes.length?bytes:null,{status:res.statusCode,headers:{'content-type':res.headers['content-type']||''}});
                  settled=true;clearTimeout(connectTimer);resolve(response);
                } catch(error){fail(error);}
              });
            });
            req.on('error',fail);
            req.on('socket',socket=>{
              if(req.reusedSocket){fail({code:'SYNC_REUSED_SOCKET'});req.destroy();return;}
              socket.once('secureConnect',()=>{
                if(settled||signal.aborted){req.destroy();return;}
                clearTimeout(connectTimer);
                // No flushHeaders/write/end before TLS succeeds. Once end is
                // attempted, delivery is uncertain: NEVER replay this POST.
                phase='request';sent=true;
                try { req.end(body); } catch(error){fail(error);req.destroy();}
              });
            });
            connectTimer=setTimeout(()=>{fail({code:'SYNC_CONNECT_TIMEOUT'});req.destroy();},connectTimeoutMs);
          } catch(error){fail(error);req?.destroy();}
        });
      } catch(error) {
        const d=error instanceof SafeSyncTransportError?error.diagnostic:null;
        // Retry only a transient connection failure proven to precede every
        // HTTP byte. No HTTP/207, image, application, or ambiguous-write retry.
        if(!d||d.sent||d.phase!=='connect'||!transientConnectCodes.has(d.code)||attempt===3||signal.aborted)throw error;
        onRetry(d);
        await pause(attempt===1?2000:5000,undefined,{signal});
      }
    }
  };
}
export const postSyncRequest=makeSyncPost();
