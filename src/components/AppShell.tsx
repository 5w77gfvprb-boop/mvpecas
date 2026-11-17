"use client";

import { BarChart3, Car, ClipboardList, Download, LogOut, Menu, Plus, Receipt, Settings, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ehFalhaDeConexao, ForaDoAr, registrarAcesso } from "@/components/ForaDoAr";
import { getSupabase, supabaseConfigurado } from "@/lib/supabase";
import type { Cliente, Fornecedor, Oficina } from "@/lib/tipos";
import CarroModal from "@/components/Carro";
import NovoPedido, { type PresetPedido } from "@/components/NovoPedido";
import { CobrancaModal, NovaCobranca, type PresetCobranca } from "@/components/Cobranca";

type Toast = { id: number; msg: string; tipo: "ok" | "erro"; desfazer?: () => Promise<unknown> | unknown };
export type Cadastros = { clientes: Cliente[]; oficinas: Oficina[]; fornecedores: Fornecedor[] };
type AppCtx = {
  sb: SupabaseClient;
  notify: (msg: string, tipo?: "ok" | "erro", desfazer?: () => Promise<unknown> | unknown) => void;
  cad: Cadastros;
  recarregarCadastros: () => Promise<unknown>;
  /** Muda sempre que algum dado muda: as telas recarregam. */
  versao: number;
  atualizar: () => void;
  abrirCarro: (id: string) => void;
  novoPedido: (p?: PresetPedido) => void;
  abrirCobranca: (id: string) => void;
  novaCobranca: (p?: PresetCobranca) => void;
};

const Ctx = createContext<AppCtx | null>(null);
let proximoToast = 0;
export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp fora do AppShell");
  return c;
}

const NAV: { href: string; label: string; icon: typeof Car; soDesktop?: boolean; soCelular?: boolean }[] = [
  { href: "/", label: "A fazer", icon: ClipboardList },
  { href: "/carros", label: "Carros", icon: Car },
  { href: "/cobrancas", label: "Cobranças", icon: Receipt },
  { href: "/relatorios", label: "Relatórios", icon: BarChart3, soDesktop: true },
  { href: "/cadastros", label: "Cadastros", icon: Users, soDesktop: true },
  { href: "/ajustes", label: "Ajustes", icon: Settings, soDesktop: true },
  { href: "/mais", label: "Mais", icon: Menu, soCelular: true },
];

export const msgErro = (e: unknown) => {
  if (ehFalhaDeConexao(e)) return "Sem conexão com o banco. Confira a internet e tente de novo; se continuar, o Supabase pode estar pausado (abra o sistema de novo para ver como reativar).";
  const x = e as { message?: unknown; code?: string } | null;
  const m = typeof x?.message === "string" ? x.message : String(x?.message ?? e ?? "");
  if (x?.code === "23505" || /duplicate key/i.test(m)) return "Já existe um cadastro com esse nome.";
  if (x?.code === "23503" || /foreign key/i.test(m)) return "Este cadastro está sendo usado em pedidos. Desative em vez de excluir, ou junte com outro.";
  if (/itens_envio_depois_compra/.test(m)) return "Para marcar como enviada, a peça precisa estar marcada como comprada.";
  if (/itens_entrega_depois_envio/.test(m)) return "Para marcar como entregue, a peça precisa estar marcada como enviada.";
  if (/placa_check|pedidos_placa/.test(m)) return "Placa inválida: use 7 letras/números (ex.: ABC1D23).";
  if (/PGRST|schema cache|does not exist/i.test(m)) return `O banco ainda não tem tudo o que o sistema precisa. Confira se rodou todos os arquivos SQL do SETUP.md. (${m})`;
  const t = m.replace(/^.*?ERROR:\s*/, "").trim();
  return t && t !== "[object Object]" ? t : "Não deu certo. Tente de novo; se continuar, atualize a página.";
};

