// ⚠️ COLE AQUI o endereço e a chave pública do SEU projeto do Supabase (veja o SETUP.md, passo 3).
// Supabase → Project Settings → API Keys (ou Data API):
//   - SUPABASE_URL: "Project URL", algo como https://abcdefgh.supabase.co
//   - SUPABASE_KEY: a chave "publishable" (começa com sb_publishable_) ou a "anon".
// Essas duas são públicas por natureza (vão para o navegador de qualquer jeito).
// NUNCA coloque aqui a chave "secret" / "service_role".
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://hklwxlfoelgyesiruqyb.supabase.co";
export const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_tYMvP2PUPrCwwdavOc39nA_zF2YxU01";
