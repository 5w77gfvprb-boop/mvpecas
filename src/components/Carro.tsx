"use client";

import { Ban, Check, CheckSquare, Copy, FileText, History, MessageCircle, MoreHorizontal, Pencil, Plus, Receipt, RotateCcw, ShoppingCart, Square, Trash2, Truck, PackageCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { msgErro, useApp } from "@/components/AppShell";
import { Combo } from "@/components/Combo";
import { EditorPecas } from "@/components/NovoPedido";
import { CompraModal, ItemModal, marcarPasso, PASSOS, PassoModal, type Passo } from "@/components/Pecas";
import { RelatorioCarro } from "@/components/RelatorioCarro";
import { Badge, Button, ConfirmDialog, Field, Modal, inputCls } from "@/components/ui";
import { acharOuCriar, atualizarComDesfazer } from "@/lib/acoes";
import { textoContador } from "@/lib/textos";
import { ETAPAS, nomeForma, type CobrancaResumo, type Item, type NotaVenda, type PedidoResumo } from "@/lib/tipos";
import { brl, copiar, dataBR, dataHora, hojeSP, limparPlaca, linkWhatsApp, nomeCarro, placaBR, placaValida, somar, totalCusto, totalVenda, type LinhaPeca } from "@/lib/util";

type Sub =
  | null
  | { t: "compra"; itens: Item[] }
  | { t: "passo"; item: Item; passo: Passo }
  | { t: "item"; item: Item }
  | { t: "pedido" }
  | { t: "nota"; nota?: NotaVenda; emitir?: boolean }
  | { t: "adicionar" }
  | { t: "historico" }
  | { t: "excluir" }
  | { t: "relatorio" };

export default function CarroModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { sb, notify, versao, atualizar, novaCobranca, abrirCobranca } = useApp();
  const [p, setP] = useState<PedidoResumo | null | undefined>(undefined);
  const [itens, setItens] = useState<Item[]>([]);
  const [notas, setNotas] = useState<NotaVenda[]>([]);
  const [cobs, setCobs] = useState<CobrancaResumo[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [sub, setSub] = useState<Sub>(null);
  const [menu, setMenu] = useState(false);
  const [lixeira, setLixeira] = useState(false);

  const carregar = useCallback(async () => {
    const [a, b, c] = await Promise.all([
      sb.from("v_pedidos").select("*").eq("id", id).maybeSingle(),
      sb.from("itens").select("*").eq("pedido_id", id).is("excluido_em", null).order("ordem").order("criado_em"),
      sb.from("notas_venda").select("*").eq("pedido_id", id).is("excluido_em", null).order("enviada_em"),
    ]);
    const erro = a.error ?? b.error ?? c.error;
    if (erro) { notify(msgErro(erro), "erro"); return; }
    if (!a.data) {
      const { data: x } = await sb.from("pedidos").select("excluido_em").eq("id", id).maybeSingle();
      setLixeira(!!x?.excluido_em);
      setP(null); return;
    }
    const lista = (b.data ?? []) as Item[];
    setP(a.data as PedidoResumo);
    setItens(lista);
    setNotas((c.data ?? []) as NotaVenda[]);
    const idsCob = [...new Set(lista.map((i) => i.cobranca_id).filter(Boolean))] as string[];
    if (idsCob.length) {
      const { data } = await sb.from("v_cobrancas").select("*").in("id", idsCob);
      setCobs((data ?? []) as CobrancaResumo[]);
    } else setCobs([]);
    setSel((s) => new Set([...s].filter((x) => lista.some((i) => i.id === x))));
  }, [id, sb, notify]);
  useEffect(() => { carregar(); }, [carregar, versao]);

  const ativos = useMemo(() => itens.filter((i) => !i.cancelado_em), [itens]);
  const selecionados = itens.filter((i) => sel.has(i.id));
  const notaDe = (i: Item) => notas.find((n) => n.id === i.nota_id);
  const cobDe = (i: Item) => cobs.find((c) => c.id === i.cobranca_id);

  async function passoEmLote(lista: Item[], passo: "enviado" | "entregue") {
    try {
      const [n, desf] = await marcarPasso(sb, lista, passo, hojeSP());
      const pulou = lista.filter((i) => !i.cancelado_em && !i.comprado_em).length;
      if (n === 0) notify(pulou ? "Marque primeiro como comprada." : "Nada para marcar: já estava marcado.", pulou ? "erro" : "ok");
      else notify(`${n} peça(s) ${passo === "enviado" ? "enviada(s)" : "entregue(s)"} hoje.${pulou ? ` ${pulou} ainda não comprada(s) ficou(aram) de fora.` : ""}`, "ok", desf);
      setSel(new Set()); atualizar();
    } catch (e) { notify(msgErro(e), "erro"); }
  }
  async function loteSimples(lista: Item[], patch: Record<string, unknown>, msg: string) {
    try {
      const desf = await atualizarComDesfazer(sb, "itens", lista.map((i) => i.id), patch);
      notify(msg, "ok", desf); setSel(new Set()); atualizar();
    } catch (e) { notify(msgErro(e), "erro"); }
  }
  function tocarPasso(i: Item, passo: Passo) {
    const campo = PASSOS.find((x) => x.id === passo)!.campo;
    if (i[campo]) { setSub({ t: "passo", item: i, passo }); return; }
    if (passo === "comprado") { setSub({ t: "compra", itens: [i] }); return; }
    if (!i.comprado_em) { notify("Marque primeiro como comprada.", "erro"); return; }
    passoEmLote([i], passo);
  }
  async function copiarContador(lista: Item[]) {
    if (!p) return;
    const ok = await copiar(textoContador(p, lista));
    notify(ok ? "Lista copiada. Cole no WhatsApp do contador." : "Não consegui copiar neste aparelho.", ok ? "ok" : "erro");
  }
  async function restaurarDaLixeira() {
    const { error } = await sb.from("pedidos").update({ excluido_em: null }).eq("id", id);
    if (error) notify(msgErro(error), "erro"); else { notify("Carro de volta da lixeira."); setLixeira(false); atualizar(); }
  }

  if (p === undefined) return <Modal titulo="Carregando…" onClose={onClose}><p className="py-6 text-center text-sm text-neutral-500">Carregando…</p></Modal>;
  if (p === null) return (
    <Modal titulo="Carro" onClose={onClose} largura="max-w-sm">
      <div className="space-y-3 text-sm">
        <p>{lixeira ? "Este carro está na lixeira." : "Este carro não foi encontrado."}</p>
        {lixeira ? <Button variant="primary" onClick={restaurarDaLixeira}><RotateCcw size={15} /> Tirar da lixeira</Button> : null}
      </div>
    </Modal>
  );

  const semNota = ativos.filter((i) => !i.nota_id);
  const naoCompradas = ativos.filter((i) => !i.comprado_em);
  const paraEnviar = ativos.filter((i) => i.comprado_em && !i.enviado_em);
  const paraEntregar = ativos.filter((i) => i.enviado_em && !i.entregue_em);
  const semCobranca = ativos.filter((i) => !i.cobranca_id);
  const sobras = itens.filter((i) => i.cancelado_em && i.comprado_em && !i.sobra_resolvida);
  const notaAguardando = notas.find((n) => !n.emitida_em);
  const venda = somar(ativos, totalVenda), custo = somar(ativos, totalCusto);
  const etapa = ETAPAS[p.etapa];

  return (
    <Modal titulo={nomeCarro(p)} onClose={onClose} largura="max-w-3xl">
      <div className="space-y-4">
        {/* cabeçalho */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-0.5 text-sm">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge className={etapa.cor}>{etapa.label}</Badge>
              <span className="font-medium">{p.cliente_nome}</span>
              {p.oficina_nome ? <span className="text-neutral-500">· oficina {p.oficina_nome}</span> : null}
            </div>
            <div className="text-xs text-neutral-500">
              Pedido de {dataBR(p.data_pedido, true)}{p.ano ? ` · ano ${p.ano}` : ""}{p.referencia ? ` · ref. ${p.referencia}` : ""}{p.dispensa_nf ? " · sem nota de venda" : ""}
            </div>
            {p.observacoes ? <p className="whitespace-pre-wrap text-xs text-neutral-700">{p.observacoes}</p> : null}
          </div>
          <div className="relative flex gap-1.5">
            <Button className="!px-2.5" onClick={() => setSub({ t: "relatorio" })}><FileText size={15} /> Relatório</Button>
            <Button className="!px-2.5" onClick={() => setSub({ t: "pedido" })}><Pencil size={15} /> Editar</Button>
            <Button className="!px-2.5" aria-label="Mais opções" onClick={() => setMenu((m) => !m)}><MoreHorizontal size={16} /></Button>
            {menu ? (
              <div className="absolute right-0 top-10 z-10 w-56 rounded-lg border border-neutral-200 bg-white py-1 text-sm shadow-lg" onMouseLeave={() => setMenu(false)}>
                <button className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-neutral-50" onClick={() => { setMenu(false); setSub({ t: "historico" }); }}><History size={15} /> Histórico de mudanças</button>
                <button className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-neutral-50" onClick={() => { setMenu(false); copiarContador(ativos); }}><Copy size={15} /> Copiar lista de peças</button>
                {!p.dispensa_nf && semNota.length ? <button className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-neutral-50" onClick={() => { setMenu(false); setSub({ t: "nota" }); }}><FileText size={15} /> Mandei nota ao contador</button> : null}
                {semCobranca.length ? <button className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-neutral-50" onClick={() => { setMenu(false); novaCobranca({ cliente_id: p.cliente_id, itens: semCobranca.map((i) => i.id) }); }}><Receipt size={15} /> Cobrar agora</button> : null}
                <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-red-700 hover:bg-red-50" onClick={() => { setMenu(false); setSub({ t: "excluir" }); }}><Trash2 size={15} /> Excluir carro</button>
              </div>
            ) : null}
          </div>
        </div>

        {/* totais */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <Total rotulo="Venda" valor={brl(venda)} />
          <Total rotulo="Custo" valor={brl(custo)} />
          <Total rotulo="Lucro" valor={brl(venda - custo)} cor={venda - custo < 0 ? "text-red-700" : "text-emerald-700"} />
        </div>
        {p.n_sem_preco > 0 ? <p className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-900">{p.n_sem_preco} peça(s) sem valor de venda ou sem custo: os totais ainda não estão completos.</p> : null}

        {/* próximo passo */}
        <ProximoPasso ok={p.etapa === "concluido"}>
          {p.etapa === "sem_pecas" ? <><span>Ainda sem peças.</span><Button variant="primary" onClick={() => setSub({ t: "adicionar" })}><Plus size={15} /> Adicionar peças</Button></> : null}
          {naoCompradas.length > 0 ? <><span>{naoCompradas.length} peça(s) para comprar.</span><Button variant="primary" onClick={() => setSub({ t: "compra", itens: naoCompradas })}><ShoppingCart size={15} /> Marcar compra</Button></> : null}
          {paraEnviar.length > 0 ? <><span>{paraEnviar.length} comprada(s) para enviar.</span><Button variant="primary" onClick={() => passoEmLote(paraEnviar, "enviado")}><Truck size={15} /> Enviei {paraEnviar.length > 1 ? "todas" : ""} hoje</Button></> : null}
          {paraEntregar.length > 0 ? <><span>{paraEntregar.length} enviada(s) esperando entrega.</span><Button variant="primary" onClick={() => passoEmLote(paraEntregar, "entregue")}><PackageCheck size={15} /> Entregue{paraEntregar.length > 1 ? "s" : ""} hoje</Button></> : null}
          {!p.dispensa_nf && semNota.length > 0 && ativos.some((i) => i.enviado_em) ? <><span>{semNota.length} peça(s) sem nota de venda.</span><span className="flex flex-wrap gap-1.5"><Button onClick={() => setSub({ t: "relatorio" })}><FileText size={15} /> Relatório</Button><Button onClick={() => copiarContador(semNota)}><Copy size={15} /> Copiar</Button><Button variant="primary" onClick={() => setSub({ t: "nota" })}><FileText size={15} /> Mandei ao contador</Button></span></> : null}
          {notaAguardando ? <><span>Nota enviada ao contador em {dataBR(notaAguardando.enviada_em)}, ainda sem número.</span><Button variant="primary" onClick={() => setSub({ t: "nota", nota: notaAguardando, emitir: true })}><Check size={15} /> Nota emitida</Button></> : null}
          {semCobranca.length > 0 && ativos.some((i) => i.entregue_em) ? <><span>{semCobranca.length} peça(s) ainda não cobrada(s).</span><Button variant="primary" onClick={() => novaCobranca({ cliente_id: p.cliente_id, itens: semCobranca.map((i) => i.id) })}><Receipt size={15} /> Cobrar</Button></> : null}
          {sobras.length > 0 ? <><span>{sobras.length} peça(s) cancelada(s) já comprada(s): devolver ao fornecedor ou guardar.</span><Button onClick={() => loteSimples(sobras, { sobra_resolvida: true }, "Marcado como resolvido.")}><Check size={15} /> Resolvido</Button></> : null}
          {p.etapa === "receber" ? <span>Tudo cobrado; falta receber o pagamento.</span> : null}
          {p.etapa === "concluido" ? <span className="font-medium text-emerald-700">Tudo certo: entregue, nota emitida e pago. ✔</span> : null}
        </ProximoPasso>

        {/* peças */}
        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Peças ({ativos.length}{itens.length > ativos.length ? ` + ${itens.length - ativos.length} cancelada(s)` : ""})</h3>
            <div className="flex gap-1.5">
              {itens.length > 1 ? (
                <Button className="!px-2.5 !py-1.5 text-xs" onClick={() => setSel(sel.size === itens.length ? new Set() : new Set(itens.map((i) => i.id)))}>
                  {sel.size === itens.length ? <CheckSquare size={14} /> : <Square size={14} />} {sel.size === itens.length ? "Desmarcar" : "Selecionar"} todas
                </Button>
              ) : null}
              <Button className="!px-2.5 !py-1.5 text-xs" onClick={() => setSub({ t: "adicionar" })}><Plus size={14} /> Peças</Button>
            </div>
          </div>
          <ul className="divide-y divide-neutral-100 rounded-xl border border-neutral-200">
            {itens.map((i) => (
              <LinhaItem key={i.id} i={i} marcado={sel.has(i.id)} nota={notaDe(i)} cob={cobDe(i)} fornecedor={i.fornecedor_id}
                onMarcar={() => setSel((s) => { const n = new Set(s); if (n.has(i.id)) n.delete(i.id); else n.add(i.id); return n; })}
                onPasso={(ps) => tocarPasso(i, ps)} onEditar={() => setSub({ t: "item", item: i })}
                onNota={(n) => setSub({ t: "nota", nota: n })} onCob={(c) => abrirCobranca(c.id)} />
            ))}
          </ul>
        </section>

        {/* barra de seleção */}
        {selecionados.length > 0 ? (
          <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-1.5 border-t border-neutral-200 bg-white px-4 py-2.5 sm:-mx-5 sm:px-5">
            <span className="mr-1 text-xs font-medium">{selecionados.length} selecionada(s):</span>
            <Button className="!px-2.5 !py-1.5 text-xs" onClick={() => { const v = selecionados.filter((i) => !i.cancelado_em); const novas = v.filter((i) => !i.comprado_em); setSub({ t: "compra", itens: novas.length ? novas : v }); }}><ShoppingCart size={14} /> Comprei</Button>
            <Button className="!px-2.5 !py-1.5 text-xs" onClick={() => passoEmLote(selecionados, "enviado")}><Truck size={14} /> Enviei</Button>
            <Button className="!px-2.5 !py-1.5 text-xs" onClick={() => passoEmLote(selecionados, "entregue")}><PackageCheck size={14} /> Entregue</Button>
            <Button className="!px-2.5 !py-1.5 text-xs" onClick={() => loteSimples(selecionados.filter((i) => i.nf_fornecedor === "pendente"), { nf_fornecedor: "recebida" }, "Nota do fornecedor marcada como recebida.")}><FileText size={14} /> NF fornecedor ok</Button>
            {selecionados.some((i) => i.cancelado_em)
              ? <Button className="!px-2.5 !py-1.5 text-xs" onClick={() => loteSimples(selecionados.filter((i) => i.cancelado_em), { cancelado_em: null }, "Peças reativadas.")}><RotateCcw size={14} /> Reativar</Button>
              : <Button className="!px-2.5 !py-1.5 text-xs" onClick={() => loteSimples(selecionados, { cancelado_em: hojeSP() }, `${selecionados.length} peça(s) cancelada(s).`)}><Ban size={14} /> Cancelar</Button>}
            <Button variant="danger" className="!px-2.5 !py-1.5 text-xs" onClick={() => loteSimples(selecionados, { excluido_em: new Date().toISOString() }, `${selecionados.length} peça(s) na lixeira.`)}><Trash2 size={14} /> Excluir</Button>
          </div>
        ) : null}

        {/* notas e cobranças */}
        {notas.length || cobs.length ? (
          <section className="grid gap-3 sm:grid-cols-2">
            {notas.length ? (
              <div className="space-y-1.5">
                <h3 className="text-sm font-semibold">Notas de venda</h3>
                {notas.map((n) => (
                  <button key={n.id} onClick={() => setSub({ t: "nota", nota: n })} className="flex w-full items-center justify-between gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-left text-sm hover:bg-neutral-50">
                    <span>{n.numero ? `NF ${n.numero}` : "Sem número ainda"} <span className="text-xs text-neutral-500">· enviada {dataBR(n.enviada_em)}{n.emitida_em ? ` · emitida ${dataBR(n.emitida_em)}` : ""}</span></span>
                    <Badge className={n.emitida_em ? "bg-emerald-100 text-emerald-800" : "bg-violet-100 text-violet-900"}>{n.emitida_em ? "Emitida" : "No contador"}</Badge>
                  </button>
                ))}
              </div>
            ) : null}
            {cobs.length ? (
              <div className="space-y-1.5">
                <h3 className="text-sm font-semibold">Cobranças</h3>
                {cobs.map((c) => (
                  <button key={c.id} onClick={() => abrirCobranca(c.id)} className="flex w-full items-center justify-between gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-left text-sm hover:bg-neutral-50">
                    <span>{nomeForma(c.forma)} {brl(c.total)} <span className="text-xs text-neutral-500">{c.n_parcelas > 1 ? `· ${c.n_pagas}/${c.n_parcelas} pagas` : c.proximo_vencimento ? `· vence ${dataBR(c.proximo_vencimento)}` : ""}</span></span>
                    <Badge className={c.paga ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-900"}>{c.paga ? "Paga" : c.enviada_em ? "Aguardando" : "Não enviada"}</Badge>
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>

      {sub?.t === "compra" ? <CompraModal itens={sub.itens} onClose={() => { setSub(null); setSel(new Set()); }} /> : null}
      {sub?.t === "passo" ? <PassoModal item={sub.item} passo={sub.passo} onClose={() => setSub(null)} /> : null}
      {sub?.t === "item" ? <ItemModal item={sub.item} onClose={() => setSub(null)} /> : null}
      {sub?.t === "pedido" ? <PedidoModal p={p} onClose={() => setSub(null)} /> : null}
      {sub?.t === "nota" ? <NotaModal p={p} itens={ativos} nota={sub.nota} emitir={sub.emitir} onClose={() => setSub(null)} /> : null}
      {sub?.t === "adicionar" ? <AdicionarModal pedidoId={p.id} onClose={() => setSub(null)} /> : null}
      {sub?.t === "relatorio" ? <RelatorioCarro p={p} itens={itens} onClose={() => setSub(null)} /> : null}
      {sub?.t === "historico" ? <HistoricoModal pedidoId={p.id} itens={itens} onClose={() => setSub(null)} /> : null}
      {sub?.t === "excluir" ? (
        <ConfirmDialog titulo="Excluir carro" perigo confirmar="Mandar para a lixeira"
          texto={<>O carro <b>{nomeCarro(p)}</b> e as peças dele vão para a lixeira. Dá para trazer de volta em Ajustes → Lixeira.{cobs.length ? " Atenção: ele tem peças em cobrança." : ""}</>}
          onCancel={() => setSub(null)}
          onConfirm={async () => {
            try {
              const desf = await atualizarComDesfazer(sb, "pedidos", [p.id], { excluido_em: new Date().toISOString() });
              notify("Carro na lixeira.", "ok", desf); atualizar(); onClose();
            } catch (e) { notify(msgErro(e), "erro"); }
          }} />
      ) : null}
    </Modal>
  );
}

function Total({ rotulo, valor, cor = "" }: { rotulo: string; valor: string; cor?: string }) {
  return <div className="rounded-lg bg-neutral-50 px-2 py-1.5"><div className="text-[11px] text-neutral-500">{rotulo}</div><div className={`text-sm font-semibold tabular-nums ${cor}`}>{valor}</div></div>;
}

function ProximoPasso({ children, ok = false }: { children: React.ReactNode; ok?: boolean }) {
  const filhos = (Array.isArray(children) ? children : [children]).filter(Boolean);
  if (!filhos.length) return null;
  return (
    <div className={`divide-y rounded-xl border ${ok ? "divide-emerald-100 border-emerald-200 bg-emerald-50/60" : "divide-red-100 border-red-200 bg-red-50/50"}`}>
      {filhos.map((f, i) => <div key={i} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">{f}</div>)}
    </div>
  );
}

function LinhaItem({ i, marcado, nota, cob, onMarcar, onPasso, onEditar, onNota, onCob }: {
  i: Item; marcado: boolean; nota?: NotaVenda; cob?: CobrancaResumo; fornecedor: string | null;
  onMarcar: () => void; onPasso: (p: Passo) => void; onEditar: () => void; onNota: (n: NotaVenda) => void; onCob: (c: CobrancaResumo) => void;
}) {
  const { cad } = useApp();
  const forn = cad.fornecedores.find((f) => f.id === i.fornecedor_id)?.nome;
  const cancelada = !!i.cancelado_em;
  const lucro = i.venda !== null && i.custo !== null ? (i.venda - i.custo) * i.quantidade : null;
  return (
    <li className={`flex gap-2 px-2.5 py-2.5 ${marcado ? "bg-red-50/60" : ""} ${cancelada ? "opacity-60" : ""}`}>
      <button aria-label={marcado ? "Desmarcar" : "Selecionar"} onClick={onMarcar} className="mt-0.5 h-6 w-6 shrink-0 text-neutral-400">{marcado ? <CheckSquare size={20} className="text-red-900" /> : <Square size={20} />}</button>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <button onClick={onEditar} className="min-w-0 text-left">
            <span className={`text-sm font-medium ${cancelada ? "line-through" : ""}`}>{i.quantidade > 1 ? `${i.quantidade}× ` : ""}{i.descricao}</span>
            <span className="block text-xs text-neutral-500">
              {forn ?? "sem fornecedor"} · custo {i.custo === null ? "—" : brl(i.custo)} · venda {i.venda === null ? <span className="text-amber-700">sem preço</span> : brl(i.venda)}{i.quantidade > 1 ? " (un.)" : ""}
              {lucro !== null ? <> · lucro <span className={lucro < 0 ? "text-red-700" : ""}>{brl(lucro)}</span></> : null}
            </span>
            {cancelada ? <span className="block text-xs text-neutral-600">Cancelada{i.motivo_cancelamento ? `: ${i.motivo_cancelamento}` : ""}{i.comprado_em ? (i.sobra_resolvida ? " · resolvida" : " · comprada: devolver/guardar") : ""}</span> : null}
            {i.observacoes ? <span className="block text-xs italic text-neutral-500">{i.observacoes}</span> : null}
          </button>
          <button onClick={onEditar} aria-label="Editar peça" className="shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"><Pencil size={15} /></button>
        </div>
        {!cancelada ? (
          <div className="flex flex-wrap items-center gap-1">
            {PASSOS.map((ps) => {
              const d = i[ps.campo];
              return (
                <button key={ps.id} onClick={() => onPasso(ps.id)}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${d ? "border-emerald-600 bg-emerald-600 text-white" : "border-neutral-300 bg-white text-neutral-600 hover:border-neutral-500"}`}>
                  {d ? <Check size={11} /> : null}{ps.label}{d ? ` ${dataBR(d)}` : ""}
                </button>
              );
            })}
            {i.nf_fornecedor === "pendente" ? <Badge className="bg-amber-100 text-amber-900">NF fornecedor pendente</Badge> : null}
            {i.nf_fornecedor === "sem_nota" ? <Badge className="bg-neutral-100 text-neutral-600">Fornecedor sem nota</Badge> : null}
            {nota ? <button onClick={() => onNota(nota)}><Badge className={nota.emitida_em ? "bg-emerald-50 text-emerald-800" : "bg-violet-100 text-violet-900"}>{nota.emitida_em ? `NF ${nota.numero ?? "emitida"}` : "NF no contador"}</Badge></button> : null}
            {cob ? <button onClick={() => onCob(cob)}><Badge className={cob.paga ? "bg-emerald-50 text-emerald-800" : "bg-rose-100 text-rose-900"}>{cob.paga ? "Pago" : `Cobrado (${nomeForma(cob.forma).toLowerCase()})`}</Badge></button> : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

/** Editar os dados do carro. */
function PedidoModal({ p, onClose }: { p: PedidoResumo; onClose: () => void }) {
  const { sb, cad, notify, atualizar, recarregarCadastros } = useApp();
  const [f, setF] = useState({
    cliente_id: p.cliente_id, oficina_id: p.oficina_id, veiculo: p.veiculo, placa: placaBR(p.placa), ano: p.ano ?? "",
    referencia: p.referencia ?? "", data_pedido: p.data_pedido, observacoes: p.observacoes ?? "", dispensa_nf: p.dispensa_nf,
  });
  const [erro, setErro] = useState("");
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  async function salvar() {
    const placa = limparPlaca(f.placa);
    if (placa && !placaValida(placa)) { setErro("A placa precisa ter 7 letras/números (ex.: ABC1D23)."); return; }
    if (!f.veiculo.trim() && !placa) { setErro("Informe o carro ou a placa."); return; }
    try {
      const desf = await atualizarComDesfazer(sb, "pedidos", [p.id], {
        cliente_id: f.cliente_id, oficina_id: f.oficina_id, veiculo: f.veiculo.trim(), placa: placa || null, ano: f.ano.trim() || null,
        referencia: f.referencia.trim() || null, data_pedido: f.data_pedido || hojeSP(), observacoes: f.observacoes.trim() || null, dispensa_nf: f.dispensa_nf,
      });
      notify("Carro salvo.", "ok", desf); atualizar(); onClose();
    } catch (e) { setErro(msgErro(e)); }
  }
  return (
    <Modal titulo="Editar carro" onClose={onClose} largura="max-w-lg" fecharFora={false}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Cliente">
            <select className={inputCls} value={f.cliente_id} onChange={(e) => set("cliente_id", e.target.value)}>
              {cad.clientes.filter((c) => c.ativo || c.id === f.cliente_id).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </Field>
          <Field label="Oficina">
            <Combo opcoes={cad.oficinas} valor={f.oficina_id} onChange={(v) => set("oficina_id", v)}
              onNovo={async (nome) => { try { const id = await acharOuCriar(sb, "oficinas", nome); await recarregarCadastros(); return id; } catch (e) { notify(msgErro(e), "erro"); return null; } }} />
          </Field>
          <Field label="Carro (modelo)"><input className={inputCls} value={f.veiculo} onChange={(e) => set("veiculo", e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Placa"><input className={`${inputCls} uppercase`} maxLength={8} value={f.placa} onChange={(e) => set("placa", e.target.value.toUpperCase())} /></Field>
            <Field label="Ano"><input className={inputCls} value={f.ano} onChange={(e) => set("ano", e.target.value)} /></Field>
          </div>
          <Field label="Nº evento / sinistro / OS"><input className={inputCls} value={f.referencia} onChange={(e) => set("referencia", e.target.value)} /></Field>
          <Field label="Data do pedido"><input type="date" className={inputCls} value={f.data_pedido} onChange={(e) => set("data_pedido", e.target.value)} /></Field>
        </div>
        <Field label="Observações"><textarea className={`${inputCls} min-h-16`} value={f.observacoes} onChange={(e) => set("observacoes", e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={f.dispensa_nf} onChange={(e) => set("dispensa_nf", e.target.checked)} /> Este carro não vai ter nota de venda</label>
        {erro ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p> : null}
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={salvar}>Salvar</Button></div>
      </div>
    </Modal>
  );
}

/** Nota de venda: criar ("mandei ao contador") ou editar (número, datas, peças, excluir). */
function NotaModal({ p, itens, nota, emitir = false, onClose }: { p: PedidoResumo; itens: Item[]; nota?: NotaVenda; emitir?: boolean; onClose: () => void }) {
  const { sb, notify, atualizar } = useApp();
  const disponiveis = itens.filter((i) => !i.nota_id || i.nota_id === nota?.id);
  const [escolhidas, setEscolhidas] = useState<Set<string>>(() => new Set(nota ? itens.filter((i) => i.nota_id === nota.id).map((i) => i.id) : disponiveis.map((i) => i.id)));
  const [enviada, setEnviada] = useState(nota?.enviada_em ?? hojeSP());
  const [numero, setNumero] = useState(nota?.numero ?? "");
  const [emitida, setEmitida] = useState(nota?.emitida_em ?? (emitir ? hojeSP() : ""));
  const [obs, setObs] = useState(nota?.observacoes ?? "");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const lista = itens.filter((i) => escolhidas.has(i.id));

  async function salvar() {
    setErro("");
    if (!escolhidas.size) { setErro("Escolha pelo menos uma peça."); return; }
    setSalvando(true);
    try {
      if (!nota) {
        const { data: id, error } = await sb.rpc("criar_nota", { p_pedido: p.id, p_itens: [...escolhidas], p_enviada_em: enviada, p_numero: numero || null, p_emitida_em: emitida || null, p_obs: obs || null });
        if (error) throw error;
        notify("Nota marcada como enviada ao contador.", "ok", async () => { const { error: e } = await sb.from("notas_venda").delete().eq("id", id); if (e) throw e; });
      } else {
        const d1 = await atualizarComDesfazer(sb, "notas_venda", [nota.id], { enviada_em: enviada, numero: numero.trim() || null, emitida_em: emitida || null, observacoes: obs.trim() || null });
        const sair = itens.filter((i) => i.nota_id === nota.id && !escolhidas.has(i.id)).map((i) => i.id);
        const entrar = [...escolhidas].filter((x) => itens.find((i) => i.id === x)?.nota_id !== nota.id);
        const d2 = await atualizarComDesfazer(sb, "itens", sair, { nota_id: null });
        const d3 = await atualizarComDesfazer(sb, "itens", entrar, { nota_id: nota.id });
        notify(emitida && !nota.emitida_em ? `Nota ${numero || ""} emitida.` : "Nota salva.", "ok", async () => { await d3(); await d2(); await d1(); });
      }
      atualizar(); onClose();
    } catch (e) { setErro(msgErro(e)); } finally { setSalvando(false); }
  }
  async function excluir() {
    if (!nota) return;
    const { error } = await sb.rpc("excluir_nota", { p_id: nota.id });
    if (error) { setErro(msgErro(error)); return; }
    notify("Nota na lixeira; as peças voltaram para “sem nota”.", "ok", async () => { const { error: e } = await sb.rpc("restaurar_nota", { p_id: nota.id }); if (e) throw e; });
    atualizar(); onClose();
  }

  return (
    <Modal titulo={nota ? (nota.numero ? `Nota ${nota.numero}` : "Nota no contador") : "Mandei a nota ao contador"} onClose={onClose} largura="max-w-lg" fecharFora={false}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Mandei ao contador em"><input type="date" className={inputCls} value={enviada} onChange={(e) => setEnviada(e.target.value || hojeSP())} /></Field>
          <Field label="Nº da nota (quando sair)"><input className={inputCls} inputMode="numeric" value={numero} onChange={(e) => setNumero(e.target.value)} /></Field>
          <Field label="Emitida em" hint="Deixe vazio enquanto o contador não emitir.">
            <input type="date" className={inputCls} value={emitida} onChange={(e) => setEmitida(e.target.value)} />
          </Field>
          <Field label="Observação"><input className={inputCls} value={obs} onChange={(e) => setObs(e.target.value)} /></Field>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-xs font-medium text-neutral-600"><span>Peças nesta nota</span><span>{brl(somar(lista, totalVenda))}</span></div>
          <ul className="max-h-56 divide-y divide-neutral-100 overflow-auto rounded-lg border border-neutral-200">
            {disponiveis.map((i) => (
              <li key={i.id}>
                <label className="flex items-center gap-2 px-3 py-2 text-sm">
                  <input type="checkbox" className="h-4 w-4" checked={escolhidas.has(i.id)} onChange={() => setEscolhidas((s) => { const n = new Set(s); if (n.has(i.id)) n.delete(i.id); else n.add(i.id); return n; })} />
                  <span className="min-w-0 flex-1">{i.quantidade > 1 ? `${i.quantidade}× ` : ""}{i.descricao}</span>
                  <span className="tabular-nums text-xs text-neutral-500">{i.venda === null ? "sem preço" : brl(totalVenda(i))}</span>
                </label>
              </li>
            ))}
          </ul>
          {lista.some((i) => i.venda === null) ? <p className="mt-1 text-xs text-amber-800">Tem peça sem valor de venda: confira antes de mandar ao contador.</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={async () => { const ok = await copiar(textoContador(p, lista)); notify(ok ? "Lista copiada." : "Não consegui copiar.", ok ? "ok" : "erro"); }}><Copy size={15} /> Copiar lista</Button>
          <a className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50" href={linkWhatsApp(textoContador(p, lista))} target="_blank" rel="noreferrer"><MessageCircle size={15} /> WhatsApp</a>
        </div>
        {erro ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p> : null}
        <div className="flex flex-wrap justify-between gap-2">
          {nota ? <Button variant="danger" onClick={excluir}><Trash2 size={15} /> Excluir nota</Button> : <span />}
          <div className="flex gap-2"><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={salvando} onClick={salvar}>{salvando ? "Salvando…" : "Salvar"}</Button></div>
        </div>
      </div>
    </Modal>
  );
}

function AdicionarModal({ pedidoId, onClose }: { pedidoId: string; onClose: () => void }) {
  const { sb, notify, atualizar } = useApp();
  const [pecas, setPecas] = useState<LinhaPeca[]>([]);
  const [salvando, setSalvando] = useState(false);
  async function salvar() {
    const validas = pecas.filter((x) => x.descricao.trim());
    if (!validas.length) return;
    setSalvando(true);
    const { error } = await sb.rpc("adicionar_itens", { p_pedido: pedidoId, p_itens: validas.map((x) => ({ descricao: x.descricao.trim(), quantidade: x.quantidade })) });
    setSalvando(false);
    if (error) { notify(msgErro(error), "erro"); return; }
    notify(`${validas.length} peça(s) adicionada(s).`); atualizar(); onClose();
  }
  return (
    <Modal titulo="Adicionar peças" onClose={onClose} largura="max-w-lg" fecharFora={false}>
      <div className="space-y-3">
        <EditorPecas pecas={pecas} setPecas={setPecas} autoFocus />
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={salvando || !pecas.length} onClick={salvar}>Adicionar</Button></div>
      </div>
    </Modal>
  );
}

const CAMPOS: Record<string, string> = {
  descricao: "peça", quantidade: "quantidade", fornecedor_id: "fornecedor", custo: "custo", venda: "venda", comprado_em: "comprada em", enviado_em: "enviada em",
  entregue_em: "entregue em", nf_fornecedor: "NF do fornecedor", nota_id: "nota de venda", cobranca_id: "cobrança", cancelado_em: "cancelada em",
  motivo_cancelamento: "motivo", sobra_resolvida: "resolvida", observacoes: "observações", excluido_em: "lixeira", cliente_id: "cliente", oficina_id: "oficina",
  veiculo: "carro", placa: "placa", ano: "ano", referencia: "referência", data_pedido: "data do pedido", dispensa_nf: "sem nota", numero: "nº", emitida_em: "emitida em", enviada_em: "enviada em",
};
type Hist = { id: number; quando: string; tabela: string; registro_id: string; acao: string; antes: Record<string, unknown> | null; depois: Record<string, unknown> | null };

function HistoricoModal({ pedidoId, itens, onClose }: { pedidoId: string; itens: Item[]; onClose: () => void }) {
  const { sb, cad } = useApp();
  const [lista, setLista] = useState<Hist[] | null>(null);
  useEffect(() => {
    sb.from("historico").select("*").eq("pedido_id", pedidoId).order("quando", { ascending: false }).limit(300).then(({ data }) => setLista((data ?? []) as Hist[]));
  }, [sb, pedidoId]);
  const nomeItem = (h: Hist) => (h.depois?.descricao as string) ?? (h.antes?.descricao as string) ?? itens.find((i) => i.id === h.registro_id)?.descricao ?? "peça";
  const valor = (k: string, v: unknown) => {
    if (v === null || v === undefined || v === "") return "vazio";
    if (k === "fornecedor_id") return cad.fornecedores.find((f) => f.id === v)?.nome ?? "outro";
    if (k === "oficina_id") return cad.oficinas.find((f) => f.id === v)?.nome ?? "outra";
    if (k === "cliente_id") return cad.clientes.find((f) => f.id === v)?.nome ?? "outro";
    if (k === "nota_id" || k === "cobranca_id") return "sim";
    if (k === "excluido_em") return "sim";
    if (typeof v === "boolean") return v ? "sim" : "não";
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return dataBR(v, true);
    if ((k === "custo" || k === "venda") && typeof v === "number") return brl(v);
    return String(v);
  };
  const descrever = (h: Hist) => {
    const quem = h.tabela === "itens" ? `Peça “${nomeItem(h)}”` : h.tabela === "pedidos" ? "Carro" : "Nota de venda";
    if (h.acao === "INSERT") return `${quem}: criada`;
    if (h.acao === "DELETE") return `${quem}: apagada`;
    const mud = Object.keys(h.depois ?? {}).filter((k) => k in CAMPOS && k !== "atualizado_em" && k !== "itens_vinculados");
    return `${quem}: ${mud.map((k) => `${CAMPOS[k]} ${valor(k, h.antes?.[k])} → ${valor(k, h.depois?.[k])}`).join("; ")}`;
  };
  return (
    <Modal titulo="Histórico de mudanças" onClose={onClose} largura="max-w-lg">
      {lista === null ? <p className="text-sm text-neutral-500">Carregando…</p> : lista.length === 0 ? <p className="text-sm text-neutral-500">Nada registrado ainda.</p> : (
        <ul className="space-y-2 text-sm">
          {lista.map((h) => <li key={h.id} className="border-b border-neutral-100 pb-2"><div className="text-xs text-neutral-500">{dataHora(h.quando)}</div><div>{descrever(h)}</div></li>)}
        </ul>
      )}
      <p className="mt-3 text-xs text-neutral-500">Para voltar algo, abra a peça ou o carro e mude o campo de volta. Peças e carros excluídos ficam em Ajustes → Lixeira.</p>
    </Modal>
  );
}
