"use client";

import { RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { msgErro, useApp } from "@/components/AppShell";
import { Button, ConfirmDialog } from "@/components/ui";
import { brl, dataHora, nomeCarro } from "@/lib/util";

type Coisa = { tipo: "pedidos" | "itens" | "notas_venda" | "cobrancas"; id: string; quando: string; texto: string };

/** Tudo o que foi excluído fica aqui até ser excluído de vez. */
export function Lixeira() {
  const { sb, notify, versao, atualizar } = useApp();
  const [lista, setLista] = useState<Coisa[] | null>(null);
  const [apagar, setApagar] = useState<Coisa | null>(null);

  const carregar = useCallback(async () => {
    const [p, i, n, c] = await Promise.all([
      sb.from("pedidos").select("id,veiculo,placa,excluido_em,clientes(nome)").not("excluido_em", "is", null).order("excluido_em", { ascending: false }).limit(200),
      sb.from("itens").select("id,descricao,excluido_em,pedido:pedidos!inner(veiculo,placa,excluido_em)").not("excluido_em", "is", null).is("pedido.excluido_em", null).order("excluido_em", { ascending: false }).limit(300),
      sb.from("notas_venda").select("id,numero,enviada_em,excluido_em,pedido:pedidos!inner(veiculo,placa,excluido_em)").not("excluido_em", "is", null).is("pedido.excluido_em", null).limit(200),
      sb.from("cobrancas").select("id,forma,excluido_em,clientes(nome),cobranca_parcelas(valor)").not("excluido_em", "is", null).limit(200),
    ]);
    const erro = p.error ?? i.error ?? n.error ?? c.error;
    if (erro) { notify(msgErro(erro), "erro"); return; }
    type P = { veiculo: string; placa: string | null };
    const um = <T,>(x: T | T[] | null): T | null => (Array.isArray(x) ? x[0] ?? null : x);
    const todas: Coisa[] = [
      ...(p.data ?? []).map((x: { id: string; excluido_em: string; veiculo: string; placa: string | null; clientes: { nome: string } | { nome: string }[] | null }) => ({ tipo: "pedidos" as const, id: x.id, quando: x.excluido_em, texto: `Carro ${nomeCarro(x)} (${um(x.clientes)?.nome ?? ""}) com as peças` })),
      ...(i.data ?? []).map((x: { id: string; excluido_em: string; descricao: string; pedido: P | P[] }) => ({ tipo: "itens" as const, id: x.id, quando: x.excluido_em, texto: `Peça “${x.descricao}” de ${nomeCarro(um(x.pedido)!)}` })),
      ...(n.data ?? []).map((x: { id: string; excluido_em: string; numero: string | null; pedido: P | P[] }) => ({ tipo: "notas_venda" as const, id: x.id, quando: x.excluido_em, texto: `Nota de venda ${x.numero ?? "sem número"} de ${nomeCarro(um(x.pedido)!)}` })),
      ...(c.data ?? []).map((x: { id: string; excluido_em: string; forma: string; clientes: { nome: string } | { nome: string }[] | null; cobranca_parcelas: { valor: number }[] }) => ({ tipo: "cobrancas" as const, id: x.id, quando: x.excluido_em, texto: `Cobrança (${x.forma}) de ${um(x.clientes)?.nome ?? ""} — ${brl(x.cobranca_parcelas.reduce((s, y) => s + Number(y.valor), 0))}` })),
    ].sort((a, b) => b.quando.localeCompare(a.quando));
    setLista(todas);
  }, [sb, notify]);
  useEffect(() => { carregar(); }, [carregar, versao]);

  async function restaurar(c: Coisa) {
    const { error } = c.tipo === "notas_venda" ? await sb.rpc("restaurar_nota", { p_id: c.id })
      : c.tipo === "cobrancas" ? await sb.rpc("restaurar_cobranca", { p_id: c.id })
      : await sb.from(c.tipo).update({ excluido_em: null }).eq("id", c.id);
    if (error) { notify(msgErro(error), "erro"); return; }
    notify("De volta no lugar."); atualizar();
  }
  async function excluirDeVez(c: Coisa) {
    setApagar(null);
    const { error } = await sb.from(c.tipo).delete().eq("id", c.id);
    if (error) { notify(msgErro(error), "erro"); return; }
    notify("Excluído de vez."); atualizar();
  }

  return (
    <section id="lixeira" className="scroll-mt-4 rounded-xl border border-neutral-200 bg-white">
      <div className="border-b border-neutral-100 px-4 py-2.5">
        <h2 className="text-sm font-semibold">Lixeira</h2>
        <p className="text-xs text-neutral-500">O que você excluiu fica aqui. “Trazer de volta” põe tudo no lugar (uma cobrança volta com as peças dela).</p>
      </div>
      {lista === null ? <p className="p-4 text-sm text-neutral-500">Carregando…</p> : lista.length === 0 ? <p className="p-4 text-sm text-neutral-500">A lixeira está vazia.</p> : (
        <ul className="divide-y divide-neutral-100">
          {lista.map((c) => (
            <li key={`${c.tipo}-${c.id}`} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
              <div className="min-w-0 flex-1"><div>{c.texto}</div><div className="text-xs text-neutral-500">excluído em {dataHora(c.quando)}</div></div>
              <Button className="!px-2.5 !py-1 text-xs" onClick={() => restaurar(c)}><RotateCcw size={13} /> Trazer de volta</Button>
              <Button variant="ghost" className="!px-2 !py-1 text-xs text-red-700" aria-label="Excluir de vez" onClick={() => setApagar(c)}><Trash2 size={13} /></Button>
            </li>
          ))}
        </ul>
      )}
      {apagar ? <ConfirmDialog titulo="Excluir de vez" perigo confirmar="Excluir de vez" texto={<>“{apagar.texto}” vai ser apagado para sempre (só um backup traz de volta).</>} onCancel={() => setApagar(null)} onConfirm={() => excluirDeVez(apagar)} /> : null}
    </section>
  );
}
