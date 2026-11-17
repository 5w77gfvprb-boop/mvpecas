// Textos prontos para mandar no WhatsApp (contador e cliente).
import type { CobrancaResumo, Item, Parcela, Pedido } from "@/lib/tipos";
import { nomeForma } from "@/lib/tipos";
import { brl, dataBR, placaBR, somar, totalVenda } from "@/lib/util";

type PedidoTexto = Pick<Pedido, "veiculo" | "placa" | "ano" | "referencia"> & { cliente_nome: string; oficina_nome?: string | null };

function linhaItem(i: Pick<Item, "quantidade" | "descricao" | "venda">) {
  const un = i.venda === null ? "sem preço" : brl(i.venda);
  return i.quantidade > 1
    ? `• ${i.quantidade}x ${i.descricao} — ${un} cada = ${brl(totalVenda(i))}`
    : `• ${i.descricao} — ${un}`;
}

/** Lista de peças para o contador emitir a nota de venda. */
export function textoContador(p: PedidoTexto, itens: Item[]): string {
  const carro = [p.veiculo, placaBR(p.placa), p.ano].filter(Boolean).join(" · ");
  return [
    `*Nota de venda — ${p.cliente_nome}*`,
    carro,
    p.referencia ? `Ref.: ${p.referencia}` : null,
    "",
    ...itens.map(linhaItem),
    "",
    `*Total: ${brl(somar(itens, totalVenda))}*`,
  ].filter((l) => l !== null).join("\n");
}

/** Cobrança para o cliente: carros, peças e parcelas. */
export function textoCobranca(c: CobrancaResumo, itens: (Item & { pedido: PedidoTexto })[], parcelas: Parcela[]): string {
  const porCarro = new Map<string, (Item & { pedido: PedidoTexto })[]>();
  for (const i of itens) {
    const k = [i.pedido.veiculo, placaBR(i.pedido.placa)].filter(Boolean).join(" ");
    porCarro.set(k, [...(porCarro.get(k) ?? []), i]);
  }
  const linhas: string[] = [`*MV Peças — cobrança*`, `Cliente: ${c.cliente_nome}`, ""];
  for (const [carro, lista] of porCarro) {
    linhas.push(`*${carro}*${lista[0].pedido.referencia ? ` (ref. ${lista[0].pedido.referencia})` : ""}`);
    linhas.push(...lista.map(linhaItem));
    linhas.push(`Subtotal: ${brl(somar(lista, totalVenda))}`, "");
  }
  linhas.push(`*Total: ${brl(somar(parcelas, (p) => p.valor))}*`);
  if (parcelas.length > 1 || c.forma !== "dinheiro") {
    linhas.push(`${nomeForma(c.forma)}${parcelas.length > 1 ? ` em ${parcelas.length}x` : ""}:`);
    for (const p of parcelas) linhas.push(`${p.numero}) venc. ${dataBR(p.vencimento, true)} — ${brl(p.valor)}${p.documento ? ` (${p.documento})` : ""}${p.pago_em ? " ✔ pago" : ""}`);
  }
  return linhas.join("\n");
}
