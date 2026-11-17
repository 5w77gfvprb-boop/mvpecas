"use client";

import { Ban, Trash2 } from "lucide-react";
import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { msgErro, useApp } from "@/components/AppShell";
import { Combo } from "@/components/Combo";
import { Button, CampoValor, Field, Modal, Segmentado, inputCls } from "@/components/ui";
import { acharOuCriar, atualizarComDesfazer } from "@/lib/acoes";
import type { Item, NfFornecedor } from "@/lib/tipos";
import { brl, dataBR, hojeSP, lerValor, valorCampo } from "@/lib/util";

export type Passo = "comprado" | "enviado" | "entregue";
export const PASSOS: { id: Passo; label: string; campo: "comprado_em" | "enviado_em" | "entregue_em" }[] = [
  { id: "comprado", label: "Comprada", campo: "comprado_em" },
  { id: "enviado", label: "Enviada", campo: "enviado_em" },
  { id: "entregue", label: "Entregue", campo: "entregue_em" },
];
export const NF_FORN: { id: NfFornecedor; label: string }[] = [
  { id: "recebida", label: "Recebi a nota" },
  { id: "pendente", label: "Nota pendente" },
  { id: "sem_nota", label: "Sem nota" },
];

const juntar = (fs: (() => Promise<void>)[]) => async () => { for (const f of [...fs].reverse()) await f(); };

/** Marca peças como enviadas ou entregues (pula as que ainda não foram compradas). Devolve [quantas, desfazer]. */
export async function marcarPasso(sb: SupabaseClient, itens: Item[], passo: "enviado" | "entregue", data: string): Promise<[number, () => Promise<void>]> {
  const ativos = itens.filter((i) => !i.cancelado_em && i.comprado_em);
  if (passo === "enviado") {
    const ids = ativos.filter((i) => !i.enviado_em).map((i) => i.id);
    return [ids.length, await atualizarComDesfazer(sb, "itens", ids, { enviado_em: data })];
  }
  const jaEnviadas = ativos.filter((i) => !i.entregue_em && i.enviado_em).map((i) => i.id);
  const naoEnviadas = ativos.filter((i) => !i.entregue_em && !i.enviado_em).map((i) => i.id);
  const d1 = await atualizarComDesfazer(sb, "itens", jaEnviadas, { entregue_em: data });
  const d2 = await atualizarComDesfazer(sb, "itens", naoEnviadas, { enviado_em: data, entregue_em: data });
  return [jaEnviadas.length + naoEnviadas.length, juntar([d1, d2])];
}

/** Toque num passo já marcado: mudar a data ou desmarcar (desmarca também os passos seguintes). */
export function PassoModal({ item, passo, onClose }: { item: Item; passo: Passo; onClose: () => void }) {
  const { sb, notify, atualizar } = useApp();
  const info = PASSOS.find((p) => p.id === passo)!;
  const atual = item[info.campo];
  const [data, setData] = useState(atual ?? hojeSP());
  const [trabalhando, setTrabalhando] = useState(false);
  const seguintes = PASSOS.slice(PASSOS.findIndex((p) => p.id === passo)).filter((p) => item[p.campo]);

  async function salvarData() {
    setTrabalhando(true);
    try {
      const desf = await atualizarComDesfazer(sb, "itens", [item.id], { [info.campo]: data });
      notify(`Data mudada para ${dataBR(data)}.`, "ok", desf); atualizar(); onClose();
    } catch (e) { notify(msgErro(e), "erro"); } finally { setTrabalhando(false); }
  }
  async function desmarcar() {
    setTrabalhando(true);
    try {
      const patch = Object.fromEntries(seguintes.map((p) => [p.campo, null]));
      const desf = await atualizarComDesfazer(sb, "itens", [item.id], patch);
      notify(`${item.descricao}: desmarcada como ${seguintes.map((p) => p.label.toLowerCase()).join(", ")}.`, "ok", desf); atualizar(); onClose();
    } catch (e) { notify(msgErro(e), "erro"); } finally { setTrabalhando(false); }
  }

  return (
    <Modal titulo={`${info.label}: ${item.descricao}`} onClose={onClose} largura="max-w-sm">
      <div className="space-y-4">
        <Field label={`${info.label} em`}><input type="date" className={inputCls} value={data} onChange={(e) => setData(e.target.value)} /></Field>
        {seguintes.length > 1 ? <p className="text-xs text-neutral-500">Desmarcar “{info.label.toLowerCase()}” também desmarca {seguintes.slice(1).map((p) => p.label.toLowerCase()).join(" e ")}.</p> : null}
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="danger" disabled={trabalhando} onClick={desmarcar}>Desmarcar</Button>
          <Button variant="primary" disabled={trabalhando || !data || data === atual} onClick={salvarData}>Salvar data</Button>
        </div>
      </div>
    </Modal>
  );
}

