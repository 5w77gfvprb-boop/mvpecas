import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/config";

let client: SupabaseClient | null = null;

export function supabaseConfigurado(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_KEY && !SUPABASE_URL.startsWith("COLE_AQUI") && !SUPABASE_KEY.startsWith("COLE_AQUI") && /^https?:\/\//.test(SUPABASE_URL));
}

export function getSupabase(): SupabaseClient {
  if (!client) {
    if (!supabaseConfigurado()) throw new Error("Supabase não configurado (veja o arquivo src/lib/config.ts e o SETUP.md).");
    client = createBrowserClient(SUPABASE_URL.replace(/\/+$/, ""), SUPABASE_KEY);
  }
  return client;
}
