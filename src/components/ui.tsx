"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

export const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none transition focus:border-red-900 focus:ring-1 focus:ring-red-900 disabled:bg-neutral-100 disabled:text-neutral-500";

/** Campo com rótulo. grupo=true para botões (Segmentado): não usa <label>, senão tocar no rótulo aperta o 1º botão. */
export function Field({ label, children, hint, className = "", grupo = false }: { label: string; children: ReactNode; hint?: ReactNode; className?: string; grupo?: boolean }) {
  const conteudo = (
    <>
      <span className="mb-1 block text-xs font-medium text-neutral-600">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-neutral-500">{hint}</span> : null}
    </>
  );
  return grupo ? <div role="group" aria-label={label} className={`block ${className}`}>{conteudo}</div> : <label className={`block ${className}`}>{conteudo}</label>;
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "outline" };
export function Button({ variant = "outline", className = "", ...p }: BtnProps) {
  const v = {
    primary: "bg-red-900 text-white hover:bg-red-800 border border-red-900",
    outline: "bg-white text-neutral-800 hover:bg-neutral-50 border border-neutral-300",
    ghost: "text-neutral-600 hover:bg-neutral-100 border border-transparent",
    danger: "bg-white text-red-700 hover:bg-red-50 border border-red-200",
  }[variant];
  return (
    <button
      {...p}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${v} ${className}`}
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-neutral-200 bg-white ${className}`}>{children}</div>;
}

const pilha: number[] = [];
let proximoModal = 0;
/**
 * Janela por cima da tela. Só a janela de cima responde ao Esc.
 * fecharFora=false: tocar fora não fecha (para formulários longos, para não perder o que foi digitado).
 */
export function Modal({ titulo, onClose, children, largura = "max-w-xl", fecharFora = true }: { titulo: ReactNode; onClose: () => void; children: ReactNode; largura?: string; fecharFora?: boolean }) {
  const [meuId] = useState(() => ++proximoModal);
  const ref = useRef({ onClose, fecharFora });
  useEffect(() => { ref.current = { onClose, fecharFora }; });
  useEffect(() => {
    pilha.push(meuId);
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && pilha[pilha.length - 1] === meuId && ref.current.fecharFora) { e.stopPropagation(); ref.current.onClose(); } };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const i = pilha.lastIndexOf(meuId);
      if (i >= 0) pilha.splice(i, 1);
      if (pilha.length === 0) document.body.style.overflow = "";
    };
  }, [meuId]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-neutral-900/40 sm:items-center sm:p-4" onMouseDown={(e) => fecharFora && e.target === e.currentTarget && onClose()}>
      <div className={`flex max-h-[92dvh] w-full min-w-0 ${largura} flex-col rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-xl sm:rounded-2xl sm:pb-0`} role="dialog" aria-label={typeof titulo === "string" ? titulo : undefined}>
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3.5">
          <h2 className="min-w-0 truncate text-base font-semibold text-neutral-900">{titulo}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>
        <div className="min-w-0 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-5">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  titulo, texto, confirmar = "Confirmar", perigo = false, onConfirm, onCancel,
}: { titulo: string; texto: ReactNode; confirmar?: string; perigo?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal titulo={titulo} onClose={onCancel} largura="max-w-md">
      <div className="space-y-5">
        <p className="text-sm text-neutral-700">{texto}</p>
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel}>Voltar</Button>
          <Button variant={perigo ? "danger" : "primary"} onClick={onConfirm}>{confirmar}</Button>
        </div>
      </div>
    </Modal>
  );
}

export function Vazio({ children }: { children: ReactNode }) {
  return <div className="px-4 py-10 text-center text-sm text-neutral-500">{children}</div>;
}

export function Segmentado<T extends string>({ valor, opcoes, onChange }: { valor: T; opcoes: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex max-w-full overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-100 p-0.5">
      {opcoes.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition ${valor === o.id ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600 hover:text-neutral-900"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Badge({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${className}`}>{children}</span>;
}

/** Campo de valor em reais (aceita "1.234,56"). */
export function CampoValor({ value, onChange, placeholder = "0,00", autoFocus, id }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; id?: string }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-neutral-500">R$</span>
      <input id={id} className={`${inputCls} pl-9 tabular-nums`} inputMode="decimal" autoComplete="off" placeholder={placeholder} value={value} autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.,]/g, ""))} />
    </div>
  );
}
