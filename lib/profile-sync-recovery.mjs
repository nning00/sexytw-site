// Temporary restoration mode: preserve per-record seen time and cache refresh.
export function recoveryMode(args) { return args.includes('--create-only'); }
export function syncBatchPayload({commit,capturedAt,profiles,upsertOnly}) {
 return {mode:commit?'commit':'preview',capturedAt,deferRevalidation:!upsertOnly,profiles,createOnly:upsertOnly};
}
export function shouldFinalize({commit,selectedCity,limit,errors,warnings,upsertOnly}) {
 return commit && !selectedCity && limit===0 && errors===0 && warnings===0 && !upsertOnly;
}
