import { requireUser } from "@/server/auth";
import { asUser } from "@/server/db";

export const dynamic = "force-dynamic";

export default async function Conformite() {
  const user = await requireUser();
  const motifs = await asUser(user.id, (sql) => sql`select motif, count(*)::int as n from hub.suppression group by motif order by n desc`);
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Conformité</h1>
        <p className="muted text-sm">Liste de suppression du groupe : vérifiée avant chaque envoi, jamais purgée.</p>
      </header>
      <section className="card p-5">
        <h2 className="font-semibold mb-3">Suppression</h2>
        {motifs.length === 0 ? <p className="muted text-sm">Aucune entrée.</p> : (
          <ul className="text-sm space-y-1">{motifs.map((m) => <li key={m.motif} className="flex justify-between max-w-xs"><span>{m.motif}</span><strong>{m.n}</strong></li>)}</ul>
        )}
      </section>
    </div>
  );
}
