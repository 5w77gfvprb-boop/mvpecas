"use client";

import { Merge, Plus, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { msgErro, useApp } from "@/components/AppShell";
import { Badge, Button, ConfirmDialog, Field, Modal, Segmentado, Vazio, inputCls } from "@/components/ui";

type Tab = "clientes" | "oficinas" | "fornecedores";
type Reg = { id: string; nome: string; telefone: string | null; observacoes: string | null; ativo: boolean; cidade?: string | null; endereco?: string | null };
const NOMES: Record<Tab, { um: string; varios: string }> = {
  clientes: { um: "cliente", varios: "Clientes" }, oficinas: { um: "oficina", varios: "Oficinas" }, fornecedores: { um: "fornecedor", varios: "Fornecedores" },
};

export default function Cadastros() {
  const { cad } = useApp();
  const [tab, setTab] = useState<Tab>("clientes");
  const [busca, setBusca] = useState("");
  const [edit, setEdit] = useState<Reg | "novo" | null>(null);
  const lista = (cad[tab] as Reg[]).filter((r) => r.nome.toLowerCase().includes(busca.trim().toLowerCase()));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Cadastros</h1>
        <Button variant="primary" onClick={() => setEdit("novo")}><Plus size={15} /> Novo {NOMES[tab].um}</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Segmentado valor={tab} onChange={(t) => { setTab(t); setBusca(""); }} opcoes={[{ id: "clientes", label: "Clientes" }, { id: "oficinas", label: "Oficinas" }, { id: "fornecedores", label: "Fornecedores" }]} />
        <div className="relative min-w-0 flex-1 basis-48">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input className={`${inputCls} pl-9`} placeholder="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
      </div>
      {lista.length === 0 ? <Vazio>Nenhum cadastro.</Vazio> : (
        <ul className="divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-white">
          {lista.map((r) => (
            <li key={r.id}>
              <button className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-neutral-50" onClick={() => setEdit(r)}>
                <span className={`min-w-0 flex-1 truncate ${r.ativo ? "" : "text-neutral-400 line-through"}`}>{r.nome}</span>
                <span className="text-xs text-neutral-500">{[r.cidade, r.telefone].filter(Boolean).join(" · ")}</span>
                {!r.ativo ? <Badge className="bg-neutral-100 text-neutral-500">inativo</Badge> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-neutral-500">Oficinas e fornecedores novos também podem ser cadastrados na hora, digitando o nome no pedido ou na compra.</p>
      {edit ? <EditarCadastro tab={tab} reg={edit === "novo" ? null : edit} onClose={() => setEdit(null)} /> : null}
    </div>
  );
}

function EditarCadastro({ tab, reg, onClose }: { tab: Tab; reg: Reg | null; onClose: () => void }) {
  const { sb, cad, notify, recarregarCadastros, atualizar } = useApp();
  const [nome, setNome] = useState(reg?.nome ?? "");
  const [tel, setTel] = useState(reg?.telefone ?? "");
  const [cidade, setCidade] = useState(reg?.cidade ?? "");
  const [endereco, setEndereco] = useState(reg?.endereco ?? "");
  const [obs, setObs] = useState(reg?.observacoes ?? "");
  const [ativo, setAtivo] = useState(reg?.ativo ?? true);
  const [juntar, setJuntar] = useState("");
  const [confirmar, setConfirmar] = useState<"juntar" | "excluir" | null>(null);
  const [erro, setErro] = useState("");
  const outros = (cad[tab] as Reg[]).filter((r) => r.id !== reg?.id);

  async function salvar() {
    setErro("");
    if (!nome.trim()) { setErro("Escreva o nome."); return; }
    const dados: Record<string, unknown> = { nome: nome.trim().replace(/\s{2,}/g, " "), telefone: tel.trim() || null, observacoes: obs.trim() || null, ativo };
    if (tab === "oficinas") { dados.cidade = cidade.trim() || null; dados.endereco = endereco.trim() || null; }
    const { error } = reg ? await sb.from(tab).update(dados).eq("id", reg.id) : await sb.from(tab).insert(dados);
    if (error) { setErro(msgErro(error)); return; }
    await recarregarCadastros(); atualizar(); notify("Salvo."); onClose();
  }
  async function fazerJuntar() {
    const { error } = await sb.rpc("juntar_cadastro", { p_tabela: tab, p_origem: reg!.id, p_destino: juntar });
    if (error) { setErro(msgErro(error)); setConfirmar(null); return; }
    await recarregarCadastros(); atualizar(); notify("Cadastros juntados."); onClose();
  }
  async function excluir() {
    const { error } = await sb.from(tab).delete().eq("id", reg!.id);
    setConfirmar(null);
    if (error) { setErro(msgErro(error)); return; }
    await recarregarCadastros(); notify("Excluído."); onClose();
  }

  return (
    <Modal titulo={reg ? `Editar ${NOMES[tab].um}` : `Novo ${NOMES[tab].um}`} onClose={onClose} largura="max-w-md">
      <div className="space-y-3">
        <Field label="Nome"><input className={inputCls} value={nome} autoFocus={!reg} onChange={(e) => setNome(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Telefone / WhatsApp"><input className={inputCls} inputMode="tel" value={tel} onChange={(e) => setTel(e.target.value)} /></Field>
          {tab === "oficinas" ? <Field label="Cidade"><input className={inputCls} value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="Ipatinga" /></Field> : null}
        </div>
        {tab === "oficinas" ? <Field label="Endereço (vai no relatório do entregador)"><input className={inputCls} value={endereco} onChange={(e) => setEndereco(e.target.value)} placeholder="Rua, número, bairro" /></Field> : null}
        <Field label="Observações"><textarea className={`${inputCls} min-h-14`} value={obs} onChange={(e) => setObs(e.target.value)} /></Field>
        {reg ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Ativo (inativo some das listas de escolha, mas o histórico fica)</label> : null}

        {reg && outros.length ? (
          <div className="space-y-2 rounded-lg border border-neutral-200 p-3">
            <p className="text-xs text-neutral-600"><b>Cadastrou duas vezes</b> (ex.: “Bycar” e “By Car”)? Escolha o certo: tudo deste passa para ele e este é apagado.</p>
            <div className="flex gap-2">
              <select className={inputCls} value={juntar} onChange={(e) => setJuntar(e.target.value)}>
                <option value="">Juntar com…</option>
                {outros.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
              </select>
              <Button disabled={!juntar} onClick={() => setConfirmar("juntar")}><Merge size={15} /> Juntar</Button>
            </div>
          </div>
        ) : null}

        {erro ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{erro}</p> : null}
        <div className="flex flex-wrap justify-between gap-2">
          {reg ? <Button variant="danger" onClick={() => setConfirmar("excluir")}><Trash2 size={15} /> Excluir</Button> : <span />}
          <div className="flex gap-2"><Button onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={salvar}>Salvar</Button></div>
        </div>
      </div>
      {confirmar === "juntar" ? (
        <ConfirmDialog titulo="Juntar cadastros" confirmar="Juntar"
          texto={<>Tudo de <b>{reg!.nome}</b> passa para <b>{outros.find((o) => o.id === juntar)?.nome}</b>, e “{reg!.nome}” é apagado. Isso não tem desfazer automático.</>}
          onCancel={() => setConfirmar(null)} onConfirm={fazerJuntar} />
      ) : null}
      {confirmar === "excluir" ? (
        <ConfirmDialog titulo="Excluir cadastro" perigo confirmar="Excluir"
          texto={<>Só dá para excluir se <b>{reg!.nome}</b> não estiver em nenhum pedido. Se estiver, desmarque “Ativo” ou use “Juntar”.</>}
          onCancel={() => setConfirmar(null)} onConfirm={excluir} />
      ) : null}
    </Modal>
  );
}
