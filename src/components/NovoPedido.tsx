"use client";

import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { msgErro, useApp } from "@/components/AppShell";
import { Combo } from "@/components/Combo";
import { Button, Field, Modal, inputCls } from "@/components/ui";
import { acharOuCriar } from "@/lib/acoes";
import { ETAPAS_FECHADAS, type PedidoResumo } from "@/lib/tipos";
import { dataBR, hojeSP, lerLista, limparPlaca, nomeCarro, placaValida, type LinhaPeca } from "@/lib/util";

export type PresetPedido = { cliente_id?: string };

const CHAVE_CLIENTE = "ultimo_cliente";

/** Editor da lista de peças: cola o texto do WhatsApp e confere linha por linha. */
export function EditorPecas({ pecas, setPecas, autoFocus = false }: { pecas: LinhaPeca[]; setPecas: (p: LinhaPeca[]) => void; autoFocus?: boolean }) {
  const [texto, setTexto] = useState("");
  const [nova, setNova] = useState("");
  function colar(t: string) {
    const lidas = lerLista(t);
    if (lidas.length) { setPecas([...pecas, ...lidas]); setTexto(""); }
  }
  return (
    <div className="space-y-2">
      <Field label="Cole a lista de peças (uma por linha)" hint="Pode colar direto do WhatsApp. Entende “2x farol”, “farol (2)”, numeração 1, 2, 3… Depois confira a lista abaixo.">
        <textarea className={`${inputCls} min-h-24`} value={texto} autoFocus={autoFocus} placeholder={"Farol esquerdo\nPara-choque dianteiro\n2x Pisca lateral"}
          onChange={(e) => setTexto(e.target.value)}
          onPaste={(e) => { const t = e.clipboardData.getData("text"); if (t.includes("\n")) { e.preventDefault(); colar(texto + t); } }} />
      </Field>
      {texto.trim() ? <Button type="button" onClick={() => colar(texto)}><Plus size={15} /> Pôr na lista</Button> : null}

      {pecas.length ? (
        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
          {pecas.map((p, i) => (
            <li key={i} className="flex items-center gap-2 px-2 py-1.5">
              <input aria-label="Quantidade" className="w-12 rounded-md border border-neutral-200 px-1.5 py-1 text-center text-sm tabular-nums" inputMode="numeric" value={p.quantidade}
                onChange={(e) => { const q = Math.max(1, Math.min(999, Number(e.target.value.replace(/\D/g, "")) || 1)); setPecas(pecas.map((x, j) => (j === i ? { ...x, quantidade: q } : x))); }} />
              <span className="text-xs text-neutral-400">×</span>
              <input aria-label="Peça" className="min-w-0 flex-1 rounded-md border border-transparent px-1.5 py-1 text-sm hover:border-neutral-200 focus:border-neutral-300" value={p.descricao}
                onChange={(e) => setPecas(pecas.map((x, j) => (j === i ? { ...x, descricao: e.target.value } : x)))} />
              <button type="button" aria-label="Tirar da lista" className="rounded p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-700" onClick={() => setPecas(pecas.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex gap-2">
        <input className={inputCls} value={nova} placeholder="Ou digite uma peça e toque em +" onChange={(e) => setNova(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (nova.trim()) { setPecas([...pecas, ...lerLista(nova)]); setNova(""); } } }} />
        <Button type="button" aria-label="Adicionar peça" disabled={!nova.trim()} onClick={() => { setPecas([...pecas, ...lerLista(nova)]); setNova(""); }}><Plus size={16} /></Button>
      </div>
      {pecas.length ? <p className="text-xs text-neutral-500">{pecas.length} peça(s) na lista.</p> : null}
    </div>
  );
}

export default function NovoPedido({ preset, onClose, onCriado }: { preset: PresetPedido; onClose: () => void; onCriado: (id: string) => void }) {
  const { sb, cad, notify, recarregarCadastros, atualizar, abrirCarro } = useApp();
  const clientesAtivos = cad.clientes.filter((c) => c.ativo);
  const [clienteId, setClienteId] = useState<string | null>(() => {
    if (preset.cliente_id) return preset.cliente_id;
    let ult: string | null = null;
    try { ult = localStorage.getItem(CHAVE_CLIENTE); } catch { /* ignora */ }
    return clientesAtivos.find((c) => c.id === ult)?.id ?? clientesAtivos.find((c) => /protiva/i.test(c.nome))?.id ?? clientesAtivos[0]?.id ?? null;
  });
  const [oficinaId, setOficinaId] = useState<string | null>(null);
  const [veiculo, setVeiculo] = useState("");
  const [placa, setPlaca] = useState("");
  const [ano, setAno] = useState("");
  const [referencia, setReferencia] = useState("");
  const [data, setData] = useState(hojeSP());
  const [obs, setObs] = useState("");
  const [pecas, setPecas] = useState<LinhaPeca[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [abertos, setAbertos] = useState<PedidoResumo[]>([]);

  const placaLimpa = limparPlaca(placa);
  useEffect(() => {
    if (!placaValida(placaLimpa)) { setAbertos([]); return; }
    let vivo = true;
    sb.from("v_pedidos").select("*").eq("placa", placaLimpa).order("data_pedido", { ascending: false }).then(({ data }) => {
      if (vivo) setAbertos(((data ?? []) as PedidoResumo[]).filter((p) => !ETAPAS_FECHADAS.includes(p.etapa)));
    });
    return () => { vivo = false; };
  }, [placaLimpa, sb]);

  const pecasValidas = useMemo(() => pecas.filter((p) => p.descricao.trim()), [pecas]);

  async function salvar() {
    setErro("");
    if (!clienteId) { setErro("Escolha o cliente."); return; }
    if (!veiculo.trim() && !placaLimpa) { setErro("Informe pelo menos o carro ou a placa."); return; }
    if (placaLimpa && !placaValida(placaLimpa)) { setErro("A placa precisa ter 7 letras/números (ex.: ABC1D23). Se ainda não sabe a placa, deixe em branco."); return; }
    setSalvando(true);
    try {
      const { data: id, error } = await sb.rpc("criar_pedido", {
        p_pedido: { cliente_id: clienteId, oficina_id: oficinaId, veiculo: veiculo.trim(), placa: placaLimpa, ano: ano.trim(), referencia: referencia.trim(), observacoes: obs.trim(), data_pedido: data },
        p_itens: pecasValidas.map((p) => ({ descricao: p.descricao.trim(), quantidade: p.quantidade })),
      });
      if (error) throw error;
      try { localStorage.setItem(CHAVE_CLIENTE, clienteId); } catch { /* ignora */ }
      notify("Pedido criado.", "ok", async () => { const { error: e } = await sb.from("pedidos").update({ excluido_em: new Date().toISOString() }).eq("id", id); if (e) throw e; });
      atualizar();
      onCriado(id as string);
    } catch (e) { setErro(msgErro(e)); } finally { setSalvando(false); }
  }

  async function juntarNoAberto(p: PedidoResumo) {
    if (!pecasValidas.length) { onClose(); abrirCarro(p.id); return; }
    setSalvando(true);
    const { error } = await sb.rpc("adicionar_itens", { p_pedido: p.id, p_itens: pecasValidas.map((x) => ({ descricao: x.descricao.trim(), quantidade: x.quantidade })) });
    setSalvando(false);
    if (error) { setErro(msgErro(error)); return; }
    notify(`${pecasValidas.length} peça(s) adicionada(s) em ${nomeCarro(p)}.`);
    atualizar();
    onCriado(p.id);
  }

  function fechar() {
    const mexeu = veiculo.trim() || placa.trim() || obs.trim() || pecas.length > 0;
    if (!mexeu || window.confirm("Fechar sem salvar? O que você digitou vai se perder.")) onClose();
  }

  async function novaOficina(nome: string) {
    try { const id = await acharOuCriar(sb, "oficinas", nome); await recarregarCadastros(); return id; } catch (e) { notify(msgErro(e), "erro"); return null; }
  }

  return (
    <Modal titulo="Novo pedido" onClose={fechar} largura="max-w-2xl" fecharFora={false}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Cliente">
            <select className={inputCls} value={clienteId ?? ""} onChange={(e) => setClienteId(e.target.value || null)}>
              {clientesAtivos.length === 0 ? <option value="">Cadastre um cliente em Cadastros</option> : null}
              {clientesAtivos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </Field>
          <Field label="Oficina onde o carro está">
            <Combo opcoes={cad.oficinas.map((o) => ({ ...o, extra: o.cidade }))} valor={oficinaId} onChange={setOficinaId} onNovo={novaOficina} placeholder="Digite o nome da oficina" />
          </Field>
          <Field label="Carro (modelo)"><input className={inputCls} value={veiculo} onChange={(e) => setVeiculo(e.target.value)} placeholder="Ex.: Gol G5, HB20, Onix" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Placa"><input className={`${inputCls} uppercase`} value={placa} maxLength={8} autoCapitalize="characters" onChange={(e) => setPlaca(e.target.value.toUpperCase())} placeholder="ABC1D23" /></Field>
            <Field label="Ano"><input className={inputCls} value={ano} inputMode="numeric" maxLength={9} onChange={(e) => setAno(e.target.value)} placeholder="2015" /></Field>
          </div>
          <Field label="Nº do evento / sinistro / OS (se tiver)"><input className={inputCls} value={referencia} onChange={(e) => setReferencia(e.target.value)} /></Field>
          <Field label="Data do pedido"><input type="date" className={inputCls} value={data} onChange={(e) => setData(e.target.value || hojeSP())} /></Field>
        </div>
        <Field label="Observações sobre o carro"><textarea className={`${inputCls} min-h-16`} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Cor, versão, chassi, o que o cliente falou…" /></Field>

        {abertos.length ? (
          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="flex items-center gap-1.5 font-medium"><AlertTriangle size={15} /> Já tem pedido em aberto para esta placa:</p>
            {abertos.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1">{nomeCarro(p)} · {p.cliente_nome} · {dataBR(p.data_pedido)} · {p.n_total} peça(s)</span>
                <Button type="button" className="!py-1 text-xs" disabled={salvando} onClick={() => juntarNoAberto(p)}>{pecasValidas.length ? "Pôr estas peças nele" : "Abrir esse carro"}</Button>
              </div>
            ))}
            <p className="text-xs">Se for outro serviço no mesmo carro, pode criar um pedido novo normalmente.</p>
          </div>
        ) : null}

        <EditorPecas pecas={pecas} setPecas={setPecas} />

        {erro ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p> : null}
        <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t border-neutral-100 bg-white px-4 pt-3 sm:-mx-5 sm:px-5">
          <Button onClick={fechar}>Cancelar</Button>
          <Button variant="primary" disabled={salvando} onClick={salvar}>{salvando ? "Salvando…" : `Criar pedido${pecasValidas.length ? ` (${pecasValidas.length} peças)` : ""}`}</Button>
        </div>
      </div>
    </Modal>
  );
}
