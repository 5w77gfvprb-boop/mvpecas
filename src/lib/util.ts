// Funções pequenas usadas no sistema todo: dinheiro, datas, placa e a leitura da lista de peças.

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const brl = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(Number(v)) ? "—" : moeda.format(Number(v)));

/** Lê um valor digitado do jeito brasileiro: "1.234,56", "350,5", "350", "R$ 1.200". Volta null se vazio ou inválido. */
export function lerValor(txt: string | number | null | undefined): number | null {
  if (txt === null || txt === undefined) return null;
  if (typeof txt === "number") return Number.isFinite(txt) ? Math.round(txt * 100) / 100 : null;
  let s = txt.replace(/[R$\s]/gi, "").trim();
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if ((s.match(/\./g) ?? []).length > 1) s = s.replace(/\./g, "");
  else if (/^\d{1,3}\.\d{3}$/.test(s)) s = s.replace(".", "");          // "1.200" = mil e duzentos
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}
/** Valor para mostrar dentro de um campo de digitação ("1234,5" → "1234,50"). */
export const valorCampo = (v: number | null | undefined) => (v === null || v === undefined ? "" : Number(v).toFixed(2).replace(".", ","));

// ------------------------------------------------------------------- datas (sempre no horário de Brasília)
export function hojeSP(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}
export function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
/** Mesmo dia N meses depois (31/01 + 1 mês = 28 ou 29/02). */
export function somarMeses(iso: string, meses: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1, 12));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0, 12)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}
export function diasEntre(de: string, ate: string): number {
  return Math.round((new Date(`${ate}T12:00:00Z`).getTime() - new Date(`${de}T12:00:00Z`).getTime()) / 86_400_000);
}
export function dataBR(iso: string | null | undefined, ano = false): string {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return ano ? `${d}/${m}/${a.slice(2)}` : `${d}/${m}`;
}
/** "hoje", "ontem", "há 5 dias", "em 3 dias". */
export function relativo(iso: string | null | undefined): string {
  if (!iso) return "";
  const n = diasEntre(hojeSP(), iso.slice(0, 10));
  if (n === 0) return "hoje";
  if (n === -1) return "ontem";
  if (n === 1) return "amanhã";
  return n < 0 ? `há ${-n} dias` : `em ${n} dias`;
}
export const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
export const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

