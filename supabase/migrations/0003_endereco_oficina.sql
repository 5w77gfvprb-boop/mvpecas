-- 0003: endereço da oficina (aparece no relatório de envios para o entregador).
-- Rode no SQL Editor do Supabase (New query → colar → Run). Pode rodar de novo sem problema.
alter table public.oficinas add column if not exists endereco text;
notify pgrst, 'reload schema';
