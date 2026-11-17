"use client";

import { Check, CheckSquare, Copy, MessageCircle, Plus, Printer, Square, Trash2, X } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { msgErro, useApp } from "@/components/AppShell";
import { AreaImpressao, CabecalhoMV } from "@/components/Impressao";
import { Badge, Button, CampoValor, ConfirmDialog, Field, Modal, Segmentado, inputCls } from "@/components/ui";
import { atualizarComDesfazer } from "@/lib/acoes";
import { textoCobranca } from "@/lib/textos";
import { FORMAS, nomeForma, rotuloEnvio, type CobrancaResumo, type Forma, type Item, type Parcela, type Pedido } from "@/lib/tipos";
import { brl, copiar, dataBR, dividir, hojeSP, lerValor, linkWhatsApp, nomeCarro, placaBR, relativo, somar, somarDias, totalVenda, valorCampo } from "@/lib/util";

export type PresetCobranca = { cliente_id?: string; itens?: string[] };
type PedidoMin = Pick<Pedido, "id" | "veiculo" | "placa" | "ano" | "referencia" | "cliente_id" | "data_pedido">;
type ItemComPedido = Item & { pedido: PedidoMin };
type LinhaParcela = { vencimento: string; valor: string; documento: string };

const SELECT_ITEM = "*, pedido:pedidos!inner(id,veiculo,placa,ano,referencia,cliente_id,data_pedido,excluido_em)";

/** Peças ainda não cobradas de um cliente. */
async function pecasSemCobranca(sb: ReturnType<typeof useApp>["sb"], clienteId: string) {
  const { data, error } = await sb.from("itens").select(SELECT_ITEM)
    .is("cobranca_id", null).is("excluido_em", null).is("cancelado_em", null)
    .eq("pedido.cliente_id", clienteId).is("pedido.excluido_em", null)
    .order("criado_em").order("ordem");
  if (error) throw error;
  return (data ?? []) as ItemComPedido[];
}

function agruparPorCarro(itens: ItemComPedido[]) {
  const m = new Map<string, { pedido: PedidoMin; itens: ItemComPedido[] }>();
  for (const i of itens) {
    const g = m.get(i.pedido.id) ?? { pedido: i.pedido, itens: [] };
    g.itens.push(i); m.set(i.pedido.id, g);
  }
  return [...m.values()].sort((a, b) => a.pedido.data_pedido.localeCompare(b.pedido.data_pedido));
}

const PRAZOS: { label: string; dias: number[] }[] = [
  { label: "À vista", dias: [0] }, { label: "30 dias", dias: [30] }, { label: "30/60", dias: [30, 60] }, { label: "30/60/90", dias: [30, 60, 90] },
];

