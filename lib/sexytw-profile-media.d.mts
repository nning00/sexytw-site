/** Trusted server code binding to PublicRead, never an arbitrary remote URL. */
export interface TrustedProfileMediaService {
  kind: 'scoped-profile-public-read-v2';
  fetch(request: Request): Promise<Response>;
}
export function getTrustedProfileMediaService(): TrustedProfileMediaService | null;
export function handleProfileMediaRequest(request: Request, options?: {
  enabled?: boolean;
  service?: TrustedProfileMediaService | null;
}): Promise<Response>;
