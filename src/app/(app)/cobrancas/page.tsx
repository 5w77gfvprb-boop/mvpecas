"use client";

import { FileText, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { msgErro, useApp } from "@/components/AppShell";
import { ExtratoCliente } from "@/components/Cobranca";
import { Badge, Button, Segmentado, Vazio, inputCls } from "@/components/ui";
import { nomeForma, type CobrancaResumo } from "@/lib/tipos";
import { brl, dataBR, hojeSP, relativo, somar } from "@/lib/util";

type Filtro = "abertas" | "pagas" | "todas";

export default function Cobrancas() {
  const { sb, cad, notify, versao, abrirCobranca, novaCobranca } = useApp();
  const [filtro, setFiltro] = useState<Filtro>("abertas");
  const [cliente, setCliente] = useState("");
  const [lista, setLista] = useState<CobrancaResumo[] | null>(null);
  const [limite, setLimite] = useState(100);
  const [extrato, setExtrato] = useState(false);

  useEffect(() => {
    let vivo = true;
    let q = sb.from("v_cobrancas").select("*");
    if (filtro === "abertas") q = q.eq("paga", false);
    if (filtro === "pagas") q = q.eq("paga", true);
    if (cliente) q = q.eq("cliente_id", cliente);
    q = filtro === "abertas" ? q.order("proximo_vencimento", { ascending: true, nullsFirst: true }) : q.order("criada_em", { ascending: false });
    q.order("criado_em", { ascending: false }).limit(limite).then(({ data, error }) => {
      if (!vivo) return;
      if (error) { notify(msgErro(error), "erro"); setLista([]); return; }
      setLista((data ?? []) as CobrancaResumo[]);
    });
    return () => { vivo = false; };
  }, [sb, notify, filtro, cliente, limite, versao]);

  const hoje = hojeSP();
  const aberto = somar(lista?.filter((c) => !c.paga) ?? [], (c) => c.total - c.recebido);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Cobranças</h1>
        <div className="flex gap-2">
          <Button onClick={() => setExtrato(true)}><FileText size={15} /> Extrato do cliente</Button>
          <Button variant="primary" onClick={() => novaCobranca(cliente ? { cliente_id: cliente } : {})}><Plus size={15} /> Nova</Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Segmentado valor={filtro} onChange={(f) => { setFiltro(f); setLimite(100); }} opcoes={[{ id: "abertas", label: "A receber" }, { id: "pagas", label: "Pagas" }, { id: "todas", label: "Todas" }]} />
        {cad.clientes.length > 1 ? (
          <select className={`${inputCls} !w-auto`} value={cliente} onChange={(e) => setCliente(e.target.value)} aria-label="Cliente">
            <option value="">Todos os clientes</option>
            {cad.clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        ) : null}
        {filtro === "abertas" && lista?.length ? <span className="ml-auto text-sm">Em aberto: <b className="tabular-nums">{brl(aberto)}</b></span> : null}
      </div>

      {lista === null ? <p className="py-6 text-center text-sm text-neutral-500">Carregando…</p> : lista.length === 0 ? (
        <Vazio>{filtro === "abertas" ? "Nenhuma cobrança em aberto." : "Nenhuma cobrança aqui."}</Vazio>
      ) : (
        <ul className="grid gap-2 lg:grid-cols-2">
          {lista.map((c) => {
            const vencida = !c.paga && c.proximo_vencimento && c.proximo_vencimento < hoje;
            return (
              <li key={c.id}>
                <button onClick={() => abrirCobranca(c.id)} className={`block w-full rounded-xl border bg-white px-3 py-2.5 text-left hover:border-neutral-400 ${vencida ? "border-red-200" : "border-neutral-200"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">{c.cliente_nome} · <span className="tabular-nums">{brl(c.total)}</span></div>
                      <div className="truncate text-xs text-neutral-500">{nomeForma(c.forma)}{c.n_parcelas > 1 ? ` ${c.n_parcelas}x` : ""} · {c.carros || "sem peças"}</div>
                    </div>
                    {c.paga ? <Badge className="bg-emerald-600 text-white">Paga</Badge> : !c.enviada_em ? <Badge className="bg-amber-100 text-amber-900">Não enviada</Badge> : <Badge className="bg-rose-100 text-rose-900">A receber</Badge>}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 text-xs">
                    {!c.paga && c.proximo_vencimento ? <span className={vencida ? "font-semibold text-red-700" : "text-neutral-600"}>Próx. venc. {dataBR(c.proximo_vencimento, true)} ({relativo(c.proximo_vencimento)})</span> : null}
                    {c.n_parcelas > 1 ? <span className="text-neutral-600">{c.n_pagas}/{c.n_parcelas} pagas</span> : null}
                    {c.paga && c.ultimo_pagamento ? <span className="text-neutral-600">Pago em {dataBR(c.ultimo_pagamento, true)}</span> : null}
                    {!c.paga && c.recebido > 0 ? <span className="text-neutral-600">Recebido {brl(c.recebido)}</span> : null}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {lista && lista.length >= limite ? <div className="text-center"><Button onClick={() => setLimite((l) => l + 100)}>Mostrar mais</Button></div> : null}
      {extrato ? <ExtratoCliente onClose={() => setExtrato(false)} /> : null}
    </div>
  );
}
