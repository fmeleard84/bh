import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth";
import { asUser } from "@/server/db";
import { queue } from "@/server/queue";

async function genererRapports() {
  "use server";
  const user = await requireUser();
  if (!user.superAdmin) throw new Error("Réservé à l'administrateur.");
  await queue("pilotage").add("f8-hebdo", {}, { removeOnComplete: 50 });
  revalidatePath("/pilotage");
}

export const dynamic = "force-dynamic";

const STATUTS = ["source", "enrichi", "qualifie", "ecarte", "en_sequence", "repondu", "opportunite", "client"];

export default async function Pilotage() {
  const user = await requireUser();
  const { entonnoir, runs, rapports } = await asUser(user.id, async (sql) => ({
    entonnoir: await sql`select l.code, l.nom, e.statut, coalesce(e.comptes, 0) as comptes
                         from hub.lignes l left join hub.v_entonnoir e on e.ligne_code = l.code order by l.code`,
    runs: await sql`select * from hub.runs order by debut_le desc limit 30`,
    rapports: await sql`select distinct on (r.ligne_code) r.*, l.nom from hub.rapports r join hub.lignes l on l.code = r.ligne_code
                        order by r.ligne_code, r.cree_le desc`,
  }));

  const parLigne = new Map<string, { nom: string; s: Record<string, number> }>();
  for (const r of entonnoir) {
    const x = parLigne.get(r.code) ?? { nom: r.nom as string, s: {} as Record<string, number> };
    if (r.statut) x.s[r.statut as string] = r.comptes as number;
    parLigne.set(r.code, x);
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Pilotage</h1>
        <p className="muted text-sm">Rapport hebdomadaire par ligne (lundi 7 h), entonnoir et santé des flux.</p>
      </header>

      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold">Rapports de la semaine</h2>
          <form action={genererRapports}><button className="pill" type="submit">Générer maintenant</button></form>
        </div>
        {rapports.length === 0 && <p className="muted text-sm card p-5">Aucun rapport pour l'instant.</p>}
        <div className="grid gap-4 md:grid-cols-3">
          {rapports.map((r) => (
            <article key={r.id} className="card p-5 text-sm space-y-2">
              <div className="flex justify-between"><strong>{r.nom}</strong><span className="muted">{r.semaine}</span></div>
              {(r.alertes as string[]).map((a) => <div key={a} className="pill pill-off">{a}</div>)}
              <p className="text-2 whitespace-pre-line">{r.resume}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card p-5 overflow-x-auto">
        <h2 className="font-semibold mb-3">Entonnoir</h2>
        <table className="text-sm w-full">
          <thead><tr className="muted text-left"><th className="py-1 pr-4">Ligne</th>{STATUTS.map((s) => <th key={s} className="pr-3 text-right">{s.replace("_", " ")}</th>)}</tr></thead>
          <tbody>
            {[...parLigne].map(([code, { nom, s }]) => (
              <tr key={code} className="border-t" style={{ borderColor: "var(--border)" }}>
                <td className="py-2 pr-4">{nom}</td>
                {STATUTS.map((st) => <td key={st} className="pr-3 text-right tabular-nums">{s[st] ?? 0}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card p-5 overflow-x-auto">
        <h2 className="font-semibold mb-3">Exécutions des flux</h2>
        {runs.length === 0 ? <p className="muted text-sm">Aucune exécution pour l'instant.</p> : (
          <table className="text-sm w-full">
            <thead><tr className="muted text-left"><th>Flux</th><th>Ligne</th><th>Début</th><th>Statut</th><th className="text-right">Lus</th><th className="text-right">Écrits</th><th className="text-right">Erreurs</th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                  <td className="py-2">{r.flux}</td><td>{r.ligne_code ?? "—"}</td>
                  <td>{new Date(r.debut_le).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}</td>
                  <td><span className={`pill ${r.statut === "ok" ? "pill-ok" : r.statut === "erreur" ? "pill-off" : ""}`}>{r.statut}</span></td>
                  <td className="text-right">{r.lus}</td><td className="text-right">{r.ecrits}</td><td className="text-right">{r.erreurs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
