import {previousReleaseGate} from './release-gate.mjs';
// An explicit operator acknowledgement of ONE independently reviewed failure.
// No default waiver; cancelled, unknown and other failed releases stay blocked.
export function reviewedReleaseGate({runs,currentRunId,approvedRunId,review,artifact,baseline}) {
 try { previousReleaseGate(runs,currentRunId); return; }
 catch(error){ if(error.message!=='PREVIOUS_RELEASE_NOT_SUCCESSFUL_OPERATOR_REQUIRED')throw error; }
 const prior=runs.filter(r=>String(r.id)!==String(currentRunId)).sort((a,b)=>Number(b.run_number)-Number(a.run_number))[0];
 if(approvedRunId!=='44497061901'||review?.runId!==approvedRunId||String(prior?.id)!==approvedRunId
 ||prior.status!=='completed'||prior.conclusion!=='failure'||prior.run_attempt!==1||prior.head_branch!=='main'||prior.event!=='workflow_dispatch'||prior.head_sha!==review.sha
 ||review.evidence?.length!==1||review.evidence[0].phase!=='baseline'||review.evidence[0].previous!==review.previousVersion||review.evidence[0].sha!==review.sha
 ||baseline?.version!==review.previousVersion||baseline?.deployment!==review.previousDeployment
 ||artifact?.id!==review.artifactId||artifact.name!=='release-evidence-'+approvedRunId||artifact.expired!==false||artifact.digest!==review.artifactDigest
 ||String(artifact.workflow_run?.id)!==approvedRunId||artifact.workflow_run?.head_sha!==review.sha||artifact.workflow_run?.head_branch!=='main'
 ||artifact.workflow_run?.repository_id!==1438730780||artifact.workflow_run?.head_repository_id!==1438730780)throw Error('REVIEWED_FAILURE_EVIDENCE_OR_BASELINE_MISMATCH');
}