// ------------------------------------------------------------------- placa
/** "abc-1d23" → "ABC1D23". Volta "" se vazio. */
export const limparPlaca = (p: string | null | undefined) => (p ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const placaValida = (p: string) => /^[A-Z0-9]{7}$/.test(p);
/** "ABC1D23" → "ABC-1D23" para ficar fácil de ler. */
export const placaBR = (p: string | null | undefined) => (p && p.length === 7 ? `${p.slice(0, 3)}-${p.slice(3)}` : p ?? "");
export const nomeCarro = (x: { veiculo: string; placa: string | null }) => [x.veiculo, placaBR(x.placa)].filter(Boolean).join(" · ") || "Carro sem nome";

// ------------------------------------------------------------------- lista de peças colada do WhatsApp
export type LinhaPeca = { descricao: string; quantidade: number };

/**
 * Transforma o texto colado (uma peça por linha) em peças.
 * Entende: marcadores (- • * ✅), numeração "1)", "1.", "1 -", quantidade "2x farol", "2 un farol", "farol x2", "farol (2)", "farol - 2 un".
 * Numeração 1, 2, 3… em sequência é tratada como numeração, não como quantidade.
 */
export function lerLista(texto: string): LinhaPeca[] {
  const linhas = texto
    .split(/\r?\n|;/)
    .map((l) => l.replace(/[​-‍﻿]/g, "").replace(/^[\s\-–—•*·▪►>\p{Extended_Pictographic}️⃣]+/u, "").trim())
    .filter((l) => l.length > 0 && !/^(pe[cç]as?|lista( de pe[cç]as)?|itens?)\s*:?$/i.test(l));

  // numeração em sequência (1, 2, 3…) no começo das linhas?
  const numeros = linhas.map((l) => l.match(/^(\d{1,3})\b/)?.[1]).map((n) => (n ? Number(n) : null));
  const comNumero = numeros.filter((n) => n !== null) as number[];
  const ehSequencia = comNumero.length >= 2 && comNumero.every((n, i) => n === i + 1) && numeros.every((n) => n !== null);

  const res: LinhaPeca[] = [];
  for (let l of linhas) {
    let qtd = 1;
    if (ehSequencia) {
      l = l.replace(/^\d{1,3}\s*[)\.\-–:]?\s*/, "");
    } else {
      const numeracao = l.match(/^\d{1,3}\s*[)\.]\s+/) || l.match(/^\d{1,3}\s*[\-–]\s+/);
      const q = l.match(/^(\d{1,2})\s*(?:x|un\.?|unid\.?|unidades?|p[cç]s?\.?|pe[cç]as?)?\s+(?=\D)/i);
      if (numeracao) l = l.slice(numeracao[0].length);
      else if (q && Number(q[1]) > 0 && Number(q[1]) <= 50) { qtd = Number(q[1]); l = l.slice(q[0].length); }
    }
    const fim = l.match(/\s*(?:[\-–(]\s*)?(?:x\s*(\d{1,2})|(\d{1,2})\s*(?:x|un\.?|unid\.?|unidades?|p[cç]s?\.?|pe[cç]as?)|\((\d{1,2})\s*\))\s*\)?\s*$/i);
    if (fim && qtd === 1) {
      const n = Number(fim[1] ?? fim[2] ?? fim[3]);
      if (n > 0 && n <= 50) { qtd = n; l = l.slice(0, fim.index).trim(); }
    }
    l = l.replace(/^[\s\-–:]+|[\s\-–:,.]+$/g, "").replace(/\s{2,}/g, " ");
    if (l) res.push({ descricao: l.charAt(0).toUpperCase() + l.slice(1), quantidade: qtd });
  }
  return res;
}

// ------------------------------------------------------------------- outros
export function copiar(texto: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(texto).then(() => true, () => copiarAntigo(texto));
  return Promise.resolve(copiarAntigo(texto));
}
function copiarAntigo(texto: string): boolean {
  try {
    const t = document.createElement("textarea");
    t.value = texto; t.style.position = "fixed"; t.style.opacity = "0";
    document.body.appendChild(t); t.select();
    const ok = document.execCommand("copy");
    t.remove();
    return ok;
  } catch { return false; }
}
export const linkWhatsApp = (texto: string) => `https://wa.me/?text=${encodeURIComponent(texto)}`;

export function baixarArquivo(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** CSV que o Excel brasileiro abre direto (ponto e vírgula, vírgula decimal, acentos certos). */
export function gerarCSV(cab: string[], linhas: (string | number | null | undefined)[][]): Blob {
  const cel = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "number" ? String(v).replace(".", ",") : v;
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const txt = [cab, ...linhas].map((l) => l.map(cel).join(";")).join("\r\n");
  return new Blob(["﻿" + txt], { type: "text/csv;charset=utf-8" });
}

export const somar = <T,>(xs: T[], f: (x: T) => number | null | undefined) => Math.round(xs.reduce((s, x) => s + (Number(f(x)) || 0), 0) * 100) / 100;
export const totalVenda = (i: { quantidade: number; venda: number | null }) => (i.venda === null ? 0 : i.quantidade * Number(i.venda));
export const totalCusto = (i: { quantidade: number; custo: number | null }) => (i.custo === null ? 0 : i.quantidade * Number(i.custo));

/** Divide um total em N parcelas iguais; o centavo que sobra vai na última. */
export function dividir(total: number, n: number): number[] {
  const cent = Math.round(total * 100);
  const base = Math.floor(cent / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? cent - base * (n - 1) : base) / 100);
}
