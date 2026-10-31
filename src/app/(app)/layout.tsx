import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CalendarCheck, SlidersHorizontal, Building2, Activity, ShieldCheck, LogOut, LayoutGrid } from "lucide-react";
import { logout, requireUser } from "@/server/auth";
import { COOKIE_MARQUE, marqueCourante, marques } from "@/server/marque";

const NAV = [
  { href: "/", label: "Ma journée", icon: CalendarCheck },
  { href: "/lignes", label: "Lignes", icon: SlidersHorizontal },
  { href: "/comptes", label: "Comptes", icon: Building2 },
  { href: "/pilotage", label: "Pilotage", icon: Activity },
  { href: "/conformite", label: "Conformité", icon: ShieldCheck },
];

/** Changer de société : tout BH se limite ensuite à elle, jusqu'au prochain choix. */
async function choisirMarque(form: FormData) {
  "use server";
  const code = String(form.get("code") ?? "");
  const jar = await cookies();
  if (code) jar.set(COOKIE_MARQUE, code, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 365 * 86400 });
  else jar.delete(COOKIE_MARQUE);
  redirect("/");
}

async function deconnexion() {
  "use server";
  await logout();
  redirect("/login");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [toutes, courante] = await Promise.all([marques(user.id), marqueCourante(user.id)]);
  return (
    <div className="min-h-screen md:flex">
      <aside className="md:w-56 md:min-h-screen border-b md:border-b-0 md:border-r p-4 flex md:flex-col gap-1" style={{ borderColor: "var(--border)" }}>
        <div className="font-bold text-lg mr-4 md:mr-0 md:mb-3">BH</div>
        <form action={choisirMarque} className="flex md:flex-col gap-1 mr-4 md:mr-0 md:mb-6 overflow-x-auto" aria-label="Société">
          <div className="muted text-xs uppercase tracking-wide hidden md:block mb-1">Société</div>
          {toutes.map((m) => (
            <button key={m.code} name="code" value={m.code} type="submit"
              className="text-left px-3 py-2 rounded-lg text-sm whitespace-nowrap hover:bg-[var(--surface-2)]"
              style={courante?.code === m.code ? { background: "var(--accent-soft)", color: "var(--accent)", fontWeight: 600 } : undefined}
              aria-current={courante?.code === m.code ? "true" : undefined}>
              {m.marque}
            </button>
          ))}
          <button name="code" value="" type="submit"
            className="text-left px-3 py-2 rounded-lg text-sm whitespace-nowrap flex items-center gap-2 hover:bg-[var(--surface-2)]"
            style={!courante ? { background: "var(--accent-soft)", color: "var(--accent)", fontWeight: 600 } : { color: "var(--muted)" }}>
            <LayoutGrid size={14} /> Vue d'ensemble
          </button>
        </form>
        <nav className="flex md:flex-col gap-1 overflow-x-auto">
          {NAV.map(({ href, label, icon }) => (href === "/lignes" && courante
            ? { href: `/lignes/${courante.code}`, label: "Réglages de la ligne", icon }
            : { href, label, icon })).map(({ href, label, icon: Icon }) => (
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