export default function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const semConfig = !supabaseConfigurado();
  const [cad, setCad] = useState<Cadastros | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [falha, setFalha] = useState<{ conexao: boolean; msg: string } | null>(null);
  const [backupDias, setBackupDias] = useState<number | null>(null);
  const [versao, setVersao] = useState(0);
  const [carro, setCarro] = useState<string | null>(null);
  const [novo, setNovo] = useState<PresetPedido | null>(null);
  const [cobranca, setCobranca] = useState<string | null>(null);
  const [novaCob, setNovaCob] = useState<PresetCobranca | null>(null);

  const notify = useCallback((msg: string, tipo: "ok" | "erro" = "ok", desfazer?: () => Promise<unknown> | unknown) => {
    const id = ++proximoToast;
    setToasts([{ id, msg, tipo, desfazer }]);   // só o aviso mais recente fica na tela
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tipo === "erro" ? 9000 : desfazer ? 9000 : 3500);
  }, []);
  const atualizar = useCallback(() => setVersao((v) => v + 1), []);

  const recarregarCadastros = useCallback(async (): Promise<unknown> => {
    const sb = getSupabase();
    const [c, o, f] = await Promise.all([
      sb.from("clientes").select("*").order("nome"),
      sb.from("oficinas").select("*").order("nome"),
      sb.from("fornecedores").select("*").order("nome"),
    ]);
    const erro = c.error ?? o.error ?? f.error;
    if (erro) { notify(msgErro(erro), "erro"); return erro; }
    setCad({ clientes: (c.data ?? []) as Cliente[], oficinas: (o.data ?? []) as Oficina[], fornecedores: (f.data ?? []) as Fornecedor[] });
    return null;
  }, [notify]);

  // Cópia automática semanal (feita ao abrir) e lembrete de baixar o backup a cada 30 dias.
  const cuidarDoBackup = useCallback(async () => {
    const sb = getSupabase();
    await sb.rpc("backup_se_preciso");
    const [d, p] = await Promise.all([
      sb.from("backup_log").select("criado_em").eq("tipo", "download").order("criado_em", { ascending: false }).limit(1),
      sb.from("backup_log").select("criado_em").order("criado_em").limit(1),
    ]);
    const ref = d.data?.[0]?.criado_em ?? p.data?.[0]?.criado_em;
    if (!ref) return;
    let adiado = 0;
    try { adiado = Number(localStorage.getItem("backup_aviso_ate")) || 0; } catch { /* ignora */ }
    const dias = Math.floor((Date.now() - new Date(ref).getTime()) / 86_400_000);
    setBackupDias(dias >= 30 && Date.now() > adiado ? dias : null);
  }, []);

  useEffect(() => {
    if (semConfig) return;
    const sb = getSupabase();
    let ativo = true;
    (async () => {
      const { data, error } = await sb.auth.getSession();
      if (error && ehFalhaDeConexao(error)) { if (ativo) setFalha({ conexao: true, msg: error.message }); return; }
      if (!data.session) { router.replace("/login"); return; }
      const erro = ativo ? await recarregarCadastros() : null;
      if (!ativo) return;
      if (erro) { setFalha({ conexao: ehFalhaDeConexao(erro), msg: (erro as { message?: string }).message ?? String(erro) }); return; }
      registrarAcesso();
      cuidarDoBackup().catch(() => { /* não atrapalha o uso */ });
    })();
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => { if (!s) router.replace("/login"); });
    return () => { ativo = false; sub.subscription.unsubscribe(); };
  }, [router, semConfig, recarregarCadastros, cuidarDoBackup]);

  useEffect(() => {
    const ok = () => setBackupDias(null);
    window.addEventListener("backup-baixado", ok);
    return () => window.removeEventListener("backup-baixado", ok);
  }, []);

  // Voltou para o app (trocou de aba / desbloqueou o celular): recarrega os dados.
  useEffect(() => {
    let ultima = Date.now();
    const vis = () => { if (document.visibilityState === "visible" && Date.now() - ultima > 60_000) atualizar(); ultima = Date.now(); };
    document.addEventListener("visibilitychange", vis);
    return () => document.removeEventListener("visibilitychange", vis);
  }, [atualizar]);

  const valor = useMemo<AppCtx | null>(() => (cad ? {
    sb: getSupabase(), notify, cad, recarregarCadastros, versao, atualizar,
    abrirCarro: (id) => setCarro(id),
    novoPedido: (p) => setNovo(p ?? {}),
    abrirCobranca: (id) => setCobranca(id),
    novaCobranca: (p) => setNovaCob(p ?? {}),
  } : null), [cad, notify, recarregarCadastros, versao, atualizar]);

  if (semConfig) {
    return (
      <div className="mx-auto max-w-lg space-y-2 p-8 text-sm text-neutral-700">
        <h1 className="text-lg font-semibold">Falta ligar o sistema ao Supabase</h1>
        <p>Abra o arquivo <code>src/lib/config.ts</code> no GitHub e cole a <b>Project URL</b> e a <b>chave publishable</b> do seu projeto do Supabase (passo 3 do <code>SETUP.md</code>).</p>
      </div>
    );
  }
  if (falha?.conexao) return <ForaDoAr detalhe={falha.msg} />;
  if (falha) {
    return (
      <div className="mx-auto max-w-lg space-y-2 p-8 text-sm text-neutral-700">
        <h1 className="text-lg font-semibold">Não consegui carregar o sistema</h1>
        <p className="break-words">{msgErro({ message: falha.msg })}</p>
        <p className="text-neutral-500">Se acabou de instalar ou atualizar, confira se rodou todos os arquivos SQL do SETUP.md no Supabase.</p>
        <button className="rounded-lg bg-red-900 px-3 py-2 text-white" onClick={() => window.location.reload()}>Tentar de novo</button>
      </div>
    );
  }
  if (!valor) return <Carregando />;
  const sair = async () => { await valor.sb.auth.signOut(); router.replace("/login"); };
  const ativoNav = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <Ctx.Provider value={valor}>
      <div className="min-h-dvh bg-[#F6F6F3] md:pl-52">
        <aside className="fixed inset-y-0 left-0 hidden w-52 flex-col border-r border-neutral-200 bg-white md:flex">
          <div className="px-5 py-5">
            <div className="text-sm font-bold tracking-tight text-red-900">MV Peças</div>
            <div className="text-xs text-neutral-500">Pedidos de peças</div>
          </div>
          <div className="px-3 pb-3">
            <button onClick={() => valor.novoPedido()} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-red-900 px-3 py-2 text-sm font-medium text-white hover:bg-red-800"><Plus size={16} /> Novo pedido</button>
          </div>
          <nav className="flex-1 space-y-0.5 px-3">
            {NAV.filter((n) => !n.soCelular).map((n) => (
              <Link key={n.href} href={n.href} className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm ${ativoNav(n.href) ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100"}`}>
                <n.icon size={16} /> {n.label}
              </Link>
            ))}
          </nav>
          <button onClick={sair} className="m-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-100"><LogOut size={16} /> Sair</button>
        </aside>

        <main className="mx-auto max-w-6xl px-3 pb-28 pt-4 sm:px-4 md:pb-10 md:pt-5">
          {backupDias !== null && pathname !== "/ajustes" ? (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <Download size={15} className="shrink-0" />
              <span className="min-w-0 flex-1">Faz {backupDias} dias que ninguém baixa o backup.</span>
              <Link href="/ajustes#backup" className="rounded-md bg-amber-900 px-2.5 py-1 text-xs font-medium text-white">Baixar agora</Link>
              <button className="rounded-md px-2 py-1 text-xs text-amber-900 hover:bg-amber-100" onClick={() => {
                try { localStorage.setItem("backup_aviso_ate", String(Date.now() + 7 * 86_400_000)); } catch { /* ignora */ }
                setBackupDias(null);
              }}>Depois</button>
            </div>
          ) : null}
          {children}
        </main>

        <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-neutral-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
          {NAV.filter((n) => !n.soDesktop).slice(0, 2).map((n) => <ItemNav key={n.href} n={n} ativo={ativoNav(n.href)} />)}
          <button onClick={() => valor.novoPedido()} className="flex flex-col items-center gap-0.5 py-1.5 text-[11px] font-medium text-red-900" aria-label="Novo pedido">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-red-900 text-white"><Plus size={20} /></span> Novo
          </button>
          {NAV.filter((n) => !n.soDesktop).slice(2).map((n) => <ItemNav key={n.href} n={n} ativo={ativoNav(n.href)} />)}
        </nav>

        <div className="pointer-events-none fixed inset-x-0 top-3 z-[70] flex flex-col items-center gap-2 px-4">
          {toasts.map((t) => (
            <div key={t.id} className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-lg px-4 py-2.5 text-sm shadow-lg ${t.tipo === "erro" ? "bg-red-700 text-white" : "bg-neutral-900 text-white"}`}>
              <span className="min-w-0">{t.msg}</span>
              {t.desfazer ? (
                <button className="shrink-0 rounded-md bg-white/15 px-2.5 py-1 text-xs font-semibold hover:bg-white/25" onClick={async () => {
                  setToasts((x) => x.filter((y) => y.id !== t.id));
                  try { await t.desfazer!(); notify("Desfeito."); } catch (e) { notify(msgErro(e), "erro"); }
                  atualizar();
                }}>Desfazer</button>
              ) : null}
            </div>
          ))}
        </div>

        {carro ? <CarroModal id={carro} onClose={() => setCarro(null)} /> : null}
        {novo ? <NovoPedido preset={novo} onClose={() => setNovo(null)} onCriado={(id) => { setNovo(null); setCarro(id); }} /> : null}
        {novaCob ? <NovaCobranca preset={novaCob} onClose={() => setNovaCob(null)} onCriada={(id) => { setNovaCob(null); setCobranca(id); }} /> : null}
        {cobranca ? <CobrancaModal id={cobranca} onClose={() => setCobranca(null)} /> : null}
      </div>
    </Ctx.Provider>
  );
}

function ItemNav({ n, ativo }: { n: (typeof NAV)[number]; ativo: boolean }) {
  return (
    <Link href={n.href} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${ativo ? "font-semibold text-red-900" : "text-neutral-500"}`}>
      <n.icon size={19} /> {n.label}
    </Link>
  );
}

function Carregando() {
  const [demorando, setDemorando] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDemorando(true), 5000); return () => clearTimeout(t); }, []);
  return (
    <div className="grid min-h-dvh place-items-center px-6 text-center text-sm text-neutral-500">
      <div>Carregando…{demorando ? <p className="mt-2 text-xs">Está demorando: conferindo a conexão com o banco…</p> : null}</div>
    </div>
  );
}
