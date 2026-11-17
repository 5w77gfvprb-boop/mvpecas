export type Cliente = { id: string; nome: string; telefone: string | null; observacoes: string | null; ativo: boolean };
export type Oficina = { id: string; nome: string; cidade: string | null; telefone: string | null; observacoes: string | null; ativo: boolean };
export type Fornecedor = { id: string; nome: string; telefone: string | null; observacoes: string | null; ativo: boolean };

export type Etapa =
  | "sem_pecas" | "comprar" | "enviar" | "entregar" | "mandar_nf" | "aguardando_nf" | "cobrar" | "receber" | "sobras" | "concluido" | "cancelado";

export type Pedido = {
  id: string;
  cliente_id: string;
  oficina_id: string | null;
  veiculo: string;
  placa: string | null;
  ano: string | null;
  referencia: string | null;
  observacoes: string | null;
  data_pedido: string;
  dispensa_nf: boolean;
  excluido_em: string | null;
  criado_em: string;
};

export type PedidoResumo = Pedido & {
  cliente_nome: string;
  oficina_nome: string | null;
  n_total: number; n_ativos: number; n_comprados: number; n_enviados: number; n_entregues: number;
  n_sem_nota: number; n_nota_aguardando: number; n_sem_cobranca: number; n_a_receber: number; n_sobras: number;
  total_venda: number; total_custo: number; n_sem_preco: number; ultima_entrega: string | null;
  etapa: Etapa;
};

export type NfFornecedor = "pendente" | "recebida" | "sem_nota";

export type Item = {
  id: string;
  pedido_id: string;
  descricao: string;
  quantidade: number;
  fornecedor_id: string | null;
  custo: number | null;
  venda: number | null;
  comprado_em: string | null;
  enviado_em: string | null;
  entregue_em: string | null;
  nf_fornecedor: NfFornecedor | null;
  nota_id: string | null;
  cobranca_id: string | null;
  cancelado_em: string | null;
  motivo_cancelamento: string | null;
  sobra_resolvida: boolean;
  observacoes: string | null;
  ordem: number;
  excluido_em: string | null;
};

export type NotaVenda = {
  id: string; pedido_id: string; enviada_em: string; numero: string | null; emitida_em: string | null;
  observacoes: string | null; excluido_em: string | null;
};

export type Forma = "boleto" | "cheque" | "pix" | "transferencia" | "dinheiro" | "outro";

export type Cobranca = {
  id: string; cliente_id: string; forma: Forma; criada_em: string; enviada_em: string | null; observacoes: string | null;
  excluido_em: string | null;
};
export type CobrancaResumo = Cobranca & {
  cliente_nome: string; total: number; recebido: number; n_parcelas: number; n_pagas: number;
  proximo_vencimento: string | null; ultimo_pagamento: string | null; total_pecas: number; n_pecas: number; carros: string; paga: boolean;
};
export type Parcela = {
  id: string; cobranca_id: string; numero: number; vencimento: string; valor: number; documento: string | null; pago_em: string | null;
};
export type ParcelaResumo = Parcela & { cliente_id: string; cliente_nome: string; forma: Forma; enviada_em: string | null };

export const FORMAS: { id: Forma; label: string }[] = [
  { id: "boleto", label: "Boleto" },
  { id: "cheque", label: "Cheque" },
  { id: "pix", label: "Pix" },
  { id: "transferencia", label: "Transferência" },
  { id: "dinheiro", label: "Dinheiro" },
  { id: "outro", label: "Outro" },
];
export const nomeForma = (f: Forma) => FORMAS.find((x) => x.id === f)?.label ?? f;
/** O que significa "enviada" em cada forma de cobrança. */
export const rotuloEnvio = (f: Forma) => (f === "cheque" ? "Cheque recebido em mãos" : f === "boleto" ? "Boleto enviado ao cliente" : "Cobrança enviada ao cliente");

export const ETAPAS: Record<Etapa, { label: string; cor: string }> = {
  sem_pecas: { label: "Sem peças", cor: "bg-neutral-100 text-neutral-700" },
  comprar: { label: "Comprar", cor: "bg-amber-100 text-amber-900" },
  enviar: { label: "Enviar", cor: "bg-orange-100 text-orange-900" },
  entregar: { label: "Confirmar entrega", cor: "bg-sky-100 text-sky-900" },
  mandar_nf: { label: "Mandar NF ao contador", cor: "bg-violet-100 text-violet-900" },
  aguardando_nf: { label: "Aguardando NF", cor: "bg-violet-50 text-violet-800" },
  cobrar: { label: "Cobrar", cor: "bg-rose-100 text-rose-900" },
  receber: { label: "A receber", cor: "bg-emerald-50 text-emerald-800" },
  sobras: { label: "Peça cancelada a resolver", cor: "bg-yellow-100 text-yellow-900" },
  concluido: { label: "Concluído", cor: "bg-emerald-600 text-white" },
  cancelado: { label: "Cancelado", cor: "bg-neutral-200 text-neutral-600" },
};
export const ETAPAS_FECHADAS: Etapa[] = ["concluido", "cancelado"];
