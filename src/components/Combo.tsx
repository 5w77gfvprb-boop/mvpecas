"use client";

import { ChevronDown, Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { inputCls } from "@/components/ui";

type Opcao = { id: string; nome: string; ativo?: boolean; extra?: string | null };

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Campo de escolher com busca. Se o nome digitado não existe, oferece "Cadastrar".
 * valor = id escolhido (ou null). onNovo recebe o nome digitado e deve devolver o id criado.
 */
export function Combo({
  opcoes, valor, onChange, onNovo, placeholder = "Escolha ou digite…", rotuloNovo = "Cadastrar", permitirVazio = true, autoFocus = false,
}: {
  opcoes: Opcao[]; valor: string | null; onChange: (id: string | null) => void; onNovo?: (nome: string) => Promise<string | null>;
  placeholder?: string; rotuloNovo?: string; permitirVazio?: boolean; autoFocus?: boolean;
}) {
  const atual = opcoes.find((o) => o.id === valor) ?? null;
  const [texto, setTexto] = useState(atual?.nome ?? "");
  const [aberto, setAberto] = useState(false);
  const [criando, setCriando] = useState(false);
  const [destaque, setDestaque] = useState(0);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!aberto) setTexto(atual?.nome ?? ""); }, [atual?.nome, aberto]);
  useEffect(() => {
    const fora = (e: MouseEvent | TouchEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false); };
    document.addEventListener("mousedown", fora); document.addEventListener("touchstart", fora);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("touchstart", fora); };
  }, []);

  const busca = semAcento(texto);
  const filtradas = useMemo(() => {
    const ativas = opcoes.filter((o) => o.ativo !== false || o.id === valor);
    if (!busca || busca === semAcento(atual?.nome ?? "\u0000")) return ativas.slice(0, 60);
    return ativas.filter((o) => semAcento(o.nome).includes(busca)).slice(0, 60);
  }, [opcoes, busca, valor, atual?.nome]);
  const existeIgual = opcoes.some((o) => semAcento(o.nome) === busca);
  const podeCriar = !!onNovo && busca.length > 0 && !existeIgual;

  async function criar() {
    if (!onNovo) return;
    setCriando(true);
    const id = await onNovo(texto.trim());
    setCriando(false);
    if (id) { onChange(id); setAberto(false); }
  }
  function escolher(o: Opcao) { onChange(o.id); setTexto(o.nome); setAberto(false); }

  return (
    <div ref={caixa} className="relative">
      <input
        className={`${inputCls} pr-14`} value={texto} placeholder={placeholder} autoFocus={autoFocus} autoComplete="off"
        onFocus={(e) => { setAberto(true); e.currentTarget.select(); }}
        onChange={(e) => { setTexto(e.target.value); setAberto(true); setDestaque(0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setDestaque((d) => Math.min(d + 1, filtradas.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setDestaque((d) => Math.max(d - 1, 0)); }
          else if (e.key === "Enter" && aberto) {
            e.preventDefault();
            if (filtradas[destaque]) escolher(filtradas[destaque]); else if (podeCriar) criar();
          } else if (e.key === "Escape") setAberto(false);
        }}
        onBlur={() => {
          // digitou exatamente um nome que existe: escolhe sozinho
          setTimeout(() => {
            const igual = opcoes.find((o) => semAcento(o.nome) === semAcento(texto));
            if (igual && igual.id !== valor) onChange(igual.id);
            if (!texto.trim() && permitirVazio && valor) onChange(null);
          }, 150);
        }}
      />
      <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center">
        {valor && permitirVazio ? (
          <button type="button" aria-label="Limpar" className="rounded p-1.5 text-neutral-400 hover:text-neutral-700" onClick={() => { onChange(null); setTexto(""); }}><X size={14} /></button>
        ) : null}
        <button type="button" tabIndex={-1} aria-label="Abrir lista" className="rounded p-1.5 text-neutral-400" onClick={() => setAberto((a) => !a)}><ChevronDown size={15} /></button>
      </div>
      {aberto && (filtradas.length > 0 || podeCriar) ? (
        <ul className="absolute z-[60] mt-1 max-h-60 w-full overflow-auto rounded-lg border border-neutral-200 bg-white py-1 text-sm shadow-lg">
          {filtradas.map((o, i) => (
            <li key={o.id}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => escolher(o)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left ${i === destaque ? "bg-neutral-100" : ""} ${o.id === valor ? "font-semibold" : ""}`}>
                <span className="truncate">{o.nome}</span>{o.extra ? <span className="shrink-0 text-xs text-neutral-400">{o.extra}</span> : null}
              </button>
            </li>
          ))}
          {podeCriar ? (
            <li>
              <button type="button" disabled={criando} onMouseDown={(e) => e.preventDefault()} onClick={criar} className="flex w-full items-center gap-1.5 px-3 py-2 text-left font-medium text-red-900 hover:bg-red-50">
                <Plus size={14} /> {criando ? "Cadastrando…" : `${rotuloNovo} “${texto.trim()}”`}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
