import { notFound, redirect } from "next/navigation";
import { peutPiloter, requireUser } from "@/server/auth";
import { asUser, sysSql } from "@/server/db";
import { enqueue } from "@/server/queue";
import { Reglages } from "./reglages";

async function lancer(form: FormData) {
  "use server";
  const user = await requireUser();
  const code = String(form.get("code"));
  if (!(await peutPiloter(user, code))) throw new Error("Réservé au responsable de la ligne.");
  if (form.get("flux") === "sourcer") {
    await enqueue("sourcer", { ligne: code }, code);
  } else {
    const rows = await sysSql()`select e.siren from hub.entreprises e join hub.ciblages c on c.siren = e.siren
                                where c.ligne_code = ${code} and e.site_verifie_le is null`;
    for (const r of rows) await enqueue("resoudre", { siren: r.siren }, r.siren);
  }
  redirect("/pilotage");
}

export const dynamic = "force-dynamic";

export default async function FicheLigne({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const user = await requireUser();
  const [l] = await asUser(user.id, (sql) => sql`select * from hub.lignes where code = ${code}`);
  if (!l) notFound();
  const grille = l.grille_signal as { critere: string; points: number }[];
  const pilote = await peutPiloter(user, code);

  return (
    <div className="space-y-6">
      <header>
        <div className="muted text-sm">{l.marque} · {l.societe_expeditrice}</div>
        <h1 className="text-2xl font-bold">{l.nom}</h1>
        {pilote && (
          <div className="flex gap-2 mt-3 flex-wrap">
            <form action={lancer}><input type="hidden" name="code" value={code} /><input type="hidden" name="flux" value="sourcer" /><button className="btn">Sourcer (F1)</button></form>
            <form action={lancer}><input type="hidden" name="code" value={code} /><input type="hidden" name="flux" value="resoudre" /><button className="btn">Résoudre les sites (F2)</button></form>
          </div>
        )}
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="card p-5">
          <h2 className="font-semibold mb-3">Cible</h2>
          <dl className="text-sm space-y-2 text-2">
            <div>NAF : {l.naf.join(", ") || "par technologie"}</div>
            <div>Départements : {l.departements.join(", ") || "France"}</div>
            <div>Tranches d'effectif : {l.effectif_min} à {l.effectif_max}</div>
            <div>Classes retenues : {l.classes_retenues.join(", ")}</div>
          </dl>
        </div>
        <div className="card p-5">
          <h2 className="font-semibold mb-3">Grille v{l.grille_version} · seuil {l.seuil_score}</h2>
          <ul className="text-sm space-y-1">
            {grille.map((c) => (
              <li key={c.critere} className="flex justify-between gap-4"><span className="text-2">{c.critere}</span><strong>+{c.points}</strong></li>
            ))}
          </ul>
        </div>
        <div className="card p-5">
          <h2 className="font-semibold mb-3">Accroche</h2>
          <p className="text-sm text-2">« {l.constat_type} »</p>
          <p className="text-sm mt-3"><span className="muted">Offre d'entrée :</span> {l.offre_entree}</p>
        </div>
        <div className="card p-5">
          <h2 className="font-semibold mb-3">Envoi</h2>
          <dl className="text-sm space-y-2 text-2">
            <div>Canaux : {l.canaux_autorises.join(", ")}</div>
            <div>Domaines d'envoi : {l.domaines_envoi.join(", ") || "à déposer"}</div>
            <div>Quotas : {Object.entries(l.quotas as Record<string, number>).map(([k, v]) => `${k.replaceAll("_", " ")} ${v}`).join(" · ")}</div>
          </dl>
        </div>
      </section>
      {pilote && <Reglages l={l} superAdmin={user.superAdmin} />}
    </div>
  );
}
