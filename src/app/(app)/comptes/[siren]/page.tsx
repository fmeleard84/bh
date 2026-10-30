import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth";
import { asUser } from "@/server/db";

export const dynamic = "force-dynamic";

/** Fiche compte : l'identité prouvée, les personnes, les faits et leur chronologie. */
export default async function FicheCompte({ params }: { params: Promise<{ siren: string }> }) {
  const { siren } = await params;
  const user = await requireUser();
  const data = await asUser(user.id, async (sql) => {
    const [e] = await sql`select * from hub.entreprises where siren = ${siren}`;
    if (!e) return null;
    return {
      e,
      ciblages: await sql`select c.*, l.nom as ligne from hub.ciblages c join hub.lignes l on l.code = c.ligne_code where c.siren = ${siren}`,
      contacts: await sql`select * from hub.contacts where siren = ${siren} order by role_cible desc, nom`,
      signaux: await sql`select * from hub.signaux where siren = ${siren} order by collecte_le desc`,
      scores: await sql`select s.*, l.nom as ligne, l.seuil_score from hub.scores s join hub.lignes l on l.code = s.ligne_code
                        where s.siren = ${siren} and s.version_grille = l.grille_version`,
      evenements: await sql`select * from hub.evenements where siren = ${siren} order by cree_le desc limit 50`,
    };
  });
  if (!data) notFound();
  const { e, ciblages, contacts, signaux, scores, evenements } = data;

  return (
    <div className="space-y-6">
      <header>
        <div className="muted text-sm">SIREN {e.siren} · NAF {e.naf} · créée le {e.date_creation ? new Date(e.date_creation).toLocaleDateString("fr-FR") : "?"}</div>
        <h1 className="text-2xl font-bold">{e.nom}</h1>
        <div className="flex gap-2 mt-2 flex-wrap">{ciblages.map((c) => <span key={c.id} className="pill">{c.ligne} : {c.statut}{c.score_total != null ? ` · ${c.score_total}` : ""}</span>)}</div>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="card p-5 space-y-2 text-sm">
          <h2 className="font-semibold">Identité</h2>
          <div className="text-2">{e.adresse}</div>
          <div className="text-2">Effectif : {e.tranche_effectif ?? "non renseigné"} · {e.nb_etablissements ?? "?"} établissement(s)</div>
          {e.enseignes.length > 0 && <div className="text-2">Enseignes : {e.enseignes.join(", ")}</div>}
          <div>
            Site :{" "}
            {e.site_verifie ? <><a className="underline" href={e.site_url} target="_blank" rel="noreferrer">{e.site_url}</a><div className="muted text-xs mt-1">Preuve : {e.site_preuve}</div></>
              : e.site_verifie_le ? <span className="muted">introuvable ou non prouvé</span> : <span className="muted">pas encore cherché</span>}
          </div>
          {e.telephone && <div>Téléphone : {e.telephone} <span className="muted text-xs">({e.telephone_source})</span></div>}
        </div>

        <div className="card p-5 text-sm">
          <h2 className="font-semibold mb-2">Personnes</h2>
          <ul className="space-y-2">
            {contacts.map((c) => (
              <li key={c.id}>
                <strong>{c.prenom} {c.nom}</strong> <span className="muted">{c.qualite}{c.annee_naissance ? ` · né(e) en ${c.annee_naissance}` : ""}</span>
                <div className="text-2 text-xs">
                  {c.email ? `${c.email} (${c.email_statut})` : "email : à trouver (lot 2)"}{c.linkedin_url ? ` · ${c.linkedin_url}` : ""}{c.opt_out ? " · OPPOSITION" : ""}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {scores.map((s) => (
        <section key={s.ligne_code} className="card p-5 text-sm space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <h2 className="font-semibold">Qualification · {s.ligne}</h2>
            <span className="pill">{s.classe_activite}</span>
            <span className={`pill ${s.score_total >= s.seuil_score ? "pill-ok" : ""}`}>{s.score_total} / seuil {s.seuil_score}</span>
            <span className="muted text-xs">fit {s.score_fit} · signal {s.score_signal} · {s.moteur}</span>
          </div>
          {(s.raisons.classe as string[]).map((r) => <p key={r} className="text-2">{r}</p>)}
          <div>
            <div className="muted text-xs mb-1">Constats (base de l'accroche)</div>
            <ol className="list-decimal ml-5 space-y-1">
              {(s.constats as { texte: string; preuve_url: string }[]).map((c) => (
                <li key={c.texte}>{c.texte} <a className="muted text-xs underline" href={c.preuve_url} target="_blank" rel="noreferrer">preuve</a></li>
              ))}
            </ol>
          </div>
          <div className="grid sm:grid-cols-2 gap-1">
            {(s.raisons.criteres as { critere: string; points: number; vrai: boolean }[]).map((c) => (
              <div key={c.critere} className={c.vrai ? "" : "muted"}>{c.vrai ? "✓" : "·"} {c.critere} <strong>{c.vrai ? `+${c.points}` : ""}</strong></div>
            ))}
          </div>
        </section>
      ))}

      <section className="card p-5 text-sm">
        <h2 className="font-semibold mb-2">Faits relevés</h2>
        {signaux.length === 0 ? <p className="muted">Aucun pour l'instant (lecture du site au lot 2).</p> : (
          <ul className="space-y-2">{signaux.map((s) => <li key={s.id}><span className="pill">{s.type}</span> {s.valeur} <a className="muted text-xs underline" href={s.preuve_url} target="_blank" rel="noreferrer">preuve</a></li>)}</ul>
        )}
      </section>

      <section className="card p-5 text-sm">
        <h2 className="font-semibold mb-2">Chronologie</h2>
        <ul className="space-y-1">
          {evenements.map((v) => (
            <li key={v.id} className="flex gap-3">
              <span className="muted tabular-nums whitespace-nowrap">{new Date(v.cree_le).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}</span>
              <span className="pill">{v.acteur}</span><span>{v.type.replaceAll("_", " ")}</span>
              {v.donnees?.preuve && <span className="muted truncate">{v.donnees.preuve}</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
