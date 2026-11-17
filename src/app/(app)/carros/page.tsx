"use client";

import { Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { msgErro, useApp } from "@/components/AppShell";
import { Badge, Button, Segmentado, Vazio, inputCls } from "@/components/ui";
import { ETAPAS, ETAPAS_FECHADAS, type PedidoResumo } from "@/lib/tipos";
import { brl, dataBR, limparPlaca, nomeCarro } from "@/lib/util";

type Filtro = "abertos" | "fechados" | "todos";

export default function Carros() {
  const { sb, cad, notify, versao, abrirCarro, novoPedido } = useApp();
  const [filtro, setFiltro] = useState<Filtro>("abertos");
  const [cliente, setCliente] = useState("");
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [limite, setLimite] = useState(100);
  const [lista, setLista] = useState<PedidoResumo[] | null>(null);

  useEffect(() => { const t = setTimeout(() => setTermo(busca.trim()), 300); return () => clearTimeout(t); }, [busca]);

  useEffect(() => {
    let vivo = true;
    (async () => {
      let q = sb.from("v_pedidos").select("*");
      if (filtro === "abertos") q = q.not("etapa", "in", `(${ETAPAS_FECHADAS.join(",")})`);
      if (filtro === "fechados") q = q.in("etapa", ETAPAS_FECHADAS);
      if (cliente) q = q.eq("cliente_id", cliente);
      if (termo) {
        const t = termo.replace(/[,()*%\\]/g, " ").trim();
        const placa = limparPlaca(t);
        const { data: porPeca } = await sb.from("itens").select("pedido_id").ilike("descricao", `%${t}%`).is("excluido_em", null).limit(300);
        const ids = [...new Set((porPeca ?? []).map((x: { pedido_id: string }) => x.pedido_id))].slice(0, 150);
        const conds = [`veiculo.ilike.*${t}*`, `oficina_nome.ilike.*${t}*`, `referencia.ilike.*${t}*`, `cliente_nome.ilike.*${t}*`, `observacoes.ilike.*${t}*`];
        if (placa.length >= 2) conds.push(`placa.ilike.*${placa}*`);
        if (ids.length) conds.push(`id.in.(${ids.join(",")})`);
        q = q.or(conds.join(","));
      }
      const { data, error } = await q.order("data_pedido", { ascending: filtro === "abertos" }).order("criado_em", { ascending: filtro === "abertos" }).limit(limite);
      if (!vivo) return;
      if (error) { notify(msgErro(error), "erro"); setLista([]); return; }
      setLista((data ?? []) as PedidoResumo[]);
    })();
    return () => { vivo = false; };
  }, [sb, notify, filtro, cliente, termo, limite, versao]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Carros</h1>
        <Button variant="primary" className="hidden md:inline-flex" onClick={() => novoPedido()}><Plus size={15} /> Novo pedido</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input className={`${inputCls} pl-9`} placeholder="Placa, carro, oficina, peça…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <Segmentado valor={filtro} onChange={(f) => { setFiltro(f); setLimite(100); }} opcoes={[{ id: "abertos", label: "Em aberto" }, { id: "fechados", label: "Concluídos" }, { id: "todos", label: "Todos" }]} />
        {cad.clientes.length > 1 ? (
          <select className={`${inputCls} !w-auto`} value={cliente} onChange={(e) => setCliente(e.target.value)} aria-label="Cliente">
            <option value="">Todos os clientes</option>
            {cad.clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        ) : null}
      </div>

      {lista === null ? <p className="py-6 text-center text-sm text-neutral-500">Carregando…</p> : lista.length === 0 ? (
        <Vazio>{termo ? "Nada encontrado." : filtro === "abertos" ? "Nenhum carro em aberto." : "Nenhum carro aqui."}</Vazio>
      ) : (
        <ul className="grid gap-2 lg:grid-cols-2">
          {lista.map((p) => {
            const e = ETAPAS[p.etapa];
            const pct = p.n_ativos ? Math.round((p.n_entregues / p.n_ativos) * 100) : 0;
            return (
              <li key={p.id}>
                <button onClick={() => abrirCarro(p.id)} className="block w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-left hover:border-neutral-400">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{nomeCarro(p)}</div>
                      <div className="truncate text-xs text-neutral-500">{p.cliente_nome}{p.oficina_nome ? ` · ${p.oficina_nome}` : ""} · {dataBR(p.data_pedido, true)}</div>
                    </div>
                    <Badge className={e.cor}>{e.label}</Badge>
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-xs text-neutral-600">
                    <span className="tabular-nums">{p.n_ativos} peça(s)</span>
                    <span className="tabular-nums">compradas {p.n_comprados}/{p.n_ativos}</span>
                    <span className="tabular-nums">entregues {p.n_entregues}/{p.n_ativos}</span>
                    <span className="ml-auto font-medium tabular-nums">{brl(p.total_venda)}</span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-neutral-100"><div className="h-full bg-emerald-600" style={{ width: `${pct}%` }} /></div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {lista && lista.length >= limite ? <div className="text-center"><Button onClick={() => setLimite((l) => l + 100)}>Mostrar mais</Button></div> : null}
    </div>
  );
}
