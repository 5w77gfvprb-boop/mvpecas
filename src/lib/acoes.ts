import type { SupabaseClient } from "@supabase/supabase-js";

type Linha = Record<string, unknown> & { id: string };

/**
 * Atualiza linhas e devolve uma função que volta exatamente como estava antes (para o botão "Desfazer").
 * Cada linha volta aos SEUS valores anteriores (ex.: datas diferentes de compra em cada peça).
 */
export async function atualizarComDesfazer(
  sb: SupabaseClient, tabela: string, ids: string[], patch: Record<string, unknown>,
): Promise<() => Promise<void>> {
  if (ids.length === 0) return async () => {};
  const campos = Object.keys(patch);
  const { data: antes, error: e1 } = await sb.from(tabela).select(["id", ...campos].join(",")).in("id", ids);
  if (e1) throw e1;
  const { error } = await sb.from(tabela).update(patch).in("id", ids);
  if (error) throw error;
  const linhas = (antes ?? []) as unknown as Linha[];
  return async () => {
    // junta as linhas que tinham os mesmos valores para fazer menos chamadas
    const grupos = new Map<string, { valores: Record<string, unknown>; ids: string[] }>();
    for (const l of linhas) {
      const valores: Record<string, unknown> = {};
      for (const c of campos) valores[c] = l[c] ?? null;
      const k = JSON.stringify(valores);
      const g = grupos.get(k) ?? { valores, ids: [] };
      g.ids.push(l.id);
      grupos.set(k, g);
    }
    for (const g of grupos.values()) {
      const { error: e2 } = await sb.from(tabela).update(g.valores).in("id", g.ids);
      if (e2) throw e2;
    }
  };
}

/** Cadastra (ou acha, se já existir com o mesmo nome) uma oficina, fornecedor ou cliente. Devolve o id. */
export async function acharOuCriar(sb: SupabaseClient, tabela: "oficinas" | "fornecedores" | "clientes", nome: string): Promise<string> {
  const limpo = nome.trim().replace(/\s{2,}/g, " ");
  const { data: lista, error: e0 } = await sb.from(tabela).select("id,nome,ativo");
  if (e0) throw e0;
  const igual = (lista ?? []).find((x: { nome: string }) => x.nome.trim().toLowerCase() === limpo.toLowerCase()) as { id: string; ativo: boolean } | undefined;
  if (igual) {
    if (!igual.ativo) await sb.from(tabela).update({ ativo: true }).eq("id", igual.id);
    return igual.id;
  }
  const { data, error } = await sb.from(tabela).insert({ nome: limpo }).select("id").single();
  if (error) throw error;
  return (data as { id: string }).id;
}
