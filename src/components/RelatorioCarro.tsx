"use client";

import { FileSpreadsheet, FileText, Share2, X } from "lucide-react";
import { useState } from "react";
import { msgErro, useApp } from "@/components/AppShell";
import { Button, CampoValor, Field, Modal, inputCls } from "@/components/ui";
import type { Item, PedidoResumo } from "@/lib/tipos";
import { baixarArquivo, brl, dataBR, hojeSP, lerValor, limparPlaca, placaBR, valorCampo } from "@/lib/util";

type Linha = { id: string; incluir: boolean; descricao: string; quantidade: number; venda: string };
type Dados = { data: string; placa: string; modelo: string; oficina: string; linhas: { descricao: string; quantidade: number; unit: number; total: number }[]; total: number };

const VINHO: [number, number, number] = [127, 29, 29];

function nomeArquivo(d: Dados, ext: string) {
  const base = [limparPlaca(d.placa) || d.modelo || "carro", d.data].filter(Boolean).join("_").replace(/[^\w\-]+/g, "_");
  return `relatorio_${base}.${ext}`;
}

async function gerarPDF(d: Dados): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const larg = doc.internal.pageSize.getWidth();
  doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(...VINHO);
  doc.text("MV Peças e Logística", 14, 18);
  doc.setFontSize(12); doc.text("Relatório de peças", larg - 14, 18, { align: "right" });
  doc.setDrawColor(...VINHO); doc.setLineWidth(0.8); doc.line(14, 22, larg - 14, 22);

  doc.setTextColor(30, 30, 30); doc.setFontSize(11);
  let y = 31;
  const campo = (rot: string, val: string) => {
    doc.setFont("helvetica", "bold"); doc.text(`${rot}:`, 14, y);
    doc.setFont("helvetica", "normal"); doc.text(val, 40, y);
    y += 6.5;
  };
  campo("Data", dataBR(d.data, true).replace(/\/(\d{2})$/, "/20$1"));
  if (d.placa) campo("Placa", d.placa);
  if (d.modelo) campo("Modelo", d.modelo);
  if (d.oficina) campo("Oficina", d.oficina);

  autoTable(doc, {
    startY: y + 2,
    head: [["Peça", { content: "Qtd.", styles: { halign: "center" } }, { content: "Valor un.", styles: { halign: "right" } }, { content: "Total", styles: { halign: "right" } }]],
    body: d.linhas.map((l) => [l.descricao, String(l.quantidade), brl(l.unit), brl(l.total)]),
    foot: [[{ content: "Valor total", colSpan: 3, styles: { halign: "right" } }, brl(d.total)]],
    theme: "grid",
    styles: { font: "helvetica", fontSize: 10, cellPadding: 2.2 },
    headStyles: { fillColor: VINHO, textColor: 255 },
    footStyles: { fillColor: [245, 245, 245], textColor: 20, fontStyle: "bold", fontSize: 11 },
    columnStyles: { 1: { halign: "center", cellWidth: 16 }, 2: { halign: "right", cellWidth: 32 }, 3: { halign: "right", cellWidth: 34 } },
  });
  return doc.output("blob");
}

