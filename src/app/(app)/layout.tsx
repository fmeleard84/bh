import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarCheck, SlidersHorizontal, Building2, Activity, ShieldCheck, LogOut } from "lucide-react";
import { logout, requireUser } from "@/server/auth";

const NAV = [
  { href: "/", label: "Ma journée", icon: CalendarCheck },
  { href: "/lignes", label: "Lignes", icon: SlidersHorizontal },
  { href: "/comptes", label: "Comptes", icon: Building2 },
  { href: "/pilotage", label: "Pilotage", icon: Activity },
  { href: "/conformite", label: "Conformité", icon: ShieldCheck },
];

async function deconnexion() {
  "use server";
  await logout();
  redirect("/login");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="min-h-screen md:flex">
      <aside className="md:w-56 md:min-h-screen border-b md:border-b-0 md:border-r p-4 flex md:flex-col gap-1" style={{ borderColor: "var(--border)" }}>
        <div className="font-bold text-lg mr-4 md:mr-0 md:mb-6">BH</div>
        <nav className="flex md:flex-col gap-1 overflow-x-auto">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm whitespace-nowrap hover:bg-[var(--surface-2)]">
              <Icon size={16} /> {label}
            </Link>
          ))}
        </nav>
        <form action={deconnexion} className="md:mt-auto ml-auto md:ml-0">
          <div className="muted text-xs mb-2 hidden md:block">{user.nom}</div>
          <button className="flex items-center gap-2 text-sm muted" type="submit"><LogOut size={14} /> Sortir</button>
        </form>
      </aside>
      <main className="flex-1 min-w-0 px-4 py-4 md:px-[10%] md:py-8">{children}</main>
    </div>
  );
}
