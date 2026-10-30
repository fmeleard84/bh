import { createHash } from "node:crypto";
import { sysSql } from "../db";
import { rechercher } from "../sources/web";
import { profilCorrespond } from "./linkedin";
import { evenement } from "./runs";
import { scorer } from "./f5-scorer";

/**
 * Voie LinkedIn — comptes sans site prouvé (cahier §8 : environ 40 % des agents).
 * Le titre et l'extrait du profil du dirigeant, tels que la recherche les affiche,
 * deviennent un fait prouvé (preuve : l'URL du profil). Le Qualificateur classe
 * ensuite le compte ; un agent confirmé est qualifié pour le canal LinkedIn (humain).
 * Aucune page LinkedIn n'est lue ni stockée : seulement l'URL publique et le poste (cahier §10).
 */
const NATURE_EI = "1000";
const SOURCE = "recherche:linkedin";

export async function qualifierParLinkedin(siren: string, ligneCode: string) {
  const sql = sysSql();
  const [e] = await sql`select * from hub.entreprises where siren = ${siren}`;
  if (!e || e.site_verifie) return { siren, raison: "site prouvé : voie site" };
  const contacts = await sql`select * from hub.contacts where siren = ${siren} and role_cible and not opt_out and prenom is not null`;
  const ei = e.nature_juridique === NATURE_EI;
  let faits = 0;

  for (const c of contacts) {
    const societe = e.enseignes[0] ?? (ei ? "" : e.nom);
    const q = ei ? `"${c.prenom} ${c.nom}" ${e.commune ?? ""} linkedin` : `"${c.prenom} ${c.nom}" ${societe} linkedin`;
    let resultats: Awaited<ReturnType<typeof rechercher>> = [];
    try { resultats = await rechercher(q); } catch { continue; }
    const cible = { prenom: c.prenom, nom: c.nom, ei, raisonSociale: e.nom, enseignes: e.enseignes, commune: e.commune, departement: e.departement };
    const profil = resultats.find((r) => profilCorrespond(r, cible));

    if (!profil) {
      // Un profil retenu par la règle précédente (plus faible pour les entreprises individuelles) et non reconfirmé est retiré.
      if (c.linkedin_url && ei) {
        await sql`update hub.contacts set linkedin_url = null, linkedin_source = null, maj_le = now() where id = ${c.id}`;
        await evenement({ siren, contactId: c.id, type: "linkedin_retire", donnees: { ancien: c.linkedin_url, raison: "non reconfirmé (homonymie possible)" }, acteur: "F5b" });
      }
      continue;
    }
    const url = profil.url.split("?")[0];
    await sql`update hub.contacts set linkedin_url = ${url}, linkedin_source = ${SOURCE}, maj_le = now()
              where id = ${c.id} and not exists (select 1 from hub.contacts x where x.siren = ${siren} and x.linkedin_url = ${url} and x.id <> ${c.id})`;
    const extrait = `${profil.titre} — ${profil.extrait}`.slice(0, 300);
    const empreinte = createHash("sha256").update([siren, "profil_linkedin", url].join("|")).digest("hex");
    const r = await sql`insert into hub.signaux (siren, type, valeur, preuve_url, extrait, empreinte, source, collecte_le)
                        values (${siren}, 'activite_declaree', ${profil.titre.slice(0, 200)}, ${url}, ${extrait}, ${empreinte}, ${SOURCE}, now())
                        on conflict (empreinte) do update set valeur = excluded.valeur, extrait = excluded.extrait, collecte_le = now()
                        returning id`;
    faits += r.length;
  }
  if (!faits) {
    await evenement({ siren, ligne: ligneCode, type: "linkedin_introuvable", acteur: "F5b" });
    return { siren, faits: 0 };
  }
  const s = await scorer(siren, ligneCode);
  return { faits, ...s };
}