/** "Comprei": fornecedor, data, nota do fornecedor e o custo / venda de cada peça. Serve para uma ou várias peças. */
export function CompraModal({ itens, onClose }: { itens: Item[]; onClose: () => void }) {
  const { sb, cad, notify, atualizar, recarregarCadastros } = useApp();
  const comum = itens.every((i) => i.fornecedor_id === itens[0]?.fornecedor_id) ? itens[0]?.fornecedor_id ?? null : null;
  const [fornecedor, setFornecedor] = useState<string | null>(comum);
  const [data, setData] = useState(itens.find((i) => i.comprado_em)?.comprado_em ?? hojeSP());
  const [nf, setNf] = useState<NfFornecedor>(() => {
    if (itens.length === 1 && itens[0].nf_fornecedor) return itens[0].nf_fornecedor;
    try { return (localStorage.getItem("ultima_nf_forn") as NfFornecedor) || "recebida"; } catch { return "recebida"; }
  });
  const [valores, setValores] = useState(() => Object.fromEntries(itens.map((i) => [i.id, { custo: valorCampo(i.custo), venda: valorCampo(i.venda) }])));
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function novoFornecedor(nome: string) {
    try { const id = await acharOuCriar(sb, "fornecedores", nome); await recarregarCadastros(); return id; } catch (e) { notify(msgErro(e), "erro"); return null; }
  }

  async function salvar() {
    setErro("");
    for (const i of itens) {
      const v = valores[i.id];
      if (v.custo.trim() && lerValor(v.custo) === null) { setErro(`Custo inválido em “${i.descricao}”.`); return; }
      if (v.venda.trim() && lerValor(v.venda) === null) { setErro(`Valor de venda inválido em “${i.descricao}”.`); return; }
    }
    setSalvando(true);
    try {
      // Em lote, não apaga o que cada peça já tinha (fornecedor, data e nota de peça já comprada).
      const varias = itens.length > 1;
      const desfazeres = await Promise.all(itens.map((i) => atualizarComDesfazer(sb, "itens", [i.id], {
        comprado_em: varias ? i.comprado_em ?? data : data,
        fornecedor_id: varias ? fornecedor ?? i.fornecedor_id : fornecedor,
        nf_fornecedor: varias ? i.nf_fornecedor ?? nf : nf,
        custo: lerValor(valores[i.id].custo), venda: lerValor(valores[i.id].venda),
      })));
      try { localStorage.setItem("ultima_nf_forn", nf); } catch { /* ignora */ }
      const semCusto = itens.filter((i) => !valores[i.id].custo.trim()).length;
      notify(`${itens.length} peça(s) marcada(s) como comprada(s).${semCusto ? ` ${semCusto} sem custo: dá para pôr depois.` : ""}`, "ok", juntar(desfazeres));
      atualizar(); onClose();
    } catch (e) { setErro(msgErro(e)); } finally { setSalvando(false); }
  }

  const totalCusto = itens.reduce((s, i) => s + (lerValor(valores[i.id].custo) ?? 0) * i.quantidade, 0);
  const totalVenda = itens.reduce((s, i) => s + (lerValor(valores[i.id].venda) ?? 0) * i.quantidade, 0);

  return (
    <Modal titulo={itens.length === 1 ? `Comprei: ${itens[0].descricao}` : `Comprei ${itens.length} peças`} onClose={onClose} largura="max-w-lg" fecharFora={false}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Field label="Fornecedor">
            <Combo opcoes={cad.fornecedores} valor={fornecedor} onChange={setFornecedor} onNovo={novoFornecedor} placeholder={itens.length > 1 && !comum && itens.some((i) => i.fornecedor_id) ? "Manter o de cada peça" : "Onde comprou?"} />
          </Field>
          <Field label="Data da compra"><input type="date" className={inputCls} value={data} onChange={(e) => setData(e.target.value || hojeSP())} /></Field>
        </div>
        <Field grupo label="Nota fiscal do fornecedor"><Segmentado valor={nf} opcoes={NF_FORN} onChange={setNf} /></Field>
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_6.5rem_6.5rem] gap-2 text-xs font-medium text-neutral-500"><span>Peça</span><span>Custo (un.)</span><span>Venda (un.)</span></div>
          {itens.map((i) => (
            <div key={i.id} className="grid grid-cols-[1fr_6.5rem_6.5rem] items-center gap-2">
              <span className="min-w-0 text-sm leading-tight">{i.quantidade > 1 ? <b>{i.quantidade}× </b> : null}{i.descricao}</span>
              <CampoValor value={valores[i.id].custo} onChange={(v) => setValores((x) => ({ ...x, [i.id]: { ...x[i.id], custo: v } }))} />
              <CampoValor value={valores[i.id].venda} onChange={(v) => setValores((x) => ({ ...x, [i.id]: { ...x[i.id], venda: v } }))} />
            </div>
          ))}
          <div className="flex justify-end gap-4 border-t border-neutral-100 pt-2 text-xs text-neutral-600">
            <span>Custo: <b className="tabular-nums">{brl(totalCusto)}</b></span>
            <span>Venda: <b className="tabular-nums">{brl(totalVenda)}</b></span>
            <span>Lucro: <b className={`tabular-nums ${totalVenda - totalCusto < 0 ? "text-red-700" : "text-emerald-700"}`}>{brl(totalVenda - totalCusto)}</b></span>
          </div>
        </div>
        {erro ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p> : null}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={salvando} onClick={salvar}>{salvando ? "Salvando…" : "Salvar compra"}</Button>
        </div>
      </div>
    </Modal>
  );
}

