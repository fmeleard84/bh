import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth";
import { asUser } from "@/server/db";
import { marqueCourante } from "@/server/marque";
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
  const marque = await marqueCourante(user.id);
  const code = marque?.code ?? null;
  const { entonnoir, runs, rapports, connecteurs, depense } = await asUser(user.id, async (sql) => ({
    connecteurs: await sql`select * from hub.connecteurs order by plateforme, usage, principal desc, priorite`,
    depense: Number((await sql`select coalesce(sum(cout_cents), 0) as c from hub.consommation
                               where service = 'apify' and jour >= date_trunc('month', current_date)`)[0].c),
    entonnoir: await sql`select l.code, l.nom, e.statut, coalesce(e.comptes, 0) as comptes
                         from hub.lignes l left join hub.v_entonnoir e on e.ligne_code = l.code
                         ${code ? sql`where l.code = ${code}` : sql``} order by l.code`,
    // Une exécution sans ligne (F2, toutes lignes confondues) reste visible dans chaque société.
    runs: await sql`select * from hub.runs ${code ? sql`where ligne_code = ${code} or ligne_code is null` : sql``} order by debut_le desc limit 30`,
    rapports: await sql`select distinct on (r.ligne_code) r.*, l.nom from hub.rapports r join hub.lignes l on l.code = r.ligne_code
                        ${code ? sql`where r.ligne_code = ${code}` : sql``} order by r.ligne_code, r.cree_le desc`,
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
        <div className="muted text-sm">{marque ? marque.marque : "Vue d'ensemble"}</div>
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
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <h2 className="font-semibold">Connecteurs de veille (Apify)</h2>
          <span className="text-sm muted">
            Ce mois : {(depense / 100).toFixed(2)} $ sur {(Number(process.env.APIFY_PLAFOND_CENTS ?? 2000) / 100).toFixed(0)} $
            {!process.env.APIFY_API_KEY && <span className="pill pill-off ml-2">clé APIFY_API_KEY absente</span>}
          </span>
        </div>
        <table className="text-sm w-full">
          <thead><tr className="muted text-left"><th>Usage</th><th>Robot</th><th>Rôle</th><th>Dernier test</th><th className="text-right">Coût / élément</th></tr></thead>
          <tbody>
            {connecteurs.map((c) => (
              <tr key={c.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                <td className="py-2">{c.plateforme} · {c.usage}</td>
                <td><code>{c.robot}</code></td>
                <td>{c.principal ? "principal" : `secours ${c.priorite}`}{c.actif ? "" : " · inactif"}</td>
                <td>
                  {c.dernier_test_le ? (
                    <span className={`pill ${c.dernier_test_statut === "ok" ? "pill-ok" : "pill-off"}`} title={c.dernier_test_erreur ?? ""}>
                      {c.dernier_test_statut} · {new Date(c.dernier_test_le).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}
                    </span>
                  ) : <span className="muted">jamais testé</span>}
                </td>
                <td className="text-right tabular-nums">{c.cout_unitaire_cents != null ? `${Number(c.cout_unitaire_cents).toFixed(3)} c` : "—"}</td>
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
