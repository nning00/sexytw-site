import {validateSnapshotProof} from './profile-sync-snapshot.mjs';
export async function reconcilePresence(client,body,now=Date.now()) {
 const keys=validateSnapshotProof(body.snapshotProof,body.snapshotSourceKeys,body.capturedAt,now);
 if(body.snapshotProof.importErrors!==0||body.snapshotProof.importWarnings!==0||Date.parse(body.capturedAt)>now)throw Error('Incomplete import evidence');
 const {data,error}=await client.rpc('sexytw_finalize_presence_v3',{p_keys:keys,p_at:body.capturedAt,p_proof:body.snapshotProof});
 if(error)throw Error(error.message);
 if(data?.complete!==true||data.deleted!==0||data.imagesDeleted!==0)throw Error('Invalid non-destructive presence response');
 return data;
}
