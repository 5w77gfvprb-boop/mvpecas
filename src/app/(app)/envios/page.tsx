"use client";

import { Copy, FileSpreadsheet, FileText, MessageCircle, PackageCheck, Truck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { msgErro, useApp } from "@/components/AppShell";
import { marcarPasso } from "@/components/Pecas";
import { Badge, Button, Segmentado, Vazio, inputCls } from "@/components/ui";
import type { Item } from "@/lib/tipos";
import { baixarArquivo, copiar, dataBR, hojeSP, linkWhatsApp, placaBR, somarDias } from "@/lib/util";

type Periodo = "hoje" | "ontem" | "semana" | "mes" | "outro";
type Ped = {
  id: string; veiculo: string; placa: string | null; ano: string | null; referencia: string | null; observacoes: string | null; cliente_id: string; excluido_em: string | null;
  clientes: { nome: string } | null; oficinas: { id: string; nome: string; cidade: string | null; endereco: string | null; telefone: string | null } | null;
};
type ItemEnvio = Item & { pedido: Ped };
type Carro = { p: Ped; itens: ItemEnvio[]; faltam: number };
type Grupo = { chave: string; nome: string; cidade: string | null; endereco: string | null; telefone: string | null; carros: Carro[] };

function intervalo(per: Periodo, de: string, ate: string): [string, string] {
  const hoje = hojeSP();
  if (per === "hoje") return [hoje, hoje];
  if (per === "ontem") { const o = somarDias(hoje, -1); return [o, o]; }
  if (per === "semana") {
    const dow = new Date(`${hoje}T12:00:00Z`).getUTCDay();           // 0 = domingo
    return [somarDias(hoje, -((dow + 6) % 7)), hoje];                 // segunda-feira até hoje
  }
  if (per === "mes") return [`${hoje.slice(0, 8)}01`, hoje];
  return [de <= ate ? de : ate, de <= ate ? ate : de];
}
const tituloPeriodo = (a: string, b: string) => (a === b ? dataBR(a, true) : `${dataBR(a, true)} a ${dataBR(b, true)}`);
const qtd = (i: Item) => (i.quantidade > 1 ? ` (${i.quantidade})` : "");

export default function Envios() {
  const { sb, cad, notify, versao, atualizar, abrirCarro } = useApp();
  const [per, setPer] = useState<Periodo>("hoje");
  const [de, setDe] = useState(hojeSP());
  const [ate, setAte] = useState(hojeSP());
  const [cliente, setCliente] = useState("");
  const [soPendentes, setSoPendentes] = useState(false);
  const [itens, setItens] = useState<ItemEnvio[] | null>(null);
  const [faltam, setFaltam] = useState<Map<string, number>>(new Map());
  const [ini, fim] = intervalo(per, de, ate);

  const carregar = useCallback(async () => {
    try {
      const { data, error } = await sb.from("itens")
        .select("*, pedido:pedidos!inner(id,veiculo,placa,ano,referencia,observacoes,cliente_id,excluido_em,clientes(nome),oficinas(id,nome,cidade,endereco,telefone))")
        .gte("enviado_em", ini).lte("enviado_em", fim)
        .is("excluido_em", null).is("cancelado_em", null).is("pedido.excluido_em", null)
        .order("enviado_em").order("ordem").limit(3000);
      if (error) throw error;
      const lista = (data ?? []) as ItemEnvio[];
      const ids = [...new Set(lista.map((i) => i.pedido_id))];
      const m = new Map<string, number>();
      for (let k = 0; k < ids.length; k += 80) {
        const { data: pend, error: e2 } = await sb.from("itens").select("pedido_id").in("pedido_id", ids.slice(k, k + 80))
          .is("enviado_em", null).is("excluido_em", null).is("cancelado_em", null);
        if (e2) throw e2;
        for (const x of pend ?? []) m.set(x.pedido_id, (m.get(x.pedido_id) ?? 0) + 1);
      }
      setItens(lista); setFaltam(m);
    } catch (e) { notify(msgErro(e), "erro"); setItens([]); }
  }, [sb, notify, ini, fim]);
  useEffect(() => { setItens(null); carregar(); }, [carregar, versao]);

  const grupos = useMemo<Grupo[]>(() => {
    const lista = (itens ?? []).filter((i) => (!cliente || i.pedido.cliente_id === cliente) && (!soPendentes || !i.entregue_em));
    const porOf = new Map<string, Grupo>();
    for (const i of lista) {
      const o = i.pedido.oficinas;
      const k = o?.id ?? "";
      const g = porOf.get(k) ?? { chave: k, nome: o?.nome ?? "Sem oficina", cidade: o?.cidade ?? null, endereco: o?.endereco ?? null, telefone: o?.telefone ?? null, carros: [] };
      let c = g.carros.find((x) => x.p.id === i.pedido_id);
      if (!c) { c = { p: i.pedido, itens: [], faltam: faltam.get(i.pedido_id) ?? 0 }; g.carros.push(c); }
      c.itens.push(i);
      porOf.set(k, g);
    }
    return [...porOf.values()].sort((a, b) => (a.chave === "" ? 1 : b.chave === "" ? -1 : a.nome.localeCompare(b.nome, "pt-BR")));
  }, [itens, faltam, cliente, soPendentes]);

  const nCarros = grupos.reduce((s, g) => s + g.carros.length, 0);
  const nPecas = grupos.reduce((s, g) => s + g.carros.reduce((t, c) => t + c.itens.reduce((u, i) => u + i.quantidade, 0), 0), 0);
  const varios = ini !== fim;

  function texto() {
    const l: string[] = [`🚚 *ENTREGAS – ${tituloPeriodo(ini, fim)}*`];
    for (const g of grupos) {
      l.push("", `📍 *${g.nome}*${g.cidade ? ` – ${g.cidade}` : ""}`);
      if (g.endereco) l.push(`   ${g.endereco}`);
      if (g.telefone) l.push(`   ☎ ${g.telefone}`);
      for (const c of g.carros) {
        l.push(`  • ${[c.p.veiculo, c.p.ano].filter(Boolean).join(" ")}${c.p.placa ? ` – ${placaBR(c.p.placa)}` : ""} – Cliente: ${c.p.clientes?.nome ?? ""}`);
        for (const i of c.itens) l.push(`     - ${i.descricao}${qtd(i)}${varios ? ` (enviada ${dataBR(i.enviado_em)})` : ""}`);
        if (c.faltam) l.push(`     ⚠ Ainda faltam ${c.faltam} peça(s) deste carro`);
      }
    }
    l.push("", `Total: ${grupos.length} oficina(s), ${nCarros} carro(s), ${nPecas} peça(s)`);
    return l.join("\n");
  }
  const nomeArq = (ext: string) => `envios_${ini}${varios ? `_a_${fim}` : ""}.${ext}`;

  async function pdf() {
    try {
      const { jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      const larg = doc.internal.pageSize.getWidth();
      doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(127, 29, 29);
      doc.text("MV Peças e Logística", 14, 18);
      doc.setFontSize(12); doc.text(`Entregas – ${tituloPeriodo(ini, fim)}`, larg - 14, 18, { align: "right" });
      doc.setDrawColor(127, 29, 29); doc.setLineWidth(0.8); doc.line(14, 22, larg - 14, 22);
      const corpo: (string | { content: string; colSpan?: number; styles?: Record<string, unknown> })[][] = [];
      for (const g of grupos) {
        const sub = [g.cidade, g.endereco, g.telefone].filter(Boolean).join(" · ");
        corpo.push([{ content: `${g.nome}${sub ? `  —  ${sub}` : ""}`, colSpan: 5, styles: { fillColor: [245, 230, 230], fontStyle: "bold", textColor: [127, 29, 29] } }]);
        for (const c of g.carros) {
          c.itens.forEach((i, k) => corpo.push([
            k === 0 ? [c.p.veiculo, c.p.ano].filter(Boolean).join(" ") : "", k === 0 ? placaBR(c.p.placa) : "", k === 0 ? c.p.clientes?.nome ?? "" : "",
            i.descricao, String(i.quantidade),
          ]));
          if (c.faltam) corpo.push([{ content: `Atenção: ainda faltam ${c.faltam} peça(s) deste carro`, colSpan: 5, styles: { textColor: [180, 83, 9], fontStyle: "italic" } }]);
        }
      }
      autoTable(doc, {
        startY: 28, head: [["Carro", "Placa", "Cliente", "Peça", "Qtd."]], body: corpo, theme: "grid",
        styles: { font: "helvetica", fontSize: 9.5, cellPadding: 2 }, headStyles: { fillColor: [127, 29, 29], textColor: 255 },
        columnStyles: { 1: { cellWidth: 24 }, 4: { halign: "center", cellWidth: 14 } },
      });
      const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
      doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(30, 30, 30);
      doc.text(`Total: ${grupos.length} oficina(s), ${nCarros} carro(s), ${nPecas} peça(s)`, 14, y);
      await entregar(doc.output("blob"), nomeArq("pdf"));
    } catch (e) { notify(msgErro(e), "erro"); }
  }

  async function excel() {
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Entregas");
      ws.columns = [{ header: "Enviada em", width: 12 }, { header: "Oficina", width: 22 }, { header: "Cidade", width: 14 }, { header: "Endereço", width: 30 }, { header: "Carro", width: 18 }, { header: "Placa", width: 11 }, { header: "Cliente", width: 16 }, { header: "Peça", width: 34 }, { header: "Qtd.", width: 6 }, { header: "Entregue", width: 10 }];
      ws.getRow(1).eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF7F1D1D" } }; });
      for (const g of grupos) for (const c of g.carros) for (const i of c.itens) {
        const [a, m, d] = i.enviado_em!.split("-").map(Number);
        const r = ws.addRow([new Date(Date.UTC(a, m - 1, d, 12)), g.nome, g.cidade ?? "", g.endereco ?? "", [c.p.veiculo, c.p.ano].filter(Boolean).join(" "), placaBR(c.p.placa), c.p.clientes?.nome ?? "", i.descricao, i.quantidade, i.entregue_em ? "sim" : ""]);
        r.getCell(1).numFmt = "dd/mm/yyyy";
      }
      ws.autoFilter = { from: "A1", to: "J1" };
      const buf = await wb.xlsx.writeBuffer();
      await entregar(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), nomeArq("xlsx"));
    } catch (e) { notify(msgErro(e), "erro"); }
  }

  /** No celular abre o "compartilhar" (WhatsApp etc.); no computador baixa o arquivo. */
  async function entregar(blob: Blob, nome: string) {
    const arq = new File([blob], nome, { type: blob.type });
    const celular = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
    if (celular && navigator.canShare?.({ files: [arq] })) {
      try { await navigator.share({ files: [arq], title: nome }); } catch { /* cancelou */ }
      return;
    }
    baixarArquivo(blob, nome);
  }

  async function entregueCarro(c: Carro) {
    try {
      const [n, desf] = await marcarPasso(sb, c.itens, "entregue", hojeSP());
      notify(n ? `${n} peça(s) de ${c.p.veiculo} marcada(s) como entregue(s).` : "Já estava tudo entregue.", "ok", n ? desf : undefined);
      atualizar();
    } catch (e) { notify(msgErro(e), "erro"); }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-lg font-semibold"><Truck size={18} className="text-red-900" /> Envios</h1>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Segmentado valor={per} onChange={setPer} opcoes={[{ id: "hoje", label: "Hoje" }, { id: "ontem", label: "Ontem" }, { id: "semana", label: "Semana" }, { id: "mes", label: "Mês" }, { id: "outro", label: "Período" }]} />
        {per === "outro" ? (
          <span className="flex items-center gap-1.5 text-sm">
            <input type="date" aria-label="De" className={`${inputCls} !w-auto`} value={de} onChange={(e) => setDe(e.target.value || hojeSP())} />
            até
            <input type="date" aria-label="Até" className={`${inputCls} !w-auto`} value={ate} onChange={(e) => setAte(e.target.value || hojeSP())} />
          </span>
        ) : null}
        {cad.clientes.length > 1 ? (
          <select className={`${inputCls} !w-auto`} value={cliente} onChange={(e) => setCliente(e.target.value)} aria-label="Cliente">
            <option value="">Todos os clientes</option>
            {cad.clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        ) : null}
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" className="h-4 w-4" checked={soPendentes} onChange={(e) => setSoPendentes(e.target.checked)} /> Só as ainda não entregues</label>
      </div>
      <p className="text-xs text-neutral-500">Peças marcadas como <b>enviadas</b> em {tituloPeriodo(ini, fim)}{per === "semana" ? " (de segunda até hoje)" : ""}. Marcou com a data errada? Abra o carro e toque em “Enviada” para mudar a data.</p>

      {itens === null ? <p className="py-6 text-center text-sm text-neutral-500">Carregando…</p> : grupos.length === 0 ? (
        <Vazio>Nenhuma peça enviada neste período.</Vazio>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-white p-3">
            <span className="mr-auto text-sm"><b>{grupos.length}</b> oficina(s) · <b>{nCarros}</b> carro(s) · <b>{nPecas}</b> peça(s)</span>
            <a className="inline-flex items-center gap-1.5 rounded-lg border border-red-900 bg-red-900 px-3 py-2 text-sm font-medium text-white hover:bg-red-800" href={linkWhatsApp(texto())} target="_blank" rel="noreferrer"><MessageCircle size={15} /> WhatsApp</a>
            <Button onClick={async () => { const ok = await copiar(texto()); notify(ok ? "Texto copiado. Cole no WhatsApp do entregador." : "Não consegui copiar.", ok ? "ok" : "erro"); }}><Copy size={15} /> Copiar</Button>
            <Button onClick={pdf}><FileText size={15} /> PDF</Button>
            <Button onClick={excel}><FileSpreadsheet size={15} /> Excel</Button>
          </div>

          {grupos.map((g) => (
            <section key={g.chave || "sem"} className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
              <div className="border-b border-neutral-100 bg-neutral-50 px-3 py-2">
                <div className="text-sm font-semibold">📍 {g.nome}{g.cidade ? <span className="font-normal text-neutral-500"> · {g.cidade}</span> : null}</div>
                {g.endereco || g.telefone ? <div className="text-xs text-neutral-500">{[g.endereco, g.telefone].filter(Boolean).join(" · ")}</div> : g.chave ? <div className="text-xs text-neutral-400">Sem endereço: dá para pôr em Cadastros → Oficinas.</div> : null}
              </div>
              <ul className="divide-y divide-neutral-100">
                {g.carros.map((c) => {
                  const tudoEntregue = c.itens.every((i) => i.entregue_em);
                  return (
                    <li key={c.p.id} className="space-y-1 px-3 py-2.5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <button className="min-w-0 text-left" onClick={() => abrirCarro(c.p.id)}>
                          <span className="text-sm font-medium hover:underline">{[c.p.veiculo, c.p.ano].filter(Boolean).join(" ")}{c.p.placa ? ` · ${placaBR(c.p.placa)}` : ""}</span>
                          <span className="block text-xs text-neutral-500">Cliente: {c.p.clientes?.nome}</span>
                        </button>
                        {tudoEntregue ? <Badge className="bg-emerald-600 text-white">Entregue</Badge>
                          : <Button className="!px-2.5 !py-1 text-xs" onClick={() => entregueCarro(c)}><PackageCheck size={14} /> Entregue</Button>}
                      </div>
                      <ul className="space-y-0.5 pl-1 text-sm text-neutral-700">
                        {c.itens.map((i) => (
                          <li key={i.id} className="flex justify-between gap-2">
                            <span className={i.entregue_em ? "text-neutral-400" : ""}>• {i.descricao}{qtd(i)}</span>
                            {varios ? <span className="shrink-0 text-xs text-neutral-500">enviada {dataBR(i.enviado_em)}</span> : null}
                          </li>
                        ))}
                      </ul>
                      {c.faltam ? <p className="text-xs font-medium text-amber-700">⚠ Ainda faltam {c.faltam} peça(s) deste carro</p> : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
