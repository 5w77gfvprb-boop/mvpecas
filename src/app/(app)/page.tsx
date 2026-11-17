"use client";

import { AlertTriangle, Check, ChevronDown, ChevronRight, Copy, FileText, PackageCheck, Receipt, ShoppingCart, Truck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { msgErro, useApp } from "@/components/AppShell";
import { CompraModal, marcarPasso } from "@/components/Pecas";
import { Badge, Button, Vazio, inputCls } from "@/components/ui";
import { atualizarComDesfazer } from "@/lib/acoes";
import { textoContador } from "@/lib/textos";
import { ETAPAS_FECHADAS, nomeForma, type Item, type NotaVenda, type ParcelaResumo, type PedidoResumo } from "@/lib/tipos";
import { brl, copiar, dataBR, diasEntre, hojeSP, nomeCarro, relativo, somar, totalVenda } from "@/lib/util";

type ItemP = Item & { pedido?: { veiculo: string; placa: string | null; cliente_id: string; excluido_em: string | null } };
type Dados = { pedidos: PedidoResumo[]; itens: Item[]; notas: NotaVenda[]; parcelas: ParcelaResumo[]; nfForn: ItemP[] };

async function emPedacos<T>(ids: string[], f: (parte: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const res: T[] = [];
  for (let k = 0; k < ids.length; k += 80) {
    const { data, error } = await f(ids.slice(k, k + 80));
    if (error) throw error;
    res.push(...(data ?? []));
  }
  return res;
}

export default function AFazer() {
  const { sb, notify, versao, atualizar, abrirCarro, abrirCobranca, novaCobranca, cad } = useApp();
  const [d, setD] = useState<Dados | null>(null);
  const [cliente, setCliente] = useState("");
  const [compra, setCompra] = useState<Item[] | null>(null);

  const carregar = useCallback(async () => {
    try {
      const { data: ped, error } = await sb.from("v_pedidos").select("*").not("etapa", "in", `(${ETAPAS_FECHADAS.join(",")})`).order("data_pedido");
      if (error) throw error;
      const pedidos = (ped ?? []) as PedidoResumo[];
      const ids = pedidos.map((p) => p.id);
      const [itens, notas, parc, nf] = await Promise.all([
        emPedacos<Item>(ids, (parte) => sb.from("itens").select("*").in("pedido_id", parte).is("excluido_em", null).order("ordem")),
        emPedacos<NotaVenda>(ids, (parte) => sb.from("notas_venda").select("*").in("pedido_id", parte).is("excluido_em", null).is("emitida_em", null)),
        sb.from("v_parcelas").select("*").is("pago_em", null).order("vencimento"),
        sb.from("itens").select("*, pedido:pedidos!inner(veiculo,placa,cliente_id,excluido_em)").eq("nf_fornecedor", "pendente").is("excluido_em", null).is("pedido.excluido_em", null).order("comprado_em"),
      ]);
      if (parc.error) throw parc.error;
      if (nf.error) throw nf.error;
      setD({ pedidos, itens, notas, parcelas: (parc.data ?? []) as ParcelaResumo[], nfForn: (nf.data ?? []) as ItemP[] });
    } catch (e) { notify(msgErro(e), "erro"); }
  }, [sb, notify]);
  useEffect(() => { carregar(); }, [carregar, versao]);

  const hoje = hojeSP();
  const v = useMemo(() => {
    if (!d) return null;
    const peds = d.pedidos.filter((p) => !cliente || p.cliente_id === cliente);
    const porId = new Map(peds.map((p) => [p.id, p]));
    const itens = d.itens.filter((i) => porId.has(i.pedido_id));
    const ativos = itens.filter((i) => !i.cancelado_em);
    const porCarro = (lista: Item[]) => {
      const m = new Map<string, Item[]>();
      for (const i of lista) m.set(i.pedido_id, [...(m.get(i.pedido_id) ?? []), i]);
      return [...m.entries()].map(([id, its]) => ({ p: porId.get(id)!, itens: its }));
    };
    const comprar = porCarro(ativos.filter((i) => !i.comprado_em));
    const enviar = porCarro(ativos.filter((i) => i.comprado_em && !i.enviado_em));
    const entregar = porCarro(ativos.filter((i) => i.enviado_em && !i.entregue_em));
    const jaSaiu = new Set(ativos.filter((i) => i.enviado_em).map((i) => i.pedido_id));   // só depois que alguma peça saiu
    const mandarNf = porCarro(ativos.filter((i) => !i.nota_id && !porId.get(i.pedido_id)!.dispensa_nf && jaSaiu.has(i.pedido_id)))
      .sort((a, b) => Number(b.p.n_entregues === b.p.n_ativos) - Number(a.p.n_entregues === a.p.n_ativos));
    const notas = d.notas.filter((n) => porId.has(n.pedido_id)).map((n) => ({ n, p: porId.get(n.pedido_id)! }));
    // cobrar: por cliente, só peças entregues
    const semCob = ativos.filter((i) => !i.cobranca_id && i.entregue_em);
    const cobrarPorCliente = new Map<string, { nome: string; itens: Item[]; carros: Set<string> }>();
    for (const i of semCob) {
      const p = porId.get(i.pedido_id)!;
      const g = cobrarPorCliente.get(p.cliente_id) ?? { nome: p.cliente_nome, itens: [], carros: new Set<string>() };
      g.itens.push(i); g.carros.add(p.id); cobrarPorCliente.set(p.cliente_id, g);
    }
    const parcelas = d.parcelas.filter((p) => !cliente || p.cliente_id === cliente);
    const nfForn = d.nfForn.filter((i) => !cliente || i.pedido?.cliente_id === cliente);
    const semPreco = porCarro(ativos.filter((i) => i.venda === null || (i.comprado_em && i.custo === null)));
    const sobras = porCarro(itens.filter((i) => i.cancelado_em && i.comprado_em && !i.sobra_resolvida));
    const semPecas = peds.filter((p) => p.n_total === 0);
    return { comprar, enviar, entregar, mandarNf, notas, cobrar: [...cobrarPorCliente.entries()], parcelas, nfForn, semPreco, sobras, semPecas };
  }, [d, cliente]);

  async function lote(itens: Item[], passo: "enviado" | "entregue") {
    try {
      const [n, desf] = await marcarPasso(sb, itens, passo, hoje);
      notify(`${n} peça(s) ${passo === "enviado" ? "enviada(s)" : "entregue(s)"} hoje.`, "ok", desf); atualizar();
    } catch (e) { notify(msgErro(e), "erro"); }
  }
  async function mandarNota(p: PedidoResumo, itens: Item[]) {
    const { data: id, error } = await sb.rpc("criar_nota", { p_pedido: p.id, p_itens: itens.map((i) => i.id), p_enviada_em: hoje });
    if (error) { notify(msgErro(error), "erro"); return; }
    const ok = await copiar(textoContador(p, itens));
    notify(`Nota marcada como enviada ao contador.${ok ? " Lista copiada para colar no WhatsApp." : ""}`, "ok", async () => { const { error: e } = await sb.from("notas_venda").delete().eq("id", id); if (e) throw e; });
    atualizar();
  }
  async function recebi(p: ParcelaResumo) {
    try {
      const desf = await atualizarComDesfazer(sb, "cobranca_parcelas", [p.id], { pago_em: hoje });
      notify(`Recebido ${brl(p.valor)} de ${p.cliente_nome}.`, "ok", desf); atualizar();
    } catch (e) { notify(msgErro(e), "erro"); }
  }
  async function simples(ids: string[], patch: Record<string, unknown>, msg: string) {
    try { const desf = await atualizarComDesfazer(sb, "itens", ids, patch); notify(msg, "ok", desf); atualizar(); } catch (e) { notify(msgErro(e), "erro"); }
  }

  if (!v) return <div className="py-10 text-center text-sm text-neutral-500">Carregando…</div>;
  const vencidas = v.parcelas.filter((p) => p.vencimento < hoje);
  const nada = !v.comprar.length && !v.enviar.length && !v.entregar.length && !v.mandarNf.length && !v.notas.length && !v.cobrar.length && !v.parcelas.length && !v.nfForn.length && !v.semPreco.length && !v.sobras.length && !v.semPecas.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">A fazer</h1>
        {cad.clientes.length > 1 ? (
          <select className={`${inputCls} !w-auto`} value={cliente} onChange={(e) => setCliente(e.target.value)} aria-label="Filtrar cliente">
            <option value="">Todos os clientes</option>
            {cad.clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile rotulo="Para comprar" n={somaQtd(v.comprar)} href="#comprar" />
        <Tile rotulo="Para enviar / entregar" n={somaQtd(v.enviar) + somaQtd(v.entregar)} href="#enviar" />
        <Tile rotulo="A receber" n={brl(somar(v.parcelas, (p) => p.valor))} href="#receber" />
        <Tile rotulo="Vencido" n={brl(somar(vencidas, (p) => p.valor))} href="#receber" alerta={vencidas.length > 0} />
      </div>

      {nada ? <Vazio>Nada pendente. Para lançar um carro, toque em <b>Novo</b>.</Vazio> : null}

      <Secao id="comprar" titulo="Comprar" icone={<ShoppingCart size={16} />} n={somaQtd(v.comprar)}>
        {v.comprar.map(({ p, itens }) => (
          <Carro key={p.id} p={p} onAbrir={() => abrirCarro(p.id)} acao={<Button variant="primary" className="!px-2.5 !py-1 text-xs" onClick={() => setCompra(itens)}><ShoppingCart size={14} /> Comprei</Button>}>
            <ListaPecas itens={itens} extra={(i) => <button className="text-xs text-red-900 underline" onClick={() => setCompra([i])}>comprei</button>} />
          </Carro>
        ))}
      </Secao>

      <Secao id="enviar" titulo="Enviar" icone={<Truck size={16} />} n={somaQtd(v.enviar)}>
        {v.enviar.map(({ p, itens }) => (
          <Carro key={p.id} p={p} onAbrir={() => abrirCarro(p.id)} acao={<Button variant="primary" className="!px-2.5 !py-1 text-xs" onClick={() => lote(itens, "enviado")}><Truck size={14} /> Enviei {itens.length > 1 ? "todas" : ""}</Button>}>
            <ListaPecas itens={itens} extra={(i) => <span className="text-xs text-neutral-500">comprada {relativo(i.comprado_em)}</span>} />
          </Carro>
        ))}
      </Secao>

      <Secao id="entregar" titulo="Confirmar entrega" icone={<PackageCheck size={16} />} n={somaQtd(v.entregar)}>
        {v.entregar.map(({ p, itens }) => (
          <Carro key={p.id} p={p} onAbrir={() => abrirCarro(p.id)} acao={<Button variant="primary" className="!px-2.5 !py-1 text-xs" onClick={() => lote(itens, "entregue")}><PackageCheck size={14} /> Entregue{itens.length > 1 ? "s" : ""}</Button>}>
            <ListaPecas itens={itens} extra={(i) => { const n = diasEntre(i.enviado_em!, hoje); return <span className={`text-xs ${n > 3 ? "font-medium text-amber-700" : "text-neutral-500"}`}>enviada {relativo(i.enviado_em)}</span>; }} />
          </Carro>
        ))}
      </Secao>

      <Secao id="nf" titulo="Mandar nota ao contador" icone={<FileText size={16} />} n={v.mandarNf.length} unidade="carro(s)">
        {v.mandarNf.map(({ p, itens }) => (
          <Carro key={p.id} p={p} onAbrir={() => abrirCarro(p.id)}
            info={p.n_entregues < p.n_ativos ? <Badge className="bg-neutral-100 text-neutral-600">{p.n_entregues}/{p.n_ativos} entregues</Badge> : <Badge className="bg-emerald-50 text-emerald-800">tudo entregue</Badge>}
            acao={<span className="flex gap-1.5">
              <Button className="!px-2.5 !py-1 text-xs" aria-label="Copiar lista para o contador" onClick={async () => { const ok = await copiar(textoContador(p, itens)); notify(ok ? "Lista copiada." : "Não consegui copiar.", ok ? "ok" : "erro"); }}><Copy size={14} /></Button>
              <Button variant="primary" className="!px-2.5 !py-1 text-xs" onClick={() => mandarNota(p, itens)}><FileText size={14} /> Mandei</Button>
            </span>}>
            <ListaPecas itens={itens} extra={(i) => <span className="text-xs tabular-nums text-neutral-500">{i.venda === null ? <span className="text-amber-700">sem preço</span> : brl(totalVenda(i))}</span>} />
          </Carro>
        ))}
      </Secao>

      <Secao id="aguardando" titulo="Esperando o contador emitir" icone={<FileText size={16} />} n={v.notas.length} unidade="nota(s)">
        {v.notas.map(({ n, p }) => (
          <Carro key={n.id} p={p} onAbrir={() => abrirCarro(p.id)} info={<span className={`text-xs ${diasEntre(n.enviada_em, hoje) > 3 ? "font-medium text-amber-700" : "text-neutral-500"}`}>enviada {relativo(n.enviada_em)}</span>}
            acao={<Button className="!px-2.5 !py-1 text-xs" onClick={() => abrirCarro(p.id)}><Check size={14} /> Pôr nº da nota</Button>} />
        ))}
      </Secao>

      <Secao id="cobrar" titulo="Cobrar (peças entregues)" icone={<Receipt size={16} />} n={v.cobrar.length} unidade="cliente(s)">
        {v.cobrar.map(([cid, g]) => (
          <div key={cid} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
            <div className="min-w-0 text-sm">
              <div className="font-medium">{g.nome}</div>
              <div className="text-xs text-neutral-500">{g.carros.size} carro(s) · {g.itens.length} peça(s) · {brl(somar(g.itens, totalVenda))}</div>
            </div>
            <Button variant="primary" className="!px-2.5 !py-1 text-xs" onClick={() => novaCobranca({ cliente_id: cid, itens: g.itens.map((i) => i.id) })}><Receipt size={14} /> Criar cobrança</Button>
          </div>
        ))}
      </Secao>

      <Secao id="receber" titulo="A receber" icone={<Receipt size={16} />} n={v.parcelas.length} unidade="parcela(s)">
        {v.parcelas.map((p) => {
          const venc = p.vencimento < hoje;
          return (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
              <button className="min-w-0 text-left text-sm" onClick={() => abrirCobranca(p.cobranca_id)}>
                <div className="font-medium">{p.cliente_nome} · <span className="tabular-nums">{brl(p.valor)}</span></div>
                <div className={`text-xs ${venc ? "font-semibold text-red-700" : "text-neutral-500"}`}>
                  {nomeForma(p.forma)}{p.documento ? ` ${p.documento}` : ""} · venc. {dataBR(p.vencimento, true)} ({relativo(p.vencimento)}){!p.enviada_em ? " · ainda não enviada ao cliente" : ""}
                </div>
              </button>
              <Button variant="primary" className="!px-2.5 !py-1 text-xs" onClick={() => recebi(p)}><Check size={14} /> Recebi</Button>
            </div>
          );
        })}
      </Secao>

      <Secao id="nfforn" titulo="Nota do fornecedor pendente" icone={<AlertTriangle size={16} />} n={v.nfForn.length} unidade="peça(s)" fechada>
        {v.nfForn.map((i) => (
          <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <button className="min-w-0 text-left text-sm" onClick={() => abrirCarro(i.pedido_id)}>
              <div>{i.descricao}</div>
              <div className="text-xs text-neutral-500">{i.pedido ? nomeCarro(i.pedido) : ""} · {cad.fornecedores.find((f) => f.id === i.fornecedor_id)?.nome ?? "sem fornecedor"} · comprada {dataBR(i.comprado_em)}</div>
            </button>
            <Button className="!px-2.5 !py-1 text-xs" onClick={() => simples([i.id], { nf_fornecedor: "recebida" }, "Nota do fornecedor recebida.")}><Check size={14} /> Recebi a nota</Button>
          </div>
        ))}
      </Secao>

      <Secao id="preco" titulo="Peças sem preço ou sem custo" icone={<AlertTriangle size={16} />} n={somaQtd(v.semPreco)} unidade="peça(s)" fechada>
        {v.semPreco.map(({ p, itens }) => (
          <Carro key={p.id} p={p} onAbrir={() => abrirCarro(p.id)} acao={<Button className="!px-2.5 !py-1 text-xs" onClick={() => abrirCarro(p.id)}>Abrir</Button>}>
            <ListaPecas itens={itens} extra={(i) => <span className="text-xs text-amber-700">{i.venda === null ? "sem venda" : "sem custo"}</span>} />
          </Carro>
        ))}
      </Secao>

      <Secao id="sobras" titulo="Canceladas já compradas (devolver ou guardar)" icone={<AlertTriangle size={16} />} n={somaQtd(v.sobras)} unidade="peça(s)">
        {v.sobras.map(({ p, itens }) => (
          <Carro key={p.id} p={p} onAbrir={() => abrirCarro(p.id)} acao={<Button className="!px-2.5 !py-1 text-xs" onClick={() => simples(itens.map((i) => i.id), { sobra_resolvida: true }, "Marcado como resolvido.")}><Check size={14} /> Resolvido</Button>}>
            <ListaPecas itens={itens} extra={(i) => <span className="text-xs text-neutral-500">{i.motivo_cancelamento ?? "cancelada"}</span>} />
          </Carro>
        ))}
      </Secao>

      <Secao id="sempecas" titulo="Carros sem peças lançadas" icone={<AlertTriangle size={16} />} n={v.semPecas.length} unidade="carro(s)">
        {v.semPecas.map((p) => <Carro key={p.id} p={p} onAbrir={() => abrirCarro(p.id)} acao={<Button className="!px-2.5 !py-1 text-xs" onClick={() => abrirCarro(p.id)}>Abrir</Button>} />)}
      </Secao>

      {compra ? <CompraModal itens={compra} onClose={() => setCompra(null)} /> : null}
    </div>
  );
}

const somaQtd = (g: { itens: Item[] }[]) => g.reduce((s, x) => s + x.itens.length, 0);

function Tile({ rotulo, n, href, alerta = false }: { rotulo: string; n: number | string; href: string; alerta?: boolean }) {
  return (
    <a href={href} className={`rounded-xl border bg-white px-3 py-2.5 ${alerta ? "border-red-200" : "border-neutral-200"}`}>
      <div className="text-xs text-neutral-500">{rotulo}</div>
      <div className={`text-lg font-semibold tabular-nums ${alerta ? "text-red-700" : ""}`}>{n}</div>
    </a>
  );
}

function Secao({ id, titulo, icone, n, unidade = "peça(s)", fechada = false, children }: { id: string; titulo: string; icone: ReactNode; n: number; unidade?: string; fechada?: boolean; children: ReactNode }) {
  const [aberta, setAberta] = useState(!fechada);
  if (n === 0) return null;
  return (
    <section id={id} className="scroll-mt-4 overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <button className="flex w-full items-center gap-2 px-3 py-2.5 text-left" onClick={() => setAberta((a) => !a)}>
        {aberta ? <ChevronDown size={16} className="text-neutral-400" /> : <ChevronRight size={16} className="text-neutral-400" />}
        <span className="text-red-900">{icone}</span>
        <span className="flex-1 text-sm font-semibold">{titulo}</span>
        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium tabular-nums">{n} {unidade}</span>
      </button>
      {aberta ? <div className="divide-y divide-neutral-100 border-t border-neutral-100">{children}</div> : null}
    </section>
  );
}

function Carro({ p, onAbrir, acao, info, children }: { p: PedidoResumo; onAbrir: () => void; acao?: ReactNode; info?: ReactNode; children?: ReactNode }) {
  return (
    <div className="space-y-1 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button className="min-w-0 text-left" onClick={onAbrir}>
          <span className="text-sm font-medium hover:underline">{nomeCarro(p)}</span>
          <span className="block text-xs text-neutral-500">{p.cliente_nome}{p.oficina_nome ? ` · ${p.oficina_nome}` : ""} · pedido {dataBR(p.data_pedido)} ({relativo(p.data_pedido)})</span>
        </button>
        <span className="flex items-center gap-2">{info}{acao}</span>
      </div>
      {children}
    </div>
  );
}

function ListaPecas({ itens, extra }: { itens: Item[]; extra?: (i: Item) => ReactNode }) {
  return (
    <ul className="space-y-0.5 pl-1">
      {itens.map((i) => (
        <li key={i.id} className="flex items-center justify-between gap-2 text-sm text-neutral-700">
          <span className="min-w-0 truncate">• {i.quantidade > 1 ? `${i.quantidade}× ` : ""}{i.descricao}</span>
          {extra ? <span className="shrink-0">{extra(i)}</span> : null}
        </li>
      ))}
    </ul>
  );
}
