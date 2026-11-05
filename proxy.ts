import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Refresh Supabase auth cookies only for authenticated administration paths.
 * Keeping public pages outside this matcher avoids an unnecessary auth request
 * for every visitor while still refreshing an idle administrator's session.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
