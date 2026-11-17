"use client";

import { Truck, BarChart3, ChevronRight, Download, KeyRound, LogOut, Settings, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useApp } from "@/components/AppShell";

export default function Mais() {
  const { sb } = useApp();
  const router = useRouter();
  const itens = [
    { href: "/envios", label: "Envios (relatório do entregador)", icon: Truck },
    { href: "/relatorios", label: "Relatórios", icon: BarChart3 },
    { href: "/cadastros", label: "Clientes, oficinas e fornecedores", icon: Users },
    { href: "/ajustes#backup", label: "Backup", icon: Download },
    { href: "/ajustes#lixeira", label: "Lixeira", icon: Trash2 },
    { href: "/ajustes", label: "Ajustes", icon: Settings },
    { href: "/nova-senha", label: "Trocar minha senha", icon: KeyRound },
  ];
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Mais</h1>
      <ul className="divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-white">
        {itens.map((i) => (
          <li key={i.href}><Link href={i.href} className="flex items-center gap-3 px-4 py-3 text-sm"><i.icon size={18} /> {i.label}<ChevronRight size={16} className="ml-auto text-neutral-400" /></Link></li>
        ))}
        <li><button onClick={async () => { await sb.auth.signOut(); router.replace("/login"); }} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-red-700"><LogOut size={18} /> Sair</button></li>
      </ul>
    </div>
  );
}