/** Editar tudo de uma peça: nome, quantidade, valores, datas, nota do fornecedor, cancelar, excluir. */
export function ItemModal({ item, onClose }: { item: Item; onClose: () => void }) {
  const { sb, cad, notify, atualizar, recarregarCadastros } = useApp();
  const [f, setF] = useState({
    descricao: item.descricao, quantidade: String(item.quantidade), fornecedor_id: item.fornecedor_id,
    custo: valorCampo(item.custo), venda: valorCampo(item.venda),
    comprado_em: item.comprado_em ?? "", enviado_em: item.enviado_em ?? "", entregue_em: item.entregue_em ?? "",
    nf_fornecedor: item.nf_fornecedor, observacoes: item.observacoes ?? "",
    cancelado: !!item.cancelado_em, motivo: item.motivo_cancelamento ?? "", sobra_resolvida: item.sobra_resolvida,
  });
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function novoFornecedor(nome: string) {
    try { const id = await acharOuCriar(sb, "fornecedores", nome); await recarregarCadastros(); return id; } catch (e) { notify(msgErro(e), "erro"); return null; }
  }

  async function salvar() {
    setErro("");
    const qtd = Number(f.quantidade);
    if (!f.descricao.trim()) { setErro("Escreva o nome da peça."); return; }
    if (!Number.isInteger(qtd) || qtd < 1) { setErro("Quantidade precisa ser 1 ou mais."); return; }
    if (f.custo.trim() && lerValor(f.custo) === null) { setErro("Custo inválido."); return; }
    if (f.venda.trim() && lerValor(f.venda) === null) { setErro("Valor de venda inválido."); return; }
    // datas: um passo marcado preenche os anteriores; um passo apagado apaga os seguintes
    const { entregue_em } = f;
    let { comprado_em, enviado_em } = f;
    if (entregue_em && !enviado_em) enviado_em = entregue_em;
    if (enviado_em && !comprado_em) comprado_em = enviado_em;
    const patch = {
      descricao: f.descricao.trim(), quantidade: qtd, fornecedor_id: f.fornecedor_id,
      custo: lerValor(f.custo), venda: lerValor(f.venda),
      comprado_em: comprado_em || null, enviado_em: enviado_em || null, entregue_em: entregue_em || null,
      nf_fornecedor: f.nf_fornecedor, observacoes: f.observacoes.trim() || null,
      cancelado_em: f.cancelado ? item.cancelado_em ?? hojeSP() : null,
      motivo_cancelamento: f.cancelado ? f.motivo.trim() || null : null,
      sobra_resolvida: f.cancelado ? f.sobra_resolvida : false,
    };
    setSalvando(true);
    try {
      const desf = await atualizarComDesfazer(sb, "itens", [item.id], patch);
      notify("Peça salva.", "ok", desf); atualizar(); onClose();
    } catch (e) { setErro(msgErro(e)); } finally { setSalvando(false); }
  }

  async function excluir() {
    setSalvando(true);
    try {
      const desf = await atualizarComDesfazer(sb, "itens", [item.id], { excluido_em: new Date().toISOString() });
      notify(`“${item.descricao}” foi para a lixeira.`, "ok", desf); atualizar(); onClose();
    } catch (e) { setErro(msgErro(e)); } finally { setSalvando(false); }
  }

  const datas: { k: "comprado_em" | "enviado_em" | "entregue_em"; label: string }[] = [
    { k: "comprado_em", label: "Comprada em" }, { k: "enviado_em", label: "Enviada em" }, { k: "entregue_em", label: "Entregue em" },
  ];

  return (
    <Modal titulo="Editar peça" onClose={onClose} largura="max-w-lg" fecharFora={false}>
      <div className="space-y-4">
        <div className="grid grid-cols-[1fr_5rem] gap-3">
          <Field label="Peça"><input className={inputCls} value={f.descricao} onChange={(e) => set("descricao", e.target.value)} /></Field>
          <Field label="Qtd."><input className={inputCls} inputMode="numeric" value={f.quantidade} onChange={(e) => set("quantidade", e.target.value.replace(/\D/g, ""))} /></Field>
        </div>
        <Field label="Fornecedor"><Combo opcoes={cad.fornecedores} valor={f.fornecedor_id} onChange={(v) => set("fornecedor_id", v)} onNovo={novoFornecedor} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Custo (por unidade)"><CampoValor value={f.custo} onChange={(v) => set("custo", v)} /></Field>
          <Field label="Venda (por unidade)"><CampoValor value={f.venda} onChange={(v) => set("venda", v)} /></Field>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {datas.map((d) => (
            <Field key={d.k} label={d.label}>
              <div className="flex">
                <input type="date" className={`${inputCls} !px-1.5 text-xs`} value={f[d.k]} onChange={(e) => {
                  const v = e.target.value;
                  setF((x) => {
                    const n = { ...x, [d.k]: v };
                    if (!v) { if (d.k === "comprado_em") { n.enviado_em = ""; n.entregue_em = ""; } if (d.k === "enviado_em") n.entregue_em = ""; }
                    return n;
                  });
                }} />
              </div>
            </Field>
          ))}
        </div>
        <p className="-mt-2 text-xs text-neutral-500">Apagar uma data desmarca o passo (e os seguintes).</p>
        <Field grupo label="Nota fiscal do fornecedor">
          <Segmentado valor={(f.nf_fornecedor ?? "") as NfFornecedor} opcoes={NF_FORN} onChange={(v) => set("nf_fornecedor", v)} />
        </Field>
        <Field label="Observações"><textarea className={`${inputCls} min-h-14`} value={f.observacoes} onChange={(e) => set("observacoes", e.target.value)} /></Field>

        <div className="space-y-2 rounded-lg border border-neutral-200 p-3">
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" className="h-4 w-4" checked={f.cancelado} onChange={(e) => set("cancelado", e.target.checked)} /> <Ban size={15} /> Peça cancelada (não vai mais para o cliente)</label>
          {f.cancelado ? (
            <>
              <input className={inputCls} placeholder="Motivo (ex.: cliente desistiu, oficina achou usada)" value={f.motivo} onChange={(e) => set("motivo", e.target.value)} />
              {f.comprado_em ? (
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={f.sobra_resolvida} onChange={(e) => set("sobra_resolvida", e.target.checked)} /> Já resolvi esta peça comprada (devolvi ao fornecedor ou guardei)</label>
              ) : null}
            </>
          ) : null}
        </div>

        {erro ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p> : null}
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="danger" disabled={salvando} onClick={excluir}><Trash2 size={15} /> Excluir</Button>
          <div className="flex gap-2">
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" disabled={salvando} onClick={salvar}>{salvando ? "Salvando…" : "Salvar"}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
