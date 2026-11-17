-- MV Peças: controle de pedidos de peças (carro → peças → compra, envio, entrega, nota, cobrança).
-- Rode este arquivo inteiro no SQL Editor do Supabase (New query → colar → Run).
-- Pode rodar de novo sem estragar nada: não apaga dados e não duplica cadastros.

-- Dia de hoje no horário de Brasília (o banco trabalha em UTC).
create or replace function public.hoje() returns date
language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

-- =====================================================================================
-- CADASTROS
-- =====================================================================================
create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) > 0),
  telefone text,
  observacoes text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create unique index if not exists clientes_nome_uq on public.clientes (lower(trim(nome)));

create table if not exists public.oficinas (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) > 0),
  cidade text,
  telefone text,
  observacoes text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create unique index if not exists oficinas_nome_uq on public.oficinas (lower(trim(nome)));

create table if not exists public.fornecedores (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) > 0),
  telefone text,
  observacoes text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create unique index if not exists fornecedores_nome_uq on public.fornecedores (lower(trim(nome)));

insert into public.clientes (nome) values ('Protivaço'), ('Aliar')
on conflict ((lower(trim(nome)))) do nothing;

-- =====================================================================================
-- PEDIDOS (um por carro) E PEÇAS
-- =====================================================================================
create table if not exists public.pedidos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete restrict,
  oficina_id uuid references public.oficinas(id) on delete restrict,
  veiculo text not null default '',                       -- modelo: "Gol G5", "HB20"…
  placa text check (placa is null or placa ~ '^[A-Z0-9]{7}$'),   -- sem traço, maiúsculas
  ano text,
  referencia text,                                        -- nº do evento / sinistro / OS do cliente
  observacoes text,
  data_pedido date not null default public.hoje(),
  dispensa_nf boolean not null default false,             -- este carro não vai ter nota de venda
  excluido_em timestamptz,                                -- lixeira
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists pedidos_cliente_idx on public.pedidos (cliente_id);
create index if not exists pedidos_placa_idx on public.pedidos (placa);
create index if not exists pedidos_data_idx on public.pedidos (data_pedido);

