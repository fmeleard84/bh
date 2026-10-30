import Link from "next/link";
import { requireUser } from "@/server/auth";
import { asUser } from "@/server/db";

export const dynamic = "force-dynamic";

/**
 * Ma journée : la seule page d'accueil. Pas de liste de leads, une file de
 * décisions préparées (réponses à traiter, comptes qualifiés, appels prêts).
 */
export default async function MaJournee() {
  const user = await requireUser();
  const { reponses, aContacter, qualifies } = await asUser(user.id, async (sql) => {
    const reponses = await sql`select * from hub.v_a_traiter limit 50`;
    const [{ n }] = await sql`select count(*)::int as n from hub.v_a_contacter`;
    const qualifies = await sql`
      select c.siren, c.ligne_code, c.score_total, e.nom, e.commune, e.site_url, s.classe_activite, s.constats, l.nom as ligne,
        (select json_agg(json_build_object('nom', coalesce(ct.prenom || ' ', '') || ct.nom, 'email', case when ct.email_statut = 'valide' then ct.email end,
                 'generique', case when ct.email_statut = 'generique' then ct.email end, 'mobile', ct.telephone_mobile, 'linkedin', ct.linkedin_url))
         from hub.contacts ct where ct.siren = c.siren and ct.role_cible and not ct.opt_out) as contacts
      from hub.ciblages c
      join hub.entreprises e on e.siren = c.siren
      join hub.lignes l on l.code = c.ligne_code
      join hub.scores s on s.siren = c.siren and s.ligne_code = c.ligne_code and s.version_grille = l.grille_version
      where c.statut = 'qualifie'
      order by c.score_total desc limit 10`;
    return { reponses, aContacter: n as number, qualifies };
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Ma journée</h1>
        <p className="muted text-sm">Ce qui attend une décision humaine, préparé et classé.</p>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        <Tuile titre="Réponses à traiter" valeur={reponses.length} />
        <Tuile titre="Comptes qualifiés" valeur={qualifies.length} />
        <Tuile titre="Prêts pour une séquence email" valeur={aContacter} />
      </section>

      <section className="card p-5">
        <h2 className="font-semibold mb-3">Réponses</h2>
        {reponses.length === 0 ? (
          <p className="muted text-sm">Aucune réponse en attente. Elles arriveront ici classées, avec un brouillon, dès le lot 3.</p>
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {reponses.map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex gap-2 items-center"><span className="pill">{r.classe_reponse}</span><strong>{r.entreprise}</strong><span className="muted text-sm">{r.prenom} {r.nom}</span></div>
                <p className="text-2 text-sm mt-1">{r.resume}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Comptes qualifiés, du plus prometteur au moins prometteur</h2>
        {qualifies.length === 0 && <p className="muted text-sm card p-5">Aucun compte qualifié pour l'instant.</p>}
        {qualifies.map((q) => (
          <article key={`${q.siren}:${q.ligne_code}`} className="card p-5 text-sm space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/comptes/${q.siren}`} className="font-semibold text-base hover:underline">{q.nom}</Link>
              <span className="muted">{q.commune}</span>
              <span className="pill pill-ok">{q.score_total}</span>
              <span className="pill">{q.classe_activite}</span>
              <span className="muted text-xs">{q.ligne}</span>
            </div>
            <ol className="list-decimal ml-5 text-2 space-y-0.5">
              {(q.constats as { texte: string; preuve_url: string }[]).map((c) => (
                <li key={c.texte}>{c.texte} <a className="muted text-xs underline" href={c.preuve_url} target="_blank" rel="noreferrer">preuve</a></li>
              ))}
            </ol>
            <div className="flex flex-wrap gap-2">
              {((q.contacts ?? []) as { nom: string; email: string | null; generique: string | null; mobile: string | null; linkedin: string | null }[]).map((c) => (
                <span key={c.nom} className="pill">
                  {c.nom}
                  {c.email ? ` · ${c.email}` : c.generique ? ` · ${c.generique} (générique)` : ""}
                  {c.mobile ? ` · ${c.mobile}` : ""}
                  {c.linkedin ? " · LinkedIn" : ""}
                </span>
              ))}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function Tuile({ titre, valeur }: { titre: string; valeur: number }) {
  return (
    <div className="card p-4">
      <div className="muted text-sm">{titre}</div>
      <div className="text-3xl font-bold mt-1">{valeur}</div>
    </div>
  );
}
