import { getTrustedProfileMediaService, handleProfileMediaRequest } from '@/lib/sexytw-profile-media.mjs';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

async function handle(request: Request) {
  const enabled = process.env.PROFILE_SYNC_RESUME_MEDIA_V2 === '1';
  return handleProfileMediaRequest(request, {
    enabled,
    service: enabled ? getTrustedProfileMediaService() : null,
  });
}

// Reject mutation/OPTIONS explicitly with the same empty, non-cacheable 404.
export { handle as GET, handle as HEAD, handle as POST, handle as PUT,
  handle as PATCH, handle as DELETE, handle as OPTIONS };