-- Nota de venda (o contador emite). Normalmente uma por carro; se chegarem peças depois, pode ter outra.
create table if not exists public.notas_venda (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  enviada_em date not null default public.hoje(),        -- quando mandei para o contador
  numero text,
  emitida_em date,                                        -- quando o contador emitiu
  observacoes text,
  excluido_em timestamptz,
  itens_vinculados uuid[],                                -- peças que estavam nela quando foi para a lixeira
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists notas_pedido_idx on public.notas_venda (pedido_id);

-- Cobrança: boleto, cheque, pix… Pode juntar um carro só ou vários carros do mesmo cliente.
create table if not exists public.cobrancas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete restrict,
  forma text not null default 'boleto' check (forma in ('boleto', 'cheque', 'pix', 'transferencia', 'dinheiro', 'outro')),
  criada_em date not null default public.hoje(),
  enviada_em date,                                        -- boleto enviado ao cliente / cheque recebido
  observacoes text,
  excluido_em timestamptz,
  itens_vinculados uuid[],
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists cobrancas_cliente_idx on public.cobrancas (cliente_id);

-- Parcelas da cobrança (1 boleto = 1 parcela; cheques 30/60/90 = 3 parcelas).
create table if not exists public.cobranca_parcelas (
  id uuid primary key default gen_random_uuid(),
  cobranca_id uuid not null references public.cobrancas(id) on delete cascade,
  numero int not null default 1,
  vencimento date not null,
  valor numeric(12,2) not null check (valor >= 0),
  documento text,                                         -- nº do boleto / nº do cheque e banco
  pago_em date,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists parcelas_cobranca_idx on public.cobranca_parcelas (cobranca_id);

create table if not exists public.itens (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  descricao text not null check (length(trim(descricao)) > 0),
  quantidade int not null default 1 check (quantidade > 0),
  fornecedor_id uuid references public.fornecedores(id) on delete restrict,
  custo numeric(12,2) check (custo is null or custo >= 0),      -- valor pago, por unidade
  venda numeric(12,2) check (venda is null or venda >= 0),      -- valor de venda, por unidade
  comprado_em date,
  enviado_em date,
  entregue_em date,
  nf_fornecedor text check (nf_fornecedor is null or nf_fornecedor in ('pendente', 'recebida', 'sem_nota')),
  nota_id uuid references public.notas_venda(id) on delete set null,
  cobranca_id uuid references public.cobrancas(id) on delete set null,
  cancelado_em date,
  motivo_cancelamento text,
  sobra_resolvida boolean not null default false,         -- comprada e cancelada: já devolvi / guardei
  observacoes text,
  ordem int not null default 0,
  excluido_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint itens_envio_depois_compra check (enviado_em is null or comprado_em is not null),
  constraint itens_entrega_depois_envio check (entregue_em is null or enviado_em is not null)
);
create index if not exists itens_pedido_idx on public.itens (pedido_id);
create index if not exists itens_nota_idx on public.itens (nota_id);
create index if not exists itens_cobranca_idx on public.itens (cobranca_id);
create index if not exists itens_fornecedor_idx on public.itens (fornecedor_id);

-- =====================================================================================
-- REGRAS AUTOMÁTICAS
-- =====================================================================================
create or replace function public.tocar_atualizado() returns trigger
language plpgsql as $$ begin new.atualizado_em := now(); return new; end $$;

do $$ declare t text; begin
  foreach t in array array['pedidos', 'itens', 'notas_venda', 'cobrancas', 'cobranca_parcelas'] loop
    execute format('drop trigger if exists tocar_atualizado on public.%I', t);
    execute format('create trigger tocar_atualizado before update on public.%I for each row execute function public.tocar_atualizado()', t);
  end loop;
end $$;

-- Limpa textos e confere se a peça, a nota e a cobrança são do mesmo carro / cliente.
create or replace function public.conferir_item() returns trigger
language plpgsql as $$
declare v_cli uuid; v_cli_cob uuid; v_ped_nota uuid;
begin
  new.descricao := trim(new.descricao);
  if new.cancelado_em is null then new.motivo_cancelamento := null; new.sobra_resolvida := false; end if;
  if new.nota_id is not null and (tg_op = 'INSERT' or new.nota_id is distinct from old.nota_id or new.pedido_id is distinct from old.pedido_id) then
    select pedido_id into v_ped_nota from public.notas_venda where id = new.nota_id;
    if v_ped_nota is distinct from new.pedido_id then
      raise exception 'Esta nota é de outro carro.';
    end if;
  end if;
  if new.cobranca_id is not null and (tg_op = 'INSERT' or new.cobranca_id is distinct from old.cobranca_id or new.pedido_id is distinct from old.pedido_id) then
    select cliente_id into v_cli from public.pedidos where id = new.pedido_id;
    select cliente_id into v_cli_cob from public.cobrancas where id = new.cobranca_id;
    if v_cli is distinct from v_cli_cob then
      raise exception 'Esta cobrança é de outro cliente.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists conferir_item on public.itens;
create trigger conferir_item before insert or update on public.itens for each row execute function public.conferir_item();

-- Trocar o cliente de um carro que já tem peça em cobrança de outro cliente não pode.
create or replace function public.conferir_pedido() returns trigger
language plpgsql as $$
begin
  new.veiculo := trim(coalesce(new.veiculo, ''));
  if new.placa is not null then
    new.placa := nullif(upper(regexp_replace(new.placa, '[^A-Za-z0-9]', '', 'g')), '');
  end if;
  if tg_op = 'UPDATE' and new.cliente_id is distinct from old.cliente_id and exists (
    select 1 from public.itens i join public.cobrancas c on c.id = i.cobranca_id
     where i.pedido_id = new.id and c.cliente_id <> new.cliente_id) then
    raise exception 'Este carro tem peças numa cobrança do cliente anterior. Tire as peças da cobrança antes de trocar o cliente.';
  end if;
  return new;
end $$;
drop trigger if exists conferir_pedido on public.pedidos;
create trigger conferir_pedido before insert or update on public.pedidos for each row execute function public.conferir_pedido();

-- =====================================================================================
-- HISTÓRICO (tudo o que muda fica registrado, para conferir e voltar atrás)
-- =====================================================================================
create table if not exists public.historico (
  id bigserial primary key,
  quando timestamptz not null default now(),
  tabela text not null,
  registro_id uuid,
  pedido_id uuid,
  cobranca_id uuid,
  acao text not null,           -- INSERT / UPDATE / DELETE
  antes jsonb,
  depois jsonb
);
create index if not exists historico_pedido_idx on public.historico (pedido_id, quando desc);
create index if not exists historico_cobranca_idx on public.historico (cobranca_id, quando desc);

create or replace function public.registrar_historico() returns trigger
language plpgsql as $$
declare v_old jsonb; v_new jsonb; v_antes jsonb; v_depois jsonb; v_reg jsonb; v_ped uuid; v_cob uuid;
begin
  if coalesce(current_setting('mv.restaurando', true), '') = '1' then return null; end if;
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(key, v_old -> key), jsonb_object_agg(key, value) into v_antes, v_depois
      from jsonb_each(v_new) where key <> 'atualizado_em' and (v_old -> key) is distinct from value;
    if v_depois is null then return null; end if;
  else
    v_antes := v_old; v_depois := v_new;
  end if;
  v_reg := coalesce(v_new, v_old);
  v_ped := case tg_table_name when 'pedidos' then (v_reg ->> 'id')::uuid
                              when 'itens' then (v_reg ->> 'pedido_id')::uuid
                              when 'notas_venda' then (v_reg ->> 'pedido_id')::uuid end;
  v_cob := case tg_table_name when 'cobrancas' then (v_reg ->> 'id')::uuid
                              when 'cobranca_parcelas' then (v_reg ->> 'cobranca_id')::uuid
                              when 'itens' then coalesce((v_new ->> 'cobranca_id')::uuid, (v_old ->> 'cobranca_id')::uuid) end;
  insert into public.historico (tabela, registro_id, pedido_id, cobranca_id, acao, antes, depois)
  values (tg_table_name, (v_reg ->> 'id')::uuid, v_ped, v_cob, tg_op, v_antes, v_depois);
  return null;
end $$;

do $$ declare t text; begin
  foreach t in array array['pedidos', 'itens', 'notas_venda', 'cobrancas', 'cobranca_parcelas'] loop
    execute format('drop trigger if exists historico on public.%I', t);
    execute format('create trigger historico after insert or update or delete on public.%I for each row execute function public.registrar_historico()', t);
  end loop;
end $$;

-- =====================================================================================
-- VISÕES (resumo de cada carro e de cada cobrança)
-- =====================================================================================
drop view if exists public.v_pedidos;
create view public.v_pedidos with (security_invoker = true) as
with base as (
  select p.*, c.nome as cliente_nome, o.nome as oficina_nome,
         coalesce(a.n_total, 0)::int as n_total,
         coalesce(a.n_ativos, 0)::int as n_ativos,
         coalesce(a.n_comprados, 0)::int as n_comprados,
         coalesce(a.n_enviados, 0)::int as n_enviados,
         coalesce(a.n_entregues, 0)::int as n_entregues,
         coalesce(a.n_sem_nota, 0)::int as n_sem_nota,
         coalesce(a.n_nota_aguardando, 0)::int as n_nota_aguardando,
         coalesce(a.n_sem_cobranca, 0)::int as n_sem_cobranca,
         coalesce(a.n_a_receber, 0)::int as n_a_receber,
         coalesce(a.n_sobras, 0)::int as n_sobras,
         coalesce(a.total_venda, 0)::numeric(12,2) as total_venda,
         coalesce(a.total_custo, 0)::numeric(12,2) as total_custo,
         coalesce(a.n_sem_preco, 0)::int as n_sem_preco,
         a.ultima_entrega
    from public.pedidos p
    join public.clientes c on c.id = p.cliente_id
    left join public.oficinas o on o.id = p.oficina_id
    left join lateral (
      select count(*) as n_total,
             count(*) filter (where i.cancelado_em is null) as n_ativos,
             count(*) filter (where i.cancelado_em is null and i.comprado_em is not null) as n_comprados,
             count(*) filter (where i.cancelado_em is null and i.enviado_em is not null) as n_enviados,
             count(*) filter (where i.cancelado_em is null and i.entregue_em is not null) as n_entregues,
             count(*) filter (where i.cancelado_em is null and i.nota_id is null) as n_sem_nota,
             count(*) filter (where i.cancelado_em is null and i.nota_id is not null and n.emitida_em is null) as n_nota_aguardando,
             count(*) filter (where i.cancelado_em is null and i.cobranca_id is null) as n_sem_cobranca,
             count(*) filter (where i.cancelado_em is null and i.cobranca_id is not null and not coalesce(cb.paga, false)) as n_a_receber,
             count(*) filter (where i.cancelado_em is not null and i.comprado_em is not null and not i.sobra_resolvida) as n_sobras,
             sum(i.quantidade * i.venda) filter (where i.cancelado_em is null) as total_venda,
             sum(i.quantidade * i.custo) filter (where i.cancelado_em is null) as total_custo,
             count(*) filter (where i.cancelado_em is null and (i.venda is null or (i.comprado_em is not null and i.custo is null))) as n_sem_preco,
             max(i.entregue_em) filter (where i.cancelado_em is null) as ultima_entrega
        from public.itens i
        left join public.notas_venda n on n.id = i.nota_id
        left join lateral (
          select count(*) > 0 and bool_and(pp.pago_em is not null) as paga
            from public.cobranca_parcelas pp where pp.cobranca_id = i.cobranca_id
        ) cb on true
       where i.pedido_id = p.id and i.excluido_em is null
    ) a on true
   where p.excluido_em is null
)
select b.*,
  case
    when b.n_total = 0 then 'sem_pecas'
    when b.n_ativos = 0 and b.n_sobras = 0 then 'cancelado'
    when b.n_comprados < b.n_ativos then 'comprar'
    when b.n_enviados < b.n_ativos then 'enviar'
    when b.n_entregues < b.n_ativos then 'entregar'
    when not b.dispensa_nf and b.n_sem_nota > 0 then 'mandar_nf'
    when not b.dispensa_nf and b.n_nota_aguardando > 0 then 'aguardando_nf'
    when b.n_sem_cobranca > 0 then 'cobrar'
    when b.n_a_receber > 0 then 'receber'
    when b.n_sobras > 0 then 'sobras'
    else 'concluido'
  end as etapa
from base b;

drop view if exists public.v_cobrancas;
create view public.v_cobrancas with (security_invoker = true) as
select c.*, cl.nome as cliente_nome,
       coalesce(p.total, 0)::numeric(12,2) as total,
       coalesce(p.recebido, 0)::numeric(12,2) as recebido,
       coalesce(p.n_parcelas, 0)::int as n_parcelas,
       coalesce(p.n_pagas, 0)::int as n_pagas,
       p.proximo_vencimento,
       p.ultimo_pagamento,
       coalesce(it.total_pecas, 0)::numeric(12,2) as total_pecas,
       coalesce(it.n_pecas, 0)::int as n_pecas,
       coalesce(it.carros, '') as carros,
       (coalesce(p.n_parcelas, 0) > 0 and p.n_pagas = p.n_parcelas) as paga
  from public.cobrancas c
  join public.clientes cl on cl.id = c.cliente_id
  left join lateral (
    select sum(valor) as total, sum(valor) filter (where pago_em is not null) as recebido,
           count(*) as n_parcelas, count(*) filter (where pago_em is not null) as n_pagas,
           min(vencimento) filter (where pago_em is null) as proximo_vencimento,
           max(pago_em) as ultimo_pagamento
      from public.cobranca_parcelas where cobranca_id = c.id
  ) p on true
  left join lateral (
    select sum(i.quantidade * coalesce(i.venda, 0)) filter (where i.cancelado_em is null and i.excluido_em is null) as total_pecas,
           count(*) filter (where i.cancelado_em is null and i.excluido_em is null) as n_pecas,
           string_agg(distinct trim(both ' ' from pe.veiculo || ' ' || coalesce(pe.placa, '')), ', ') as carros
      from public.itens i join public.pedidos pe on pe.id = i.pedido_id
     where i.cobranca_id = c.id
  ) it on true
 where c.excluido_em is null;

-- =====================================================================================
-- AÇÕES (cada uma acontece inteira ou não acontece)
-- =====================================================================================

-- Novo carro com a lista de peças.
create or replace function public.criar_pedido(p_pedido jsonb, p_itens jsonb) returns uuid
language plpgsql as $$
declare v_id uuid; v_item jsonb; v_ordem int := 0;
begin
  insert into public.pedidos (cliente_id, oficina_id, veiculo, placa, ano, referencia, observacoes, data_pedido)
  values ((p_pedido ->> 'cliente_id')::uuid, nullif(p_pedido ->> 'oficina_id', '')::uuid,
          coalesce(p_pedido ->> 'veiculo', ''), nullif(p_pedido ->> 'placa', ''), nullif(p_pedido ->> 'ano', ''),
          nullif(p_pedido ->> 'referencia', ''), nullif(p_pedido ->> 'observacoes', ''),
          coalesce(nullif(p_pedido ->> 'data_pedido', '')::date, public.hoje()))
  returning id into v_id;
  for v_item in select * from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) loop
    v_ordem := v_ordem + 1;
    insert into public.itens (pedido_id, descricao, quantidade, venda, ordem)
    values (v_id, v_item ->> 'descricao', greatest(coalesce((v_item ->> 'quantidade')::int, 1), 1),
            nullif(v_item ->> 'venda', '')::numeric, v_ordem);
  end loop;
  return v_id;
end $$;

-- Acrescenta peças a um carro que já existe.
create or replace function public.adicionar_itens(p_pedido uuid, p_itens jsonb) returns int
language plpgsql as $$
declare v_item jsonb; v_ordem int; v_n int := 0;
begin
  select coalesce(max(ordem), 0) into v_ordem from public.itens where pedido_id = p_pedido;
  for v_item in select * from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) loop
    v_ordem := v_ordem + 1; v_n := v_n + 1;
    insert into public.itens (pedido_id, descricao, quantidade, venda, ordem)
    values (p_pedido, v_item ->> 'descricao', greatest(coalesce((v_item ->> 'quantidade')::int, 1), 1),
            nullif(v_item ->> 'venda', '')::numeric, v_ordem);
  end loop;
  return v_n;
