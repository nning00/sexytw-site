export interface ResumeInput {
  provider: string; sourceKey: string; capturedAt: string; contentHash: string; cityId: string;
  draft: Record<string, unknown>; images: Array<{url: string; alt: string}>;
}
export interface ResumePlan {
  index: number; url: string; alt: string; storagePath: string; sha256: string;
  size: number; contentType: string; extension: string;
}
export interface ResumeObjectProof {
  storeId: string; storagePath: string; sha256: string; size: number; contentType: string;
  version: string; validatedImage: true; immutable: true;
}
/** Trusted server-code binding, never HTTP/request JSON. No real implementation is installed. */
export interface TrustedResumeStore {
  id: string; proofVersion: 1; immutable: true; validatesImageBytes: true;
  lookup(plan: ResumePlan): Promise<ResumeObjectProof | null>;
  putIfAbsent(plan: ResumePlan, bytes: Uint8Array): Promise<ResumeObjectProof>;
  verifyImmutable(proof: ResumeObjectProof): Promise<ResumeObjectProof>;
}
export type ResumeOutcome = {outcome: "created" | "replayed" | "skipped-existing"; published?: boolean};
export interface ResumeRpcClient {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{data: unknown; error: {message?: string} | null}>;
}
export function getTrustedResumeStore(): TrustedResumeStore | null;
export function getProfileResumeCapability(client: ResumeRpcClient, store: TrustedResumeStore | null): Promise<boolean>;
export function resumeCreateOnlyProfile(client: ResumeRpcClient, input: ResumeInput,
  download: (url: string) => Promise<{bytes: Uint8Array; contentType: string; extension: string}>,
  store: TrustedResumeStore | null): Promise<ResumeOutcome>;