/** Escolhe peças (de um ou vários carros do mesmo cliente) e monta a cobrança com as parcelas. */
export function NovaCobranca({ preset, onClose, onCriada }: { preset: PresetCobranca; onClose: () => void; onCriada: (id: string) => void }) {
  const { sb, cad, notify, atualizar } = useApp();
  const [clienteId, setClienteId] = useState(preset.cliente_id ?? cad.clientes.find((c) => c.ativo)?.id ?? "");
  const [pecas, setPecas] = useState<ItemComPedido[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [forma, setForma] = useState<Forma>(() => { try { return (localStorage.getItem("ultima_forma") as Forma) || "boleto"; } catch { return "boleto"; } });
  const [enviada, setEnviada] = useState(false);
  const [dataEnvio, setDataEnvio] = useState(hojeSP());
  const [obs, setObs] = useState("");
  const [parcelas, setParcelas] = useState<LinhaParcela[]>([]);
  const [prazo, setPrazo] = useState<number[]>([30]);
  const [ajusteManual, setAjusteManual] = useState(false);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!clienteId) return;
    let vivo = true;
    setPecas(null);
    pecasSemCobranca(sb, clienteId).then((lista) => {
      if (!vivo) return;
      setPecas(lista);
      const pre = preset.cliente_id === clienteId && preset.itens?.length ? new Set(preset.itens) : new Set(lista.filter((i) => i.entregue_em).map((i) => i.id));
      setSel(new Set(lista.filter((i) => pre.has(i.id)).map((i) => i.id)));
    }, (e) => { if (vivo) { setPecas([]); setErro(msgErro(e)); } });
    return () => { vivo = false; };
  }, [clienteId, sb, preset.cliente_id, preset.itens]);

  const grupos = useMemo(() => agruparPorCarro(pecas ?? []), [pecas]);
  const escolhidas = (pecas ?? []).filter((i) => sel.has(i.id));
  const total = somar(escolhidas, totalVenda);
  const semPreco = escolhidas.filter((i) => i.venda === null).length;

  // Parcelas montadas pelo prazo, enquanto ela não mexer à mão.
  useEffect(() => {
    if (ajusteManual) return;
    const valores = dividir(total, prazo.length);
    setParcelas(prazo.map((d, k) => ({ vencimento: somarDias(hojeSP(), d), valor: valorCampo(valores[k]), documento: "" })));
  }, [total, prazo, ajusteManual]);
  const somaParcelas = somar(parcelas, (p) => lerValor(p.valor));

  function alternar(ids: string[], ligar: boolean) {
    setSel((s) => { const n = new Set(s); for (const x of ids) { if (ligar) n.add(x); else n.delete(x); } return n; });
  }

  async function salvar() {
    setErro("");
    if (!clienteId) { setErro("Escolha o cliente."); return; }
    if (!parcelas.length) { setErro("Coloque pelo menos uma parcela."); return; }
    for (const [k, p] of parcelas.entries()) {
      if (!p.vencimento) { setErro(`Parcela ${k + 1}: falta o vencimento.`); return; }
      if (lerValor(p.valor) === null) { setErro(`Parcela ${k + 1}: valor inválido.`); return; }
    }
    if (!escolhidas.length && somaParcelas === 0) { setErro("Escolha as peças ou informe o valor."); return; }
    setSalvando(true);
    try {
      const { data: id, error } = await sb.rpc("criar_cobranca", {
        p_cliente: clienteId, p_forma: forma, p_enviada_em: enviada ? dataEnvio : null, p_obs: obs || null,
        p_itens: escolhidas.map((i) => i.id),
        p_parcelas: parcelas.map((p) => ({ vencimento: p.vencimento, valor: lerValor(p.valor), documento: p.documento })),
      });
      if (error) throw error;
      try { localStorage.setItem("ultima_forma", forma); } catch { /* ignora */ }
      notify("Cobrança criada.", "ok", async () => { const { error: e } = await sb.from("cobrancas").delete().eq("id", id); if (e) throw e; });
      atualizar(); onCriada(id as string);
    } catch (e) { setErro(msgErro(e)); } finally { setSalvando(false); }
  }

  return (
    <Modal titulo="Nova cobrança" onClose={onClose} largura="max-w-2xl" fecharFora={false}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Cliente">
            <select className={inputCls} value={clienteId} onChange={(e) => { setClienteId(e.target.value); setAjusteManual(false); }}>
              {cad.clientes.filter((c) => c.ativo || c.id === clienteId).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </Field>
          <Field grupo label="Forma"><Segmentado valor={forma} opcoes={FORMAS} onChange={setForma} /></Field>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs font-medium text-neutral-600">
            <span>Peças ainda não cobradas</span>
            {pecas?.length ? <button className="underline" onClick={() => alternar(pecas.map((i) => i.id), sel.size !== pecas.length)}>{sel.size === pecas.length ? "Desmarcar todas" : "Marcar todas"}</button> : null}
          </div>
          {pecas === null ? <p className="text-sm text-neutral-500">Carregando…</p> : grupos.length === 0 ? <p className="rounded-lg bg-neutral-50 px-3 py-3 text-sm text-neutral-500">Nenhuma peça sem cobrança para este cliente. Dá para criar a cobrança só com o valor.</p> : (
            <div className="max-h-[38dvh] space-y-2 overflow-auto">
              {grupos.map((g) => {
                const ids = g.itens.map((i) => i.id);
                const todas = ids.every((x) => sel.has(x));
                return (
                  <div key={g.pedido.id} className="rounded-lg border border-neutral-200">
                    <button className="flex w-full items-center gap-2 border-b border-neutral-100 bg-neutral-50 px-3 py-1.5 text-left text-sm font-medium" onClick={() => alternar(ids, !todas)}>
                      {todas ? <CheckSquare size={16} className="text-red-900" /> : <Square size={16} className="text-neutral-400" />}
                      <span className="min-w-0 flex-1 truncate">{nomeCarro(g.pedido)}</span>
                      <span className="text-xs text-neutral-500">{dataBR(g.pedido.data_pedido)}</span>
                    </button>
                    {g.itens.map((i) => (
                      <label key={i.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                        <input type="checkbox" className="h-4 w-4" checked={sel.has(i.id)} onChange={(e) => alternar([i.id], e.target.checked)} />
                        <span className="min-w-0 flex-1">{i.quantidade > 1 ? `${i.quantidade}× ` : ""}{i.descricao}{!i.entregue_em ? <span className="ml-1 text-xs text-amber-700">(não entregue)</span> : null}</span>
                        <span className="text-xs tabular-nums text-neutral-600">{i.venda === null ? <span className="text-amber-700">sem preço</span> : brl(totalVenda(i))}</span>
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex justify-between text-sm"><span>{escolhidas.length} peça(s)</span><b className="tabular-nums">{brl(total)}</b></div>
          {semPreco ? <p className="text-xs text-amber-800">{semPreco} peça(s) sem valor de venda não entram na soma. Ponha o preço na peça ou ajuste o valor da parcela.</p> : null}
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-neutral-600">Prazo:</span>
            {PRAZOS.map((p) => (
              <button key={p.label} onClick={() => { setPrazo(p.dias); setAjusteManual(false); }}
                className={`rounded-full border px-2.5 py-1 text-xs ${!ajusteManual && JSON.stringify(prazo) === JSON.stringify(p.dias) ? "border-red-900 bg-red-900 text-white" : "border-neutral-300"}`}>{p.label}</button>
            ))}
          </div>
          <EditorParcelas parcelas={parcelas} onChange={(p) => { setAjusteManual(true); setParcelas(p); }} forma={forma} />
          {Math.abs(somaParcelas - total) > 0.009 && escolhidas.length ? <p className="text-xs text-amber-800">Soma das parcelas ({brl(somaParcelas)}) diferente do total das peças ({brl(total)}). Se for desconto ou acréscimo, tudo bem.</p> : null}
        </div>

        <label className="flex flex-wrap items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={enviada} onChange={(e) => setEnviada(e.target.checked)} /> {rotuloEnvio(forma)}
          {enviada ? <input type="date" className={`${inputCls} !w-auto`} value={dataEnvio} onChange={(e) => setDataEnvio(e.target.value || hojeSP())} /> : null}
        </label>
        <Field label="Observação"><input className={inputCls} value={obs} onChange={(e) => setObs(e.target.value)} /></Field>

        {erro ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p> : null}
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={salvando || pecas === null} onClick={salvar}>{salvando ? "Salvando…" : "Criar cobrança"}</Button></div>
      </div>
    </Modal>
  );
}

function EditorParcelas({ parcelas, onChange, forma }: { parcelas: LinhaParcela[]; onChange: (p: LinhaParcela[]) => void; forma: Forma }) {
  const set = (k: number, campo: keyof LinhaParcela, v: string) => onChange(parcelas.map((p, j) => (j === k ? { ...p, [campo]: v } : p)));
  return (
    <div className="space-y-1.5">
      {parcelas.map((p, k) => (
        <div key={k} className="grid grid-cols-[1.25rem_minmax(0,1fr)_minmax(0,1fr)_1.75rem] items-center gap-1.5 sm:grid-cols-[1.25rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_1.75rem]">
          <span className="text-xs text-neutral-500">{k + 1})</span>
          <input type="date" aria-label={`Vencimento da parcela ${k + 1}`} className={`${inputCls} !px-1.5`} value={p.vencimento} onChange={(e) => set(k, "vencimento", e.target.value)} />
          <CampoValor value={p.valor} onChange={(v) => set(k, "valor", v)} />
          <input aria-label={`Documento da parcela ${k + 1}`} className={`${inputCls} order-last col-span-2 col-start-2 sm:order-none sm:col-span-1 sm:col-start-auto`} placeholder={forma === "cheque" ? "Nº do cheque (opcional)" : forma === "boleto" ? "Nº do boleto (opcional)" : "Documento (opcional)"} value={p.documento} onChange={(e) => set(k, "documento", e.target.value)} />
          <button aria-label="Tirar parcela" disabled={parcelas.length === 1} className="rounded p-1 text-neutral-400 hover:text-red-700 disabled:opacity-30" onClick={() => onChange(parcelas.filter((_, j) => j !== k))}><X size={15} /></button>
        </div>
      ))}
      <button className="flex items-center gap-1 text-xs font-medium text-red-900" onClick={() => {
        const ult = parcelas[parcelas.length - 1];
        onChange([...parcelas, { vencimento: ult ? somarDias(ult.vencimento, 30) : hojeSP(), valor: "", documento: "" }]);
      }}><Plus size={13} /> Parcela</button>
    </div>
  );
}

/** Uma cobrança: envio, parcelas (recebi), peças, texto para o cliente, imprimir, excluir. */
export function CobrancaModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { sb, notify, versao, atualizar, abrirCarro } = useApp();
  const [c, setC] = useState<CobrancaResumo | null | undefined>(undefined);
  const [parcelas, setParcelas] = useState<Parcela[]>([]);
  const [itens, setItens] = useState<ItemComPedido[]>([]);
  const [editParc, setEditParc] = useState<Parcela | "nova" | null>(null);
  const [addPecas, setAddPecas] = useState(false);
  const [excluir, setExcluir] = useState(false);
  const [editar, setEditar] = useState(false);

  const carregar = useCallback(async () => {
    const [a, b, d] = await Promise.all([
      sb.from("v_cobrancas").select("*").eq("id", id).maybeSingle(),
      sb.from("cobranca_parcelas").select("*").eq("cobranca_id", id).order("numero").order("vencimento"),
      sb.from("itens").select(SELECT_ITEM).eq("cobranca_id", id).is("excluido_em", null).order("ordem"),
    ]);
    const erro = a.error ?? b.error ?? d.error;
    if (erro) { notify(msgErro(erro), "erro"); return; }
    setC((a.data as CobrancaResumo) ?? null);
    setParcelas((b.data ?? []) as Parcela[]);
    setItens((d.data ?? []) as ItemComPedido[]);
  }, [id, sb, notify]);
  useEffect(() => { carregar(); }, [carregar, versao]);

  if (c === undefined) return <Modal titulo="Carregando…" onClose={onClose}><p className="py-6 text-center text-sm text-neutral-500">Carregando…</p></Modal>;
  if (c === null) return (
    <Modal titulo="Cobrança" onClose={onClose} largura="max-w-sm">
      <div className="space-y-3 text-sm">
        <p>Esta cobrança está na lixeira ou não existe mais.</p>
        <Button variant="primary" onClick={async () => {
          const { error } = await sb.rpc("restaurar_cobranca", { p_id: id });
          if (error) notify(msgErro(error), "erro"); else { notify("Cobrança de volta."); atualizar(); }
        }}>Tirar da lixeira</Button>
      </div>
    </Modal>
  );

  const ativos = itens.filter((i) => !i.cancelado_em);
  const grupos = agruparPorCarro(ativos);
  const hoje = hojeSP();
  const texto = () => textoCobranca(c, ativos.map((i) => ({ ...i, pedido: { ...i.pedido, cliente_nome: c.cliente_nome } })), parcelas);

  async function marcarPaga(p: Parcela, pago: string | null) {
    try {
      const desf = await atualizarComDesfazer(sb, "cobranca_parcelas", [p.id], { pago_em: pago });
      notify(pago ? `Parcela ${p.numero} recebida (${brl(p.valor)}).` : "Pagamento desmarcado.", "ok", desf); atualizar();
    } catch (e) { notify(msgErro(e), "erro"); }
  }
  async function tirarItem(i: ItemComPedido) {
    try {
      const desf = await atualizarComDesfazer(sb, "itens", [i.id], { cobranca_id: null });
      notify(`“${i.descricao}” saiu da cobrança. Confira o valor das parcelas.`, "ok", desf); atualizar();
    } catch (e) { notify(msgErro(e), "erro"); }
  }
  async function salvarEnvio(data: string | null) {
    try {
      const desf = await atualizarComDesfazer(sb, "cobrancas", [c!.id], { enviada_em: data });
      notify(data ? "Marcado." : "Desmarcado.", "ok", desf); atualizar();
    } catch (e) { notify(msgErro(e), "erro"); }
  }

  return (
    <Modal titulo={`${nomeForma(c.forma)} · ${c.cliente_nome}`} onClose={onClose} largura="max-w-2xl">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge className={c.paga ? "bg-emerald-600 text-white" : "bg-rose-100 text-rose-900"}>{c.paga ? "Paga" : `${brl(c.total - c.recebido)} a receber`}</Badge>
          <span className="text-neutral-500">Criada em {dataBR(c.criada_em, true)} · total {brl(c.total)}</span>
          <Button className="ml-auto !px-2.5 !py-1 text-xs" onClick={() => setEditar(true)}>Editar</Button>
        </div>
        {c.observacoes ? <p className="text-sm text-neutral-700">{c.observacoes}</p> : null}

        <label className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={!!c.enviada_em} onChange={(e) => salvarEnvio(e.target.checked ? hoje : null)} />
          <span className="flex-1">{rotuloEnvio(c.forma)}</span>
          {c.enviada_em ? <input type="date" className={`${inputCls} !w-auto !py-1`} value={c.enviada_em} onChange={(e) => e.target.value && salvarEnvio(e.target.value)} /> : null}
        </label>

        <section className="space-y-1.5">
          <h3 className="text-sm font-semibold">Parcelas</h3>
          <ul className="divide-y divide-neutral-100 rounded-xl border border-neutral-200">
            {parcelas.map((p) => {
              const vencida = !p.pago_em && p.vencimento < hoje;
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <button className="min-w-0 flex-1 text-left" onClick={() => setEditParc(p)}>
                    <span className="font-medium tabular-nums">{p.numero}) {brl(p.valor)}</span>
                    <span className={`ml-2 text-xs ${vencida ? "font-semibold text-red-700" : "text-neutral-500"}`}>venc. {dataBR(p.vencimento, true)}{!p.pago_em ? ` (${relativo(p.vencimento)})` : ""}</span>
                    {p.documento ? <span className="ml-2 text-xs text-neutral-500">· {p.documento}</span> : null}
                  </button>
                  {p.pago_em
                    ? <button onClick={() => setEditParc(p)}><Badge className="bg-emerald-600 text-white"><Check size={11} /> Pago {dataBR(p.pago_em)}</Badge></button>
                    : <Button variant="primary" className="!px-2.5 !py-1 text-xs" onClick={() => marcarPaga(p, hoje)}><Check size={14} /> Recebi</Button>}
                </li>
              );
            })}
          </ul>
          <button className="flex items-center gap-1 text-xs font-medium text-red-900" onClick={() => setEditParc("nova")}><Plus size={13} /> Parcela</button>
          {Math.abs(c.total - c.total_pecas) > 0.009 && ativos.length ? <p className="text-xs text-amber-800">As parcelas somam {brl(c.total)} e as peças {brl(c.total_pecas)}. Se não for desconto/acréscimo, ajuste uma parcela.</p> : null}
        </section>

        <section className="space-y-1.5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Peças ({ativos.length})</h3>
            <Button className="!px-2.5 !py-1 text-xs" onClick={() => setAddPecas(true)}><Plus size={13} /> Peças</Button>
          </div>
          {grupos.length === 0 ? <p className="text-sm text-neutral-500">Nenhuma peça ligada a esta cobrança.</p> : grupos.map((g) => (
            <div key={g.pedido.id} className="rounded-lg border border-neutral-200">
              <button onClick={() => abrirCarro(g.pedido.id)} className="flex w-full items-center justify-between border-b border-neutral-100 bg-neutral-50 px-3 py-1.5 text-left text-sm font-medium hover:underline">
                <span>{nomeCarro(g.pedido)}</span><span className="tabular-nums">{brl(somar(g.itens, totalVenda))}</span>
              </button>
              {g.itens.map((i) => (
                <div key={i.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <span className="min-w-0 flex-1">{i.quantidade > 1 ? `${i.quantidade}× ` : ""}{i.descricao}</span>
                  <span className="text-xs tabular-nums text-neutral-600">{i.venda === null ? "sem preço" : brl(totalVenda(i))}</span>
                  <button aria-label="Tirar da cobrança" className="rounded p-1 text-neutral-400 hover:text-red-700" onClick={() => tirarItem(i)}><X size={14} /></button>
                </div>
              ))}
            </div>
          ))}
        </section>

        <div className="flex flex-wrap gap-2">
          <Button onClick={async () => { const ok = await copiar(texto()); notify(ok ? "Texto copiado. Cole no WhatsApp do cliente." : "Não consegui copiar.", ok ? "ok" : "erro"); }}><Copy size={15} /> Copiar texto</Button>
          <a className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50" href={linkWhatsApp(texto())} target="_blank" rel="noreferrer"><MessageCircle size={15} /> WhatsApp</a>
          <Button onClick={() => window.print()}><Printer size={15} /> Imprimir / PDF</Button>
          <Button variant="danger" className="ml-auto" onClick={() => setExcluir(true)}><Trash2 size={15} /> Excluir</Button>
        </div>
      </div>

      <AreaImpressao>
        <CabecalhoMV titulo="Cobrança" sub={`Emitido em ${dataBR(hoje, true)}`} />
        <p style={{ fontSize: 14, marginBottom: 10 }}><b>Cliente:</b> {c.cliente_nome}</p>
        <table>
          <thead><tr><th>Carro</th><th>Peça</th><th className="num">Qtd.</th><th className="num">Valor</th></tr></thead>
          <tbody>
            {grupos.map((g) => g.itens.map((i, k) => (
              <tr key={i.id}><td>{k === 0 ? `${g.pedido.veiculo} ${placaBR(g.pedido.placa)}${g.pedido.referencia ? ` (ref. ${g.pedido.referencia})` : ""}` : ""}</td><td>{i.descricao}</td><td className="num">{i.quantidade}</td><td className="num">{brl(totalVenda(i))}</td></tr>
            )))}
          </tbody>
        </table>
        <p style={{ textAlign: "right", fontSize: 15, fontWeight: 700, marginTop: 8 }}>Total: {brl(c.total)}</p>
        <p style={{ marginTop: 12, fontWeight: 600 }}>{nomeForma(c.forma)}{parcelas.length > 1 ? ` em ${parcelas.length}x` : ""}</p>
        <table>
          <tbody>{parcelas.map((p) => <tr key={p.id}><td>{p.numero}ª</td><td>Venc. {dataBR(p.vencimento, true)}</td><td>{p.documento ?? ""}</td><td className="num">{brl(p.valor)}</td><td>{p.pago_em ? `pago ${dataBR(p.pago_em, true)}` : ""}</td></tr>)}</tbody>
        </table>
      </AreaImpressao>

      {editParc ? <ParcelaModal cobrancaId={c.id} parcela={editParc === "nova" ? null : editParc} proximoNumero={(parcelas.at(-1)?.numero ?? 0) + 1} sozinha={parcelas.length <= 1} onClose={() => setEditParc(null)} /> : null}
      {addPecas ? <AdicionarPecasCobranca c={c} onClose={() => setAddPecas(false)} /> : null}
      {editar ? <EditarCobranca c={c} onClose={() => setEditar(false)} /> : null}
      {excluir ? (
        <ConfirmDialog titulo="Excluir cobrança" perigo confirmar="Mandar para a lixeira"
          texto="A cobrança vai para a lixeira e as peças voltam para “não cobradas”. Dá para trazer de volta em Ajustes → Lixeira (as peças voltam junto)."
          onCancel={() => setExcluir(false)}
          onConfirm={async () => {
            const { error } = await sb.rpc("excluir_cobranca", { p_id: c.id });
            if (error) { notify(msgErro(error), "erro"); return; }
            notify("Cobrança na lixeira.", "ok", async () => { const { error: e } = await sb.rpc("restaurar_cobranca", { p_id: c.id }); if (e) throw e; });
            atualizar(); onClose();
          }} />
      ) : null}
    </Modal>
  );
}

function ParcelaModal({ cobrancaId, parcela, proximoNumero, sozinha, onClose }: { cobrancaId: string; parcela: Parcela | null; proximoNumero: number; sozinha: boolean; onClose: () => void }) {
  const { sb, notify, atualizar } = useApp();
  const [venc, setVenc] = useState(parcela?.vencimento ?? somarDias(hojeSP(), 30));
  const [valor, setValor] = useState(valorCampo(parcela?.valor));
  const [doc, setDoc] = useState(parcela?.documento ?? "");
  const [pago, setPago] = useState(parcela?.pago_em ?? "");
  const [erro, setErro] = useState("");
  async function salvar() {
    const v = lerValor(valor);
    if (!venc) { setErro("Falta o vencimento."); return; }
    if (v === null) { setErro("Valor inválido."); return; }
    try {
      if (parcela) {
        const desf = await atualizarComDesfazer(sb, "cobranca_parcelas", [parcela.id], { vencimento: venc, valor: v, documento: doc.trim() || null, pago_em: pago || null });
        notify("Parcela salva.", "ok", desf);
      } else {
        const { data, error } = await sb.from("cobranca_parcelas").insert({ cobranca_id: cobrancaId, numero: proximoNumero, vencimento: venc, valor: v, documento: doc.trim() || null, pago_em: pago || null }).select("id").single();
        if (error) throw error;
        notify("Parcela incluída.", "ok", async () => { await sb.from("cobranca_parcelas").delete().eq("id", data.id); });
      }
      atualizar(); onClose();
    } catch (e) { setErro(msgErro(e)); }
  }
  async function apagar() {
    if (!parcela) return;
    const { error } = await sb.from("cobranca_parcelas").delete().eq("id", parcela.id);
    if (error) { setErro(msgErro(error)); return; }
    const { id: _id, ...resto } = parcela; void _id;
    notify("Parcela apagada.", "ok", async () => { const { error: e } = await sb.from("cobranca_parcelas").insert({ ...resto, cobranca_id: cobrancaId }); if (e) throw e; });
    atualizar(); onClose();
  }
  return (
    <Modal titulo={parcela ? `Parcela ${parcela.numero}` : "Nova parcela"} onClose={onClose} largura="max-w-sm">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Vencimento"><input type="date" className={inputCls} value={venc} onChange={(e) => setVenc(e.target.value)} /></Field>
          <Field label="Valor"><CampoValor value={valor} onChange={setValor} /></Field>
        </div>
        <Field label="Nº do boleto / cheque"><input className={inputCls} value={doc} onChange={(e) => setDoc(e.target.value)} /></Field>
        <Field label="Recebido em" hint="Deixe vazio se ainda não recebeu.">
          <div className="flex gap-2">
            <input type="date" className={inputCls} value={pago} onChange={(e) => setPago(e.target.value)} />
            {pago ? <Button onClick={() => setPago("")}>Limpar</Button> : <Button onClick={() => setPago(hojeSP())}>Hoje</Button>}
          </div>
        </Field>
        {erro ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p> : null}
        <div className="flex flex-wrap justify-between gap-2">
          {parcela && !sozinha ? <Button variant="danger" onClick={apagar}><Trash2 size={15} /> Apagar</Button> : <span />}
          <div className="flex gap-2"><Button onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={salvar}>Salvar</Button></div>
        </div>
      </div>
    </Modal>
  );
}

function EditarCobranca({ c, onClose }: { c: CobrancaResumo; onClose: () => void }) {
  const { sb, notify, atualizar } = useApp();
  const [forma, setForma] = useState<Forma>(c.forma);
  const [criada, setCriada] = useState(c.criada_em);
  const [obs, setObs] = useState(c.observacoes ?? "");
  async function salvar() {
    try {
      const desf = await atualizarComDesfazer(sb, "cobrancas", [c.id], { forma, criada_em: criada || hojeSP(), observacoes: obs.trim() || null });
      notify("Cobrança salva.", "ok", desf); atualizar(); onClose();
    } catch (e) { notify(msgErro(e), "erro"); }
  }
  return (
    <Modal titulo="Editar cobrança" onClose={onClose} largura="max-w-md">
      <div className="space-y-3">
        <Field grupo label="Forma"><Segmentado valor={forma} opcoes={FORMAS} onChange={setForma} /></Field>
        <Field label="Criada em"><input type="date" className={inputCls} value={criada} onChange={(e) => setCriada(e.target.value)} /></Field>
        <Field label="Observação"><input className={inputCls} value={obs} onChange={(e) => setObs(e.target.value)} /></Field>
        <p className="text-xs text-neutral-500">O cliente não muda aqui: as peças são de um cliente só. Para trocar, exclua e crie outra.</p>
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={salvar}>Salvar</Button></div>
      </div>
    </Modal>
  );
}

function AdicionarPecasCobranca({ c, onClose }: { c: CobrancaResumo; onClose: () => void }) {
  const { sb, notify, atualizar } = useApp();
  const [pecas, setPecas] = useState<ItemComPedido[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  useEffect(() => { pecasSemCobranca(sb, c.cliente_id).then(setPecas, (e) => { notify(msgErro(e), "erro"); setPecas([]); }); }, [sb, c.cliente_id, notify]);
  const grupos = agruparPorCarro(pecas ?? []);
  async function salvar() {
    try {
      const desf = await atualizarComDesfazer(sb, "itens", [...sel], { cobranca_id: c.id });
      const soma = somar((pecas ?? []).filter((i) => sel.has(i.id)), totalVenda);
      notify(`${sel.size} peça(s) incluída(s) (${brl(soma)}). Ajuste o valor das parcelas se precisar.`, "ok", desf); atualizar(); onClose();
    } catch (e) { notify(msgErro(e), "erro"); }
  }
  return (
    <Modal titulo="Pôr peças nesta cobrança" onClose={onClose} largura="max-w-lg">
      <div className="space-y-3">
        {pecas === null ? <p className="text-sm text-neutral-500">Carregando…</p> : grupos.length === 0 ? <p className="text-sm text-neutral-500">Nenhuma peça sem cobrança para {c.cliente_nome}.</p> : grupos.map((g) => (
          <div key={g.pedido.id} className="rounded-lg border border-neutral-200">
            <div className="border-b border-neutral-100 bg-neutral-50 px-3 py-1.5 text-sm font-medium">{nomeCarro(g.pedido)}</div>
            {g.itens.map((i) => (
              <label key={i.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                <input type="checkbox" className="h-4 w-4" checked={sel.has(i.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(i.id)) n.delete(i.id); else n.add(i.id); return n; })} />
                <span className="min-w-0 flex-1">{i.descricao}</span><span className="text-xs tabular-nums">{brl(totalVenda(i))}</span>
              </label>
            ))}
          </div>
        ))}
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!sel.size} onClick={salvar}>Incluir</Button></div>
      </div>
    </Modal>
  );
}

/** Extrato do cliente: tudo o que ele deve (cobrado e ainda não cobrado), para imprimir ou mandar. */
export function ExtratoCliente({ onClose }: { onClose: () => void }) {
  const { sb, cad, notify } = useApp();
  const [clienteId, setClienteId] = useState(cad.clientes.find((c) => c.ativo)?.id ?? "");
  const [dados, setDados] = useState<{ abertas: CobrancaResumo[]; parcelas: Parcela[]; semCob: ItemComPedido[] } | null>(null);
  useEffect(() => {
    if (!clienteId) return;
    let vivo = true;
    setDados(null);
    (async () => {
      const { data: cobs, error } = await sb.from("v_cobrancas").select("*").eq("cliente_id", clienteId).eq("paga", false).order("criada_em");
      if (error) throw error;
      const abertas = (cobs ?? []) as CobrancaResumo[];
      const { data: parc } = abertas.length ? await sb.from("cobranca_parcelas").select("*").in("cobranca_id", abertas.map((x) => x.id)).is("pago_em", null).order("vencimento") : { data: [] };
      const semCob = (await pecasSemCobranca(sb, clienteId)).filter((i) => i.entregue_em);
      if (vivo) setDados({ abertas, parcelas: (parc ?? []) as Parcela[], semCob });
    })().catch((e) => notify(msgErro(e), "erro"));
    return () => { vivo = false; };
  }, [clienteId, sb, notify]);

  const nome = cad.clientes.find((c) => c.id === clienteId)?.nome ?? "";
  const hoje = hojeSP();
  const totalParc = somar(dados?.parcelas ?? [], (p) => p.valor);
  const totalSem = somar(dados?.semCob ?? [], totalVenda);
  const grupos = agruparPorCarro(dados?.semCob ?? []);
  const texto = () => [
    `*MV Peças — extrato ${nome}* (${dataBR(hoje, true)})`, "",
    ...(dados?.parcelas.length ? ["*Cobranças em aberto*", ...dados.parcelas.map((p) => { const cb = dados.abertas.find((x) => x.id === p.cobranca_id); return `• ${cb ? nomeForma(cb.forma) : ""} venc. ${dataBR(p.vencimento, true)} — ${brl(p.valor)}${p.documento ? ` (${p.documento})` : ""}${p.vencimento < hoje ? " ⚠ vencida" : ""}${cb?.carros ? ` — ${cb.carros}` : ""}`; }), ""] : []),
    ...(grupos.length ? ["*Peças entregues ainda não cobradas*", ...grupos.map((g) => `• ${nomeCarro(g.pedido)}: ${g.itens.map((i) => i.descricao).join(", ")} — ${brl(somar(g.itens, totalVenda))}`), ""] : []),
    `*Total em aberto: ${brl(totalParc + totalSem)}*`,
  ].join("\n");

  const conteudo = (papel = false) => (
    <div className={papel ? "" : "space-y-3 text-sm"}>
      {dados?.parcelas.length ? (
        <div>
          <h3 className={papel ? "" : "mb-1 text-sm font-semibold"} style={papel ? { fontWeight: 700, margin: "8px 0 4px" } : undefined}>Cobranças em aberto</h3>
          <table className={papel ? "" : "w-full text-xs"}>
            <thead><tr className="text-left text-neutral-500"><th>Vencimento</th><th>Forma</th><th>Carros</th><th className="num text-right">Valor</th></tr></thead>
            <tbody>{dados.parcelas.map((p) => { const cb = dados.abertas.find((x) => x.id === p.cobranca_id); return (
              <tr key={p.id} className="border-t border-neutral-100"><td className={p.vencimento < hoje ? "font-semibold text-red-700" : ""}>{dataBR(p.vencimento, true)}{p.vencimento < hoje ? " (vencida)" : ""}</td><td>{cb ? nomeForma(cb.forma) : ""}{p.documento ? ` ${p.documento}` : ""}</td><td>{cb?.carros}</td><td className="num text-right tabular-nums">{brl(p.valor)}</td></tr>
            ); })}</tbody>
          </table>
        </div>
      ) : null}
      {grupos.length ? (
        <div>
          <h3 className={papel ? "" : "mb-1 text-sm font-semibold"} style={papel ? { fontWeight: 700, margin: "12px 0 4px" } : undefined}>Peças entregues ainda não cobradas</h3>
          <table className={papel ? "" : "w-full text-xs"}>
            <tbody>{grupos.map((g) => <Fragment key={g.pedido.id}>{g.itens.map((i, k) => (
              <tr key={i.id} className="border-t border-neutral-100"><td>{k === 0 ? nomeCarro(g.pedido) : ""}</td><td>{i.quantidade > 1 ? `${i.quantidade}× ` : ""}{i.descricao}</td><td className="num text-right tabular-nums">{i.venda === null ? "a definir" : brl(totalVenda(i))}</td></tr>
            ))}</Fragment>)}</tbody>
          </table>
        </div>
      ) : null}
      <p className={papel ? "" : "text-right text-base font-semibold"} style={papel ? { textAlign: "right", fontSize: 15, fontWeight: 700, marginTop: 10 } : undefined}>Total em aberto: {brl(totalParc + totalSem)}</p>
    </div>
  );

  return (
    <Modal titulo="Extrato do cliente (a receber)" onClose={onClose} largura="max-w-2xl">
      <div className="space-y-3">
        <select className={inputCls} value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
          {cad.clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        {dados === null ? <p className="text-sm text-neutral-500">Carregando…</p> : dados.parcelas.length === 0 && grupos.length === 0 ? <p className="text-sm text-neutral-500">Nada em aberto para {nome}. 🎉</p> : conteudo()}
        <div className="flex flex-wrap gap-2">
          <Button disabled={!dados} onClick={async () => { const ok = await copiar(texto()); notify(ok ? "Extrato copiado." : "Não consegui copiar.", ok ? "ok" : "erro"); }}><Copy size={15} /> Copiar texto</Button>
          {dados ? <a className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50" href={linkWhatsApp(texto())} target="_blank" rel="noreferrer"><MessageCircle size={15} /> WhatsApp</a> : null}
          <Button disabled={!dados} onClick={() => window.print()}><Printer size={15} /> Imprimir / PDF</Button>
        </div>
      </div>
      {dados ? (
        <AreaImpressao>
          <CabecalhoMV titulo="A receber" sub={`Extrato de ${dataBR(hoje, true)}`} />
          <p style={{ fontSize: 14, marginBottom: 8 }}><b>Cliente:</b> {nome}</p>
          {conteudo(true)}
        </AreaImpressao>
      ) : null}
    </Modal>
  );
}
