"use client";

import { KeyRound, LogOut } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useApp } from "@/components/AppShell";
import { Backup } from "@/components/Backup";
import { Lixeira } from "@/components/Lixeira";

export default function Ajustes() {
  const { sb } = useApp();
  const router = useRouter();
  useEffect(() => {
    const h = window.location.hash;
    if (h) setTimeout(() => document.querySelector(h)?.scrollIntoView({ behavior: "smooth" }), 300);
  }, []);
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Ajustes</h1>
      <Backup />
      <Lixeira />
      <section className="rounded-xl border border-neutral-200 bg-white">
        <h2 className="border-b border-neutral-100 px-4 py-2.5 text-sm font-semibold">Minha conta</h2>
        <div className="flex flex-wrap gap-2 p-4">
          <Link href="/nova-senha" className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium"><KeyRound size={15} /> Trocar minha senha</Link>
          <button onClick={async () => { await sb.auth.signOut(); router.replace("/login"); }} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700"><LogOut size={15} /> Sair</button>
        </div>
      </section>
    </div>
  );
}