async function gerarExcel(d: Dados): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Relatório");
  ws.columns = [{ width: 46 }, { width: 8 }, { width: 15 }, { width: 16 }];
  ws.addRow(["MV Peças e Logística — Relatório de peças"]).font = { bold: true, size: 14, color: { argb: "FF7F1D1D" } };
  ws.mergeCells("A1:D1");
  ws.addRow([]);
  const [a, m, dd] = d.data.split("-").map(Number);
  const info: [string, string | Date][] = [["Data", new Date(Date.UTC(a, m - 1, dd, 12))]];
  if (d.placa) info.push(["Placa", d.placa]);
  if (d.modelo) info.push(["Modelo", d.modelo]);
  if (d.oficina) info.push(["Oficina", d.oficina]);
  for (const [k, v] of info) {
    const r = ws.addRow([k, v]);
    r.getCell(1).font = { bold: true };
    ws.mergeCells(`B${r.number}:D${r.number}`);
    if (v instanceof Date) r.getCell(2).numFmt = "dd/mm/yyyy";
    r.getCell(2).alignment = { horizontal: "left" };
  }
  ws.addRow([]);
  const cab = ws.addRow(["Peça", "Qtd.", "Valor un.", "Total"]);
  cab.eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF7F1D1D" } }; });
  const ini = cab.number + 1;
  for (const l of d.linhas) {
    const r = ws.addRow([l.descricao, l.quantidade, l.unit, null]);
    r.getCell(4).value = { formula: `B${r.number}*C${r.number}`, result: l.total };
  }
  const fim = ws.lastRow!.number;
  const tot = ws.addRow(["Valor total", null, null, { formula: `SUM(D${ini}:D${fim})`, result: d.total }]);
  tot.font = { bold: true };
  ws.mergeCells(`A${tot.number}:C${tot.number}`);
  tot.getCell(1).alignment = { horizontal: "right" };
  for (let n = ini; n <= tot.number; n++) { ws.getCell(`C${n}`).numFmt = '"R$" #,##0.00'; ws.getCell(`D${n}`).numFmt = '"R$" #,##0.00'; ws.getCell(`B${n}`).alignment = { horizontal: "center" }; }
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/** Relatório de um carro para a contabilidade: tudo editável só no documento (não muda o carro). */
export function RelatorioCarro({ p, itens, onClose }: { p: PedidoResumo; itens: Item[]; onClose: () => void }) {
  const { notify } = useApp();
  const [data, setData] = useState(hojeSP());
  const [placa, setPlaca] = useState(placaBR(p.placa));
  const [modelo, setModelo] = useState(p.veiculo);
  const [oficina, setOficina] = useState(p.oficina_nome ?? "");
  const [linhas, setLinhas] = useState<Linha[]>(() => itens.filter((i) => !i.cancelado_em).map((i) => ({ id: i.id, incluir: true, descricao: i.descricao, quantidade: i.quantidade, venda: valorCampo(i.venda) })));
  const [gerando, setGerando] = useState<string | null>(null);
  const set = (id: string, patch: Partial<Linha>) => setLinhas((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const escolhidas = linhas.filter((l) => l.incluir);
  const semValor = escolhidas.filter((l) => lerValor(l.venda) === null);
  const total = escolhidas.reduce((s, l) => s + (lerValor(l.venda) ?? 0) * l.quantidade, 0);
  const podeShare = typeof navigator !== "undefined" && typeof navigator.canShare === "function";

  function montar(): Dados | null {
    if (!data) { notify("Escolha a data.", "erro"); return null; }
    if (!escolhidas.length) { notify("Marque pelo menos uma peça.", "erro"); return null; }
    if (semValor.length) { notify(`Falta o valor de venda em: ${semValor.map((l) => l.descricao).join(", ")}.`, "erro"); return null; }
    const ls = escolhidas.map((l) => { const unit = lerValor(l.venda)!; return { descricao: l.descricao.trim(), quantidade: l.quantidade, unit, total: Math.round(unit * l.quantidade * 100) / 100 }; });
    return { data, placa: placa.trim().toUpperCase(), modelo: modelo.trim(), oficina: oficina.trim(), linhas: ls, total: Math.round(ls.reduce((s, l) => s + l.total, 0) * 100) / 100 };
  }

  async function gerar(tipo: "pdf" | "xlsx", compartilhar = false) {
    const d = montar();
    if (!d) return;
    setGerando(tipo + (compartilhar ? "s" : ""));
    try {
      const blob = tipo === "pdf" ? await gerarPDF(d) : await gerarExcel(d);
      const nome = nomeArquivo(d, tipo);
      if (compartilhar) {
        const arq = new File([blob], nome, { type: blob.type });
        if (navigator.canShare?.({ files: [arq] })) {
          try { await navigator.share({ files: [arq], title: nome }); } catch { /* cancelou */ }
          return;
        }
      }
      baixarArquivo(blob, nome);
      notify(`${tipo === "pdf" ? "PDF" : "Excel"} gerado.`);
    } catch (e) { notify(msgErro(e), "erro"); } finally { setGerando(null); }
  }

  return (
    <Modal titulo="Relatório para a contabilidade" onClose={onClose} largura="max-w-xl" fecharFora={false}>
      <div className="space-y-4">
        <p className="text-xs text-neutral-500">Tudo aqui pode ser mudado só para este relatório; o cadastro do carro não muda.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Data"><input type="date" className={inputCls} value={data} onChange={(e) => setData(e.target.value)} /></Field>
          <Field label="Placa"><input className={`${inputCls} uppercase`} value={placa} onChange={(e) => setPlaca(e.target.value.toUpperCase())} /></Field>
          <Field label="Modelo"><input className={inputCls} value={modelo} onChange={(e) => setModelo(e.target.value)} /></Field>
          <Field label="Oficina (opcional)">
            <div className="relative">
              <input className={`${inputCls} pr-8`} value={oficina} placeholder="Sem oficina" onChange={(e) => setOficina(e.target.value)} />
              {oficina ? <button type="button" aria-label="Tirar a oficina" className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1.5 text-neutral-400 hover:text-red-700" onClick={() => setOficina("")}><X size={14} /></button> : null}
            </div>
          </Field>
        </div>

        <div className="space-y-1.5">
          <div className="grid grid-cols-[1.25rem_1fr_6.5rem] gap-2 text-xs font-medium text-neutral-500"><span /><span>Peça</span><span>Venda (un.)</span></div>
          {linhas.length === 0 ? <p className="text-sm text-neutral-500">Este carro não tem peças.</p> : linhas.map((l) => (
            <div key={l.id} className={`grid grid-cols-[1.25rem_1fr_6.5rem] items-center gap-2 ${l.incluir ? "" : "opacity-50"}`}>
              <input type="checkbox" aria-label={`Incluir ${l.descricao}`} className="h-4 w-4" checked={l.incluir} onChange={(e) => set(l.id, { incluir: e.target.checked })} />
              <div className="flex min-w-0 items-center gap-1">
                {l.quantidade > 1 ? <span className="shrink-0 text-xs font-semibold">{l.quantidade}×</span> : null}
                <input className={`${inputCls} !py-1.5`} value={l.descricao} onChange={(e) => set(l.id, { descricao: e.target.value })} />
              </div>
              <CampoValor value={l.venda} onChange={(v) => set(l.id, { venda: v })} />
            </div>
          ))}
          <div className="flex justify-between border-t border-neutral-100 pt-2 text-sm"><span>{escolhidas.length} peça(s)</span><b className="tabular-nums">Total {brl(total)}</b></div>
          {semValor.length ? <p className="text-xs text-amber-800">Falta valor de venda em {semValor.length} peça(s). Preencha ou desmarque.</p> : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={!!gerando} onClick={() => gerar("pdf")}><FileText size={15} /> {gerando === "pdf" ? "Gerando…" : "Baixar PDF"}</Button>
          <Button variant="primary" disabled={!!gerando} onClick={() => gerar("xlsx")}><FileSpreadsheet size={15} /> {gerando === "xlsx" ? "Gerando…" : "Baixar Excel"}</Button>
          {podeShare ? (
            <>
              <Button disabled={!!gerando} onClick={() => gerar("pdf", true)}><Share2 size={15} /> Enviar PDF</Button>
              <Button disabled={!!gerando} onClick={() => gerar("xlsx", true)}><Share2 size={15} /> Enviar Excel</Button>
            </>
          ) : null}
        </div>
        {podeShare ? <p className="text-xs text-neutral-500">“Enviar” abre a lista do celular para mandar direto no WhatsApp ou e-mail do contador.</p> : null}
      </div>
    </Modal>
  );
}
