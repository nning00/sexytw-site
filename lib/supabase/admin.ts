import { createClient } from "@supabase/supabase-js";
import { supabaseSchema } from "@/lib/site-instance";

function configuredClient(url: string, key: string) {
  return createClient(url, key, {
    db: { schema: supabaseSchema },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

let adminClient: ReturnType<typeof configuredClient> | undefined;

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase service role environment variables are not configured.");
  }

  const client = adminClient ?? configuredClient(url, serviceRoleKey);
  adminClient = client;
  return client;
}