end $$;

-- Mandei a nota para o contador (com as peças escolhidas).
create or replace function public.criar_nota(p_pedido uuid, p_itens uuid[], p_enviada_em date, p_numero text default null, p_emitida_em date default null, p_obs text default null) returns uuid
language plpgsql as $$
declare v_id uuid; v_n int;
begin
  if coalesce(array_length(p_itens, 1), 0) = 0 then raise exception 'Escolha pelo menos uma peça.'; end if;
  insert into public.notas_venda (pedido_id, enviada_em, numero, emitida_em, observacoes)
  values (p_pedido, coalesce(p_enviada_em, public.hoje()), nullif(trim(p_numero), ''), p_emitida_em, nullif(trim(p_obs), ''))
  returning id into v_id;
  update public.itens set nota_id = v_id
   where id = any (p_itens) and pedido_id = p_pedido and nota_id is null and excluido_em is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Estas peças já estão em outra nota.'; end if;
  return v_id;
end $$;

-- Nova cobrança (um ou vários carros do mesmo cliente) com as parcelas.
create or replace function public.criar_cobranca(p_cliente uuid, p_forma text, p_enviada_em date, p_obs text, p_itens uuid[], p_parcelas jsonb) returns uuid
language plpgsql as $$
declare v_id uuid; v_p jsonb; v_num int := 0; v_n int;
begin
  if jsonb_typeof(p_parcelas) <> 'array' or jsonb_array_length(p_parcelas) = 0 then raise exception 'Informe pelo menos uma parcela.'; end if;
  insert into public.cobrancas (cliente_id, forma, enviada_em, observacoes)
  values (p_cliente, coalesce(p_forma, 'boleto'), p_enviada_em, nullif(trim(p_obs), ''))
  returning id into v_id;
  for v_p in select * from jsonb_array_elements(p_parcelas) loop
    v_num := v_num + 1;
    insert into public.cobranca_parcelas (cobranca_id, numero, vencimento, valor, documento, pago_em)
    values (v_id, v_num, (v_p ->> 'vencimento')::date, (v_p ->> 'valor')::numeric, nullif(trim(v_p ->> 'documento'), ''), nullif(v_p ->> 'pago_em', '')::date);
  end loop;
  if coalesce(array_length(p_itens, 1), 0) > 0 then
    update public.itens set cobranca_id = v_id where id = any (p_itens) and cobranca_id is null and excluido_em is null;
    get diagnostics v_n = row_count;
    if v_n < array_length(p_itens, 1) then raise exception 'Algumas peças já estão em outra cobrança. Atualize a tela e tente de novo.'; end if;
  end if;
  return v_id;
