import Link from "next/link";
import { requireUser } from "@/server/auth";
import { asUser } from "@/server/db";
import { ecarter, regenerer, reponseTraitee, tacheFaite, valider } from "./actions";

export const dynamic = "force-dynamic";

const ETAPE: Record<number, string> = { 0: "J0", 2: "J2", 3: "J3", 7: "J7", 14: "J14" };
const TACHE: Record<string, string> = {
  linkedin_invitation: "Invitation LinkedIn", linkedin_message: "Message LinkedIn", appel: "Appel", courrier: "Courrier", repondre: "Répondre",
};

/**
 * Ma journée : la seule page d'accueil. Une file de décisions préparées, dans
 * l'ordre où elles rapportent : réponses, tâches du jour, brouillons à valider.
 */
export default async function MaJournee() {
  const user = await requireUser();
  const { reponses, taches, brouillons, qualifies } = await asUser(user.id, async (sql) => ({
    reponses: await sql`select * from hub.v_a_traiter limit 50`,
    taches: await sql`
      select t.*, e.nom as entreprise, ct.prenom, ct.nom, ct.linkedin_url,
             coalesce(ct.telephone_mobile, ct.telephone_fixe, e.telephone) as telephone
      from hub.taches t join hub.entreprises e on e.siren = t.siren left join hub.contacts ct on ct.id = t.contact_id
      where t.fait_le is null and t.echeance < now() + interval '1 day' order by t.echeance limit 50`,
    brouillons: await sql`select * from hub.v_brouillons limit 20`,
    qualifies: await sql`select count(*)::int as n from hub.ciblages where statut = 'qualifie'`,
  }));

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold">Ma journée</h1>
        <p className="muted text-sm">Ce qui attend une décision humaine, préparé et classé.</p>
      </header>

      <section className="grid gap-4 sm:grid-cols-4">
        <Tuile titre="Réponses à traiter" valeur={reponses.length} />
        <Tuile titre="Tâches du jour" valeur={taches.length} />
        <Tuile titre="Séquences à valider" valeur={brouillons.length} />
        <Tuile titre="Comptes qualifiés" valeur={qualifies[0].n} />
      </section>

      {/* ─── Réponses ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="font-semibold">Réponses</h2>
        {reponses.length === 0 && <p className="muted text-sm card p-5">Aucune réponse en attente.</p>}
        {reponses.map((r) => (
          <article key={r.id} className="card p-5 text-sm space-y-2">
            <div className="flex flex-wrap gap-2 items-center">
              <span className="pill">{r.classe_reponse}</span>
              <Link href={`/comptes/${r.siren}`} className="font-semibold hover:underline">{r.entreprise}</Link>
              <span className="muted">{r.prenom} {r.nom}</span>
            </div>
            <p className="text-2">{r.resume}</p>
            {r.brouillon_reponse && (
              <details>
                <summary className="cursor-pointer muted">Réponse préparée</summary>
                <pre className="whitespace-pre-wrap mt-2 p-3 rounded-lg" style={{ background: "var(--surface-2)" }}>{r.brouillon_reponse}</pre>
              </details>
            )}
            <form action={reponseTraitee} className="flex gap-2">
              <input type="hidden" name="echange" value={r.id} />
              <button name="issue" value="opportunite" className="btn">Opportunité</button>
              <button name="issue" value="traite" className="pill">Traitée</button>
            </form>
          </article>
        ))}
      </section>

      {/* ─── Tâches ───────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="font-semibold">Tâches du jour</h2>
        {taches.length === 0 && <p className="muted text-sm card p-5">Aucune tâche aujourd'hui.</p>}
        {taches.map((t) => (
          <article key={t.id} className="card p-5 text-sm space-y-2">
            <div className="flex flex-wrap gap-2 items-center">
              <span className="pill">{TACHE[t.type] ?? t.type}</span>
              <Link href={`/comptes/${t.siren}`} className="font-semibold hover:underline">{t.entreprise}</Link>
              <span className="muted">{t.prenom} {t.nom}</span>
              {t.type.startsWith("linkedin") && t.linkedin_url && <a className="underline" href={t.linkedin_url} target="_blank" rel="noreferrer">profil</a>}
              {t.type === "appel" && t.telephone && <a className="underline" href={`tel:${t.telephone.replace(/\s/g, "")}`}>{t.telephone}</a>}
            </div>
            <pre className="whitespace-pre-wrap p-3 rounded-lg" style={{ background: "var(--surface-2)" }}>{t.contenu}</pre>
            <form action={tacheFaite} className="flex flex-wrap gap-2">
              <input type="hidden" name="tache" value={t.id} />
              <button name="resultat" value="fait" className="btn">Fait</button>
              <button name="resultat" value="sans suite" className="pill">Sans suite</button>
            </form>
          </article>
        ))}
      </section>

      {/* ─── Brouillons ───────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="font-semibold">Séquences à valider</h2>
        <p className="muted text-sm">Relisez, retouchez si besoin, validez : BH planifie l'envoi dans la fenêtre 8 h - 18 h et crée les tâches LinkedIn et appel.</p>
        {brouillons.length === 0 && <p className="muted text-sm card p-5">Aucune séquence en attente.</p>}
        {brouillons.map((b) => (
          <article key={b.sequence_id} className="card p-5 text-sm space-y-3">
            <div className="flex flex-wrap gap-2 items-center">
              <Link href={`/comptes/${b.siren}`} className="font-semibold text-base hover:underline">{b.entreprise}</Link>
              <span className="muted">{b.prenom} {b.nom}{b.email ? ` · ${b.email}` : ""}</span>
              <span className="pill">{b.gabarit}</span>
              {b.score_total != null && <span className="pill pill-ok">{b.score_total}</span>}
            </div>
            <form action={valider} className="space-y-3">
              <input type="hidden" name="sequence" value={b.sequence_id} />
              {(b.messages as { id: string; etape: number; objet: string | null; corps: string; controle: { ok?: boolean; defauts?: string[] } }[]).map((m) => (
                <div key={m.id} className="space-y-1">
                  <div className="flex gap-2 items-center">
                    <strong>{ETAPE[m.etape] ?? `J${m.etape}`}</strong>
                    {m.controle?.ok === false && <span className="pill pill-off">{m.controle.defauts?.join(" · ")}</span>}
                  </div>
                  {m.objet !== null && <input className="input" name={`objet:${m.id}`} defaultValue={m.objet} />}
                  <textarea className="input" name={`corps:${m.id}`} defaultValue={m.corps} rows={Math.min(10, Math.ceil(m.corps.length / 90) + 1)} />
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <button className="btn" type="submit">Valider la séquence</button>
                <button formAction={regenerer} className="pill" type="submit">Régénérer</button>
                <button formAction={ecarter} className="pill" type="submit">Écarter ce compte</button>
              </div>
            </form>
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
