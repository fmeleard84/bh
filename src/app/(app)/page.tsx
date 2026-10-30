import { requireUser } from "@/server/auth";
import { asUser } from "@/server/db";

export const dynamic = "force-dynamic";

/**
 * Ma journée : la seule page d'accueil. Pas de liste de leads, une file de
 * décisions préparées (réponses à traiter, brouillons à valider, appels prêts).
 */
export default async function MaJournee() {
  const user = await requireUser();
  const { reponses, aContacter } = await asUser(user.id, async (sql) => {
    const reponses = await sql`select * from hub.v_a_traiter limit 50`;
    const [{ n }] = await sql`select count(*)::int as n from hub.v_a_contacter`;
    return { reponses, aContacter: n as number };
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Ma journée</h1>
        <p className="muted text-sm">Ce qui attend une décision humaine, préparé et classé.</p>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        <Tuile titre="Réponses à traiter" valeur={reponses.length} />
        <Tuile titre="Comptes prêts à contacter" valeur={aContacter} />
        <Tuile titre="Appels préparés" valeur={0} />
      </section>

      <section className="card p-5">
        <h2 className="font-semibold mb-3">Réponses</h2>
        {reponses.length === 0 ? (
          <p className="muted text-sm">Aucune réponse en attente. Les réponses arriveront ici classées, avec un brouillon, dès le lot 3.</p>
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