end $$;

-- Lixeira de nota / cobrança: guarda quais peças estavam nelas e solta as peças.
create or replace function public.excluir_nota(p_id uuid) returns void
language plpgsql as $$
begin
  update public.notas_venda set excluido_em = now(),
         itens_vinculados = (select array_agg(id) from public.itens where nota_id = p_id)
   where id = p_id and excluido_em is null;
  update public.itens set nota_id = null where nota_id = p_id;
end $$;

create or replace function public.restaurar_nota(p_id uuid) returns int
language plpgsql as $$
declare v_n int;
begin
  update public.notas_venda set excluido_em = null where id = p_id;
  update public.itens set nota_id = p_id
   where id = any (coalesce((select itens_vinculados from public.notas_venda where id = p_id), '{}')) and nota_id is null;
  get diagnostics v_n = row_count;
  update public.notas_venda set itens_vinculados = null where id = p_id;
  return v_n;
end $$;

create or replace function public.excluir_cobranca(p_id uuid) returns void
language plpgsql as $$
begin
  update public.cobrancas set excluido_em = now(),
         itens_vinculados = (select array_agg(id) from public.itens where cobranca_id = p_id)
   where id = p_id and excluido_em is null;
  update public.itens set cobranca_id = null where cobranca_id = p_id;
