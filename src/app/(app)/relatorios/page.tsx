"use client";

import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { msgErro, useApp } from "@/components/AppShell";
import { Button, Card, Segmentado } from "@/components/ui";
import type { Item, NotaVenda, ParcelaResumo, PedidoResumo } from "@/lib/tipos";
import { baixarArquivo, brl, dataBR, gerarCSV, hojeSP, MESES, placaBR, somar, totalCusto, totalVenda } from "@/lib/util";

type Modo = "mes" | "ano";

function intervalo(ano: number, mes: number, modo: Modo): [string, string] {
  if (modo === "ano") return [`${ano}-01-01`, `${ano}-12-31`];
  const fim = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  const mm = String(mes + 1).padStart(2, "0");
  return [`${ano}-${mm}-01`, `${ano}-${mm}-${fim}`];
}

export default function Relatorios() {
  const { sb, cad, notify, versao } = useApp();
  const hoje = hojeSP();
  const [ano, setAno] = useState(Number(hoje.slice(0, 4)));
  const [mes, setMes] = useState(Number(hoje.slice(5, 7)) - 1);
  const [modo, setModo] = useState<Modo>("mes");
  const [d, setD] = useState<{ pedidos: PedidoResumo[]; itens: Item[]; notas: NotaVenda[]; compras: Item[]; recebidas: ParcelaResumo[]; abertas: ParcelaResumo[] } | null>(null);
  const [de, ate] = intervalo(ano, mes, modo);

  useEffect(() => {
    let vivo = true;
    setD(null);
    (async () => {
      const [p, c, r, a] = await Promise.all([
        sb.from("v_pedidos").select("*").gte("data_pedido", de).lte("data_pedido", ate).order("data_pedido").limit(5000),
        sb.from("itens").select("*").gte("comprado_em", de).lte("comprado_em", ate).is("excluido_em", null).is("cancelado_em", null).limit(10000),
        sb.from("v_parcelas").select("*").gte("pago_em", de).lte("pago_em", ate).limit(5000),
        sb.from("v_parcelas").select("*").is("pago_em", null).limit(5000),
      ]);
      const erro = p.error ?? c.error ?? r.error ?? a.error;
      if (erro) throw erro;
      const pedidos = (p.data ?? []) as PedidoResumo[];
      const itens: Item[] = [];
      const notas: NotaVenda[] = [];
      for (let k = 0; k < pedidos.length; k += 80) {
        const ids = pedidos.slice(k, k + 80).map((x) => x.id);
        const [i, n] = await Promise.all([
          sb.from("itens").select("*").in("pedido_id", ids).is("excluido_em", null).order("ordem"),
          sb.from("notas_venda").select("*").in("pedido_id", ids).is("excluido_em", null),
        ]);
        if (i.error) throw i.error;
        itens.push(...((i.data ?? []) as Item[]));
        notas.push(...((n.data ?? []) as NotaVenda[]));
      }
      if (vivo) setD({ pedidos, itens, notas, compras: (c.data ?? []) as Item[], recebidas: (r.data ?? []) as ParcelaResumo[], abertas: (a.data ?? []) as ParcelaResumo[] });
    })().catch((e) => { if (vivo) { notify(msgErro(e), "erro"); } });
    return () => { vivo = false; };
  }, [sb, notify, de, ate, versao]);

  const r = useMemo(() => {
    if (!d) return null;
    const ativos = d.itens.filter((i) => !i.cancelado_em);
    const venda = somar(ativos, totalVenda), custo = somar(ativos, totalCusto);
    const porCliente = new Map<string, { nome: string; carros: number; venda: number; custo: number }>();
    for (const p of d.pedidos) {
      const g = porCliente.get(p.cliente_id) ?? { nome: p.cliente_nome, carros: 0, venda: 0, custo: 0 };
      g.carros += 1; g.venda += Number(p.total_venda); g.custo += Number(p.total_custo);
      porCliente.set(p.cliente_id, g);
    }
    const porForn = new Map<string, { nome: string; pecas: number; custo: number }>();
    for (const i of d.compras) {
      const k = i.fornecedor_id ?? "";
      const g = porForn.get(k) ?? { nome: cad.fornecedores.find((f) => f.id === i.fornecedor_id)?.nome ?? "Sem fornecedor", pecas: 0, custo: 0 };
      g.pecas += i.quantidade; g.custo += totalCusto(i);
      porForn.set(k, g);
    }
    const semCusto = ativos.filter((i) => i.comprado_em && i.custo === null).length;
    const semVenda = ativos.filter((i) => i.venda === null).length;
    return {
      venda, custo, lucro: venda - custo, margem: venda ? ((venda - custo) / venda) * 100 : 0, pecas: ativos.length, semCusto, semVenda,
      porCliente: [...porCliente.values()].sort((a, b) => b.venda - a.venda),
      porForn: [...porForn.values()].sort((a, b) => b.custo - a.custo),
      recebido: somar(d.recebidas, (p) => p.valor),
      aReceber: somar(d.abertas, (p) => p.valor),
      vencido: somar(d.abertas.filter((p) => p.vencimento < hoje), (p) => p.valor),
    };
  }, [d, cad.fornecedores, hoje]);

  function exportar() {
    if (!d) return;
    const ped = new Map(d.pedidos.map((p) => [p.id, p]));
    const nota = new Map(d.notas.map((n) => [n.id, n]));
    const nfF: Record<string, string> = { pendente: "PENDENTE", recebida: "OK", sem_nota: "SEM NOTA" };
    const linhas = d.itens.map((i) => {
      const p = ped.get(i.pedido_id)!;
      const n = i.nota_id ? nota.get(i.nota_id) : undefined;
      return [
        dataBR(p.data_pedido, true), p.cliente_nome, p.veiculo, placaBR(p.placa), p.ano, p.oficina_nome, p.referencia,
        i.descricao, i.quantidade, cad.fornecedores.find((f) => f.id === i.fornecedor_id)?.nome ?? "",
        i.custo, i.venda, i.custo === null ? null : totalCusto(i), i.venda === null ? null : totalVenda(i),
        i.venda !== null && i.custo !== null ? totalVenda(i) - totalCusto(i) : null,
        i.comprado_em ? dataBR(i.comprado_em, true) : "", i.enviado_em ? dataBR(i.enviado_em, true) : "", i.entregue_em ? dataBR(i.entregue_em, true) : "",
        i.nf_fornecedor ? nfF[i.nf_fornecedor] : "", n ? (n.numero ?? "no contador") : "", i.cobranca_id ? "sim" : "", i.cancelado_em ? `cancelada${i.motivo_cancelamento ? `: ${i.motivo_cancelamento}` : ""}` : "",
      ];
    });
    const cab = ["DATA", "CLIENTE", "VEÍCULO", "PLACA", "ANO", "OFICINA", "REFERÊNCIA", "PEÇA", "QTD", "FORNECEDOR", "CUSTO UN", "VENDA UN", "CUSTO TOTAL", "VENDA TOTAL", "LUCRO", "COMPRADA", "ENVIADA", "ENTREGUE", "NF FORNECEDOR", "NF VENDA", "COBRADA", "CANCELADA"];
    baixarArquivo(gerarCSV(cab, linhas), `pecas_${modo === "ano" ? ano : `${ano}-${String(mes + 1).padStart(2, "0")}`}.csv`);
  }

  function mover(n: number) {
    if (modo === "ano") { setAno((a) => a + n); return; }
    const m = mes + n;
    setAno((a) => a + Math.floor(m / 12));
    setMes(((m % 12) + 12) % 12);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Relatórios</h1>
        <Button onClick={exportar} disabled={!d}><Download size={15} /> Planilha (Excel)</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button className="!px-2" aria-label="Anterior" onClick={() => mover(-1)}><ChevronLeft size={16} /></Button>
        <span className="min-w-36 text-center text-sm font-medium capitalize">{modo === "ano" ? ano : `${MESES[mes]} ${ano}`}</span>
        <Button className="!px-2" aria-label="Próximo" onClick={() => mover(1)}><ChevronRight size={16} /></Button>
        <Segmentado valor={modo} onChange={setModo} opcoes={[{ id: "mes", label: "Mês" }, { id: "ano", label: "Ano" }]} />
      </div>
      <p className="text-xs text-neutral-500">Vendas, custo e lucro contam pela <b>data do pedido</b>. Compras por fornecedor contam pela data da compra. Recebido conta pela data do pagamento.</p>

      {!r ? <p className="py-6 text-center text-sm text-neutral-500">Carregando…</p> : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Num rotulo="Vendido" v={brl(r.venda)} />
            <Num rotulo="Custo" v={brl(r.custo)} />
            <Num rotulo="Lucro" v={brl(r.lucro)} sub={`margem ${r.margem.toFixed(0)}%`} cor={r.lucro < 0 ? "text-red-700" : "text-emerald-700"} />
            <Num rotulo="Carros / peças" v={`${d!.pedidos.length} / ${r.pecas}`} />
            <Num rotulo="Recebido no período" v={brl(r.recebido)} />
            <Num rotulo="A receber (hoje)" v={brl(r.aReceber)} />
            <Num rotulo="Vencido (hoje)" v={brl(r.vencido)} cor={r.vencido > 0 ? "text-red-700" : ""} />
          </div>
          {r.semCusto || r.semVenda ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">Atenção: {r.semVenda} peça(s) sem valor de venda e {r.semCusto} comprada(s) sem custo. O lucro fica incompleto até preencher.</p> : null}

          <div className="grid gap-3 lg:grid-cols-2">
            <Card className="overflow-hidden">
              <h2 className="border-b border-neutral-100 px-3 py-2 text-sm font-semibold">Por cliente</h2>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-neutral-500"><th className="px-3 py-1.5">Cliente</th><th className="px-2 text-right">Carros</th><th className="px-2 text-right">Vendido</th><th className="px-3 text-right">Lucro</th></tr></thead>
                <tbody>{r.porCliente.map((c) => <tr key={c.nome} className="border-t border-neutral-100"><td className="px-3 py-1.5">{c.nome}</td><td className="px-2 text-right tabular-nums">{c.carros}</td><td className="px-2 text-right tabular-nums">{brl(c.venda)}</td><td className="px-3 text-right tabular-nums">{brl(c.venda - c.custo)}</td></tr>)}</tbody>
              </table>
              {!r.porCliente.length ? <p className="px-3 py-3 text-sm text-neutral-500">Nenhum pedido no período.</p> : null}
            </Card>
            <Card className="overflow-hidden">
              <h2 className="border-b border-neutral-100 px-3 py-2 text-sm font-semibold">Compras por fornecedor</h2>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-neutral-500"><th className="px-3 py-1.5">Fornecedor</th><th className="px-2 text-right">Peças</th><th className="px-3 text-right">Total pago</th></tr></thead>
                <tbody>{r.porForn.map((f) => <tr key={f.nome} className="border-t border-neutral-100"><td className="px-3 py-1.5">{f.nome}</td><td className="px-2 text-right tabular-nums">{f.pecas}</td><td className="px-3 text-right tabular-nums">{brl(f.custo)}</td></tr>)}</tbody>
              </table>
              {!r.porForn.length ? <p className="px-3 py-3 text-sm text-neutral-500">Nenhuma compra no período.</p> : null}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Num({ rotulo, v, sub, cor = "" }: { rotulo: string; v: string; sub?: string; cor?: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2.5">
      <div className="text-xs text-neutral-500">{rotulo}</div>
      <div className={`text-base font-semibold tabular-nums ${cor}`}>{v}</div>
      {sub ? <div className="text-[11px] text-neutral-500">{sub}</div> : null}
    </div>
  );
}
