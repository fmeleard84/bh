import { lieuxDuDepartement } from "../departements";
import { normaliser } from "../texte";

/**
 * Reconnaître le profil LinkedIn d'un dirigeant parmi des résultats de recherche.
 * Le titre doit porter le prénom ET le nom. Puis :
 *  - société : le titre ou l'extrait porte un mot distinctif de la raison sociale ou d'une enseigne ;
 *  - entreprise individuelle (raison sociale = nom du dirigeant, la règle précédente ne prouve rien) :
 *    l'extrait ou le titre porte un lieu cohérent (commune, département, grandes villes, région ; toute la France).
 */
const MOTS_FAIBLES = new Set(["vins", "wine", "wines", "france", "groupe", "diffusion", "distribution", "international", "services", "conseil", "commerce", "agence", "societe"]);

export interface Cible {
  prenom: string;
  nom: string;
  ei: boolean;
  raisonSociale: string;
  enseignes: string[];
  commune: string | null;
  departement: string | null;
}

export function profilCorrespond(r: { url: string; titre: string; extrait: string }, c: Cible): boolean {
  if (!/linkedin\.com\/in\//.test(r.url)) return false;
  const titre = ` ${normaliser(r.titre)} `;
  const tout = ` ${normaliser(`${r.titre} ${r.extrait}`)} `;
  const complet = [normaliser(`${c.prenom} ${c.nom}`), normaliser(`${c.nom} ${c.prenom}`)];
  if (!complet.some((n) => titre.includes(` ${n} `))) return false;
  if (c.ei) {
    const lieux = [c.commune ? normaliser(c.commune).replace(/\s+\d+$/, "") : "", ...lieuxDuDepartement(c.departement)].filter(Boolean);
    return lieux.some((l) => tout.includes(` ${l} `));
  }
  const mots = [c.raisonSociale, ...c.enseignes].flatMap((x) => normaliser(x).split(" ")).filter((m) => m.length >= 4 && !MOTS_FAIBLES.has(m));
  return mots.some((m) => tout.includes(` ${m} `) || tout.includes(m));
}
