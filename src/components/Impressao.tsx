"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Conteúdo que vai para a impressora / PDF. Fica escondido na tela; ao imprimir, só ele aparece.
 * Use junto com window.print().
 */
export function AreaImpressao({ children }: { children: ReactNode }) {
  const [alvo, setAlvo] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const el = document.createElement("div");
    el.id = "impressao";
    document.body.appendChild(el);
    document.body.classList.add("tem-impressao");
    setAlvo(el);
    return () => { el.remove(); document.body.classList.remove("tem-impressao"); };
  }, []);
  return alvo ? createPortal(children, alvo) : null;
}

/** Cabeçalho com a marca, igual em todo papel que sai do sistema. */
export function CabecalhoMV({ titulo, sub }: { titulo: string; sub?: ReactNode }) {
  return (
    <div style={{ borderBottom: "3px solid #7f1d1d", paddingBottom: 8, marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
      <div>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#7f1d1d", letterSpacing: -0.5 }}>MV Peças e Logística</div>
        <div style={{ fontSize: 12, color: "#555" }}>{sub}</div>
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: "#7f1d1d" }}>{titulo}</div>
    </div>
  );
}
