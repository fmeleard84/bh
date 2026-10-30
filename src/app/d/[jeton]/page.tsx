import { redirect } from "next/navigation";
import { desinscrire, lireJeton } from "@/server/flux/envoi";

export const dynamic = "force-dynamic";

/**
 * Désinscription publique (sans compte). Le lien de chaque message mène ici ;
 * le bouton confirme (un simple chargement de page, par un antivirus qui suit
 * les liens, ne désinscrit personne). Le désabonnement en un clic des
 * messageries (RFC 8058) passe par la route voisine /1clic.
 */
async function confirmer(form: FormData) {
  "use server";
  const jeton = String(form.get("jeton"));
  const id = lireJeton(jeton);
  if (id) await desinscrire(id, "lien de désinscription");
  redirect(`/d/${jeton}?ok=1`);
}

export default async function Desinscription({ params, searchParams }: { params: Promise<{ jeton: string }>; searchParams: Promise<{ ok?: string }> }) {
  const { jeton } = await params;
  const { ok } = await searchParams;
  const valide = lireJeton(jeton) !== null;
  return (
    <main className="min-h-screen grid place-items-center px-4">
      <div className="card w-full max-w-md p-6 space-y-4 text-sm">
        <h1 className="text-xl font-bold">Ne plus être contacté</h1>
        {!valide ? (
          <p>Ce lien n'est pas valide. Répondez simplement « STOP » au message reçu.</p>
        ) : ok ? (
          <p>C'est fait. Vous ne recevrez plus de message de notre part, quelle que soit la marque du groupe.</p>
        ) : (
          <form action={confirmer} className="space-y-3">
            <p>Vos coordonnées professionnelles ont été trouvées sur des sources publiques (site de votre société, registre des entreprises). Confirmez pour ne plus jamais être contacté.</p>
            <input type="hidden" name="jeton" value={jeton} />
            <button className="btn" type="submit">Confirmer</button>
          </form>
        )}
      </div>
    </main>
  );
}
