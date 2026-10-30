import Link from "next/link";
import { requireUser } from "@/server/auth";
import { asUser } from "@/server/db";

export const dynamic = "force-dynamic";

export default async function Lignes() {
  const user = await requireUser();
  const lignes = await asUser(user.id, (sql) => sql`
    select l.*, u.nom as proprietaire,
      (select coalesce(json_object_agg(statut, comptes), '{}') from hub.v_entonnoir e where e.ligne_code = l.code) as entonnoir
    from hub.lignes l left join hub.utilisateurs u on u.id = l.proprietaire_id
    order by l.code`);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Lignes</h1>
        <p className="muted text-sm">Une ligne = une fiche de configuration. Aucune brique ne change d'une marque à l'autre.</p>
      </header>
      <div className="grid gap-4 md:grid-cols-3">
        {lignes.map((l) => (
          <Link key={l.code} href={`/lignes/${l.code}`} className="card p-5 block hover:border-[var(--accent)]">
            <div className="flex justify-between items-start gap-2">
              <div>
                <div className="muted text-xs">{l.marque}</div>
                <div className="font-semibold">{l.nom}</div>
              </div>
              <span className={`pill ${l.active ? "pill-ok" : "pill-off"}`}>{l.active ? "active" : "inactive"}</span>
            </div>
            <dl className="text-sm mt-4 space-y-1 text-2">
              <div>Seuil : <strong>{l.seuil_score}</strong> · grille v{l.grille_version}</div>
              <div>NAF : {l.naf.join(", ") || "—"}</div>
              <div>Départements : {l.departements.length || "France"}</div>
              <div>Canaux : {l.canaux_autorises.join(", ")}</div>
              <div>Comptes : {Object.values(l.entonnoir as Record<string, number>).reduce((a, b) => a + b, 0)}</div>
            </dl>
          </Link>
        ))}
      </div>
    </div>
  );
}
