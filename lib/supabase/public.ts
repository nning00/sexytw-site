import { createClient } from "@supabase/supabase-js";
import { supabaseSchema } from "@/lib/site-instance";

function buildPublicClient(url: string, publishableKey: string, noStore = false) {
  return createClient(url, publishableKey, {
    db: { schema: supabaseSchema },
    ...(noStore ? { global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, cache: "no-store" }) } } : {}),
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

let publicClient: ReturnType<typeof buildPublicClient> | undefined;

export function createPublicClient(options: { noStore?: boolean } = {}) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error("Supabase public environment variables are not configured.");
  }

  if (options.noStore) return buildPublicClient(url, publishableKey, true);
  publicClient ??= buildPublicClient(url, publishableKey);
  return publicClient;
}
