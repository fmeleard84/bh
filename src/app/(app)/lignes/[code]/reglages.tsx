import { revalidatePath } from "next/cache";
import { peutPiloter, requireUser } from "@/server/auth";
import { asUser } from "@/server/db";
import { lireClasses, lireGrille } from "@/server/reglages";

/**
 * Réglages d'une ligne : tout ce qui distingue une marque d'une autre, sans code.
 * Grille : une ligne par critère, « points | critère ». Classes : « classe : définition ».
 * Modifier la grille crée une nouvelle version (les scores restent historisés).
 */
const liste = (v: FormDataEntryValue | null) => String(v ?? "").split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);

async function enregistrer(form: FormData) {
  "use server";
  const user = await requireUser();
  const code = String(form.get("code"));
  if (!(await peutPiloter(user, code))) throw new Error("Réservé au responsable de la ligne.");
  const grille = lireGrille(String(form.get("grille")));
  const classes = lireClasses(String(form.get("classes")));
  const quotas = { nouvelles_sequences_jour: Number(form.get("q_sequences")), emails_jour: Number(form.get("q_emails")), invitations_linkedin_jour_par_compte: Number(form.get("q_linkedin")) };
  await asUser(user.id, async (sql) => {
    const [avant] = await sql`select grille_signal, grille_version from hub.lignes where code = ${code}`;
    const version = JSON.stringify(avant.grille_signal) === JSON.stringify(grille) ? avant.grille_version : avant.grille_version + 1;
    await sql`update hub.lignes set
      naf = ${liste(form.get("naf"))}, departements = ${liste(form.get("departements"))},
      effectif_min = ${String(form.get("effectif_min") || "") || null}, effectif_max = ${String(form.get("effectif_max") || "") || null},
      classes = ${sql.json(classes as never)}, classes_retenues = ${liste(form.get("classes_retenues"))},
      grille_signal = ${sql.json(grille as never)}, grille_version = ${version}, seuil_score = ${Number(form.get("seuil"))},
      constat_type = ${String(form.get("constat_type"))}, offre_entree = ${String(form.get("offre_entree"))},
      gabarit = gabarit || ${sql.json({ voix: String(form.get("voix")), signature: String(form.get("signature")) } as never)},
      canaux_autorises = ${["email", "linkedin", "telephone"].filter((c) => form.get(`canal_${c}`))},
      quotas = quotas || ${sql.json(quotas as never)},
      enrichissement_actif = ${form.get("enrichissement_actif") === "on"},
      maj_le = now()
      where code = ${code}`;
    // L'envoi réel ne s'ouvre que par l'administrateur.
    if (user.superAdmin) await sql`update hub.lignes set active = ${form.get("active") === "on"} where code = ${code}`;
  });
  revalidatePath(`/lignes/${code}`);
}

export async function Reglages({ l, superAdmin }: { l: Record<string, any>; superAdmin: boolean }) {
  const q = l.quotas as Record<string, number>;
  const g = l.gabarit as Record<string, string>;
  const champ = (label: string, el: React.ReactNode) => <label className="block space-y-1"><span className="muted text-xs">{label}</span>{el}</label>;
  return (
    <form action={enregistrer} className="card p-5 space-y-4 text-sm">
      <h2 className="font-semibold">Régler la ligne</h2>
      <input type="hidden" name="code" value={l.code} />
      <div className="grid gap-3 md:grid-cols-2">
        {champ("Codes NAF (séparés par des virgules)", <input className="input" name="naf" defaultValue={l.naf.join(", ")} />)}
        {champ("Départements", <input className="input" name="departements" defaultValue={l.departements.join(", ")} />)}
        {champ("Tranche d'effectif minimale (code INSEE : NN, 00, 01…)", <input className="input" name="effectif_min" defaultValue={l.effectif_min ?? ""} />)}
        {champ("Tranche d'effectif maximale", <input className="input" name="effectif_max" defaultValue={l.effectif_max ?? ""} />)}
      </div>
      {champ("Classes d'activité — une par ligne : « classe : définition »",
        <textarea className="input" name="classes" rows={6} defaultValue={Object.entries(l.classes as Record<string, string>).map(([k, v]) => `${k} : ${v}`).join("\n")} />)}
      {champ("Classes retenues par la ligne", <input className="input" name="classes_retenues" defaultValue={l.classes_retenues.join(", ")} />)}
      {champ(`Grille v${l.grille_version} — une ligne par critère : « points | critère » (la modifier crée la v${l.grille_version + 1})`,
        <textarea className="input" name="grille" rows={8} defaultValue={(l.grille_signal as { critere: string; points: number }[]).map((c) => `${c.points} | ${c.critere}`).join("\n")} />)}
      <div className="grid gap-3 md:grid-cols-3">
        {champ("Seuil de qualification (0-100)", <input className="input" type="number" min={0} max={100} name="seuil" defaultValue={l.seuil_score} />)}
        {champ("Nouvelles séquences par jour", <input className="input" type="number" min={0} max={200} name="q_sequences" defaultValue={q.nouvelles_sequences_jour ?? 20} />)}
        {champ("Emails par jour (toutes boîtes)", <input className="input" type="number" min={0} max={500} name="q_emails" defaultValue={q.emails_jour ?? 0} />)}
        {champ("Invitations LinkedIn par jour et par compte", <input className="input" type="number" min={0} max={20} name="q_linkedin" defaultValue={q.invitations_linkedin_jour_par_compte ?? 15} />)}
      </div>
      {champ("Constat type (modèle d'accroche)", <input className="input" name="constat_type" defaultValue={l.constat_type ?? ""} />)}
      {champ("Offre d'entrée", <input className="input" name="offre_entree" defaultValue={l.offre_entree ?? ""} />)}
      <div className="grid gap-3 md:grid-cols-2">
        {champ("Voix", <input className="input" name="voix" defaultValue={g.voix ?? ""} />)}
        {champ("Signataire", <input className="input" name="signature" defaultValue={g.signature ?? ""} />)}
      </div>
      <div className="flex flex-wrap gap-4">
        {["email", "linkedin", "telephone"].map((c) => (
          <label key={c} className="flex items-center gap-2"><input type="checkbox" name={`canal_${c}`} defaultChecked={l.canaux_autorises.includes(c)} /> {c}</label>
        ))}
      </div>
      <label className="flex items-center gap-2"><input type="checkbox" name="enrichissement_actif" defaultChecked={l.enrichissement_actif} />
        Enrichissement automatique (sites, lecture, contacts, qualification : consomme des crédits de recherche)</label>
      {superAdmin && (
        <label className="flex items-center gap-2 pill pill-off w-fit"><input type="checkbox" name="active" defaultChecked={l.active} />
          Envoi réel ouvert pour cette ligne (exige aussi des boîtes actives et BH_ENVOI_ACTIF=1)</label>
      )}
      <button className="btn" type="submit">Enregistrer</button>
    </form>
  );
}