end $$;

create or replace function public.restaurar_cobranca(p_id uuid) returns int
language plpgsql as $$
declare v_n int;
begin
  update public.cobrancas set excluido_em = null where id = p_id;
  update public.itens set cobranca_id = p_id
   where id = any (coalesce((select itens_vinculados from public.cobrancas where id = p_id), '{}')) and cobranca_id is null;
  get diagnostics v_n = row_count;
  update public.cobrancas set itens_vinculados = null where id = p_id;
  return v_n;
end $$;

-- Juntar dois cadastros iguais escritos diferente ("bycar" e "By Car"): tudo passa para o destino.
create or replace function public.juntar_cadastro(p_tabela text, p_origem uuid, p_destino uuid) returns void
language plpgsql as $$
begin
  if p_origem = p_destino then raise exception 'Escolha dois cadastros diferentes.'; end if;
  if p_tabela = 'clientes' then
    update public.pedidos set cliente_id = p_destino where cliente_id = p_origem;
    update public.cobrancas set cliente_id = p_destino where cliente_id = p_origem;
    delete from public.clientes where id = p_origem;
  elsif p_tabela = 'oficinas' then
    update public.pedidos set oficina_id = p_destino where oficina_id = p_origem;
    delete from public.oficinas where id = p_origem;
  elsif p_tabela = 'fornecedores' then
    update public.itens set fornecedor_id = p_destino where fornecedor_id = p_origem;
    delete from public.fornecedores where id = p_origem;
  else
    raise exception 'Cadastro desconhecido.';
  end if;
end $$;

-- =====================================================================================
-- SEGURANÇA: só quem tem login no sistema vê e mexe nos dados
-- =====================================================================================
do $$ declare t text; begin
  foreach t in array array['clientes', 'oficinas', 'fornecedores', 'pedidos', 'itens', 'notas_venda', 'cobrancas', 'cobranca_parcelas', 'historico'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists autenticado on public.%I', t);
    execute format('create policy autenticado on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;

-- Parcelas com os dados da cobrança (para a lista "A receber").
drop view if exists public.v_parcelas;
create view public.v_parcelas with (security_invoker = true) as
select pp.*, c.cliente_id, c.forma, c.enviada_em, cl.nome as cliente_nome
  from public.cobranca_parcelas pp
  join public.cobrancas c on c.id = pp.cobranca_id
  join public.clientes cl on cl.id = c.cliente_id
 where c.excluido_em is null;
