import { normaliser, nomUtile } from "../texte";

/**
 * Règles pures de la résolution de site (F2), séparées pour être testées.
 * Un site n'est retenu que s'il est prouvé : SIREN présent, ou commune ET nom
 * d'un dirigeant présents (cahier des charges §1 : 1 homonyme sur 7 au pilote).
 */

/** Annuaires et réseaux : jamais le site d'une société. */
export const ANNUAIRES = [
  "societe.com", "pappers.fr", "infogreffe.fr", "annuaire-entreprises.data.gouv.fr", "verif.com", "manageo.fr",
  "corporama.com", "kompass.com", "pagesjaunes.fr", "linkedin.com", "facebook.com", "instagram.com", "twitter.com",
  "x.com", "youtube.com", "b-reputation.com", "entreprises.lefigaro.fr", "societeinfo.com", "dnb.com", "europages.fr",
  "lagazettefrance.fr", "score3.fr", "infonet.fr", "bodacc.fr", "sirene.fr", "insee.fr", "mappy.com", "google.com",
  "yandex.ru", "yandex.com", "wikipedia.org", "tripadvisor.fr", "leboncoin.fr", "indeed.com", "hellowork.com",
  "doctrine.fr", "procedurecollective.fr", "annuaire.118712.fr", "118000.fr", "firmania.fr", "lefigaro.fr",
  "aumilieudesvignes.com", "net-entreprises.fr", "entreprise.data.gouv.fr", "data.inpi.fr", "pagespro.com",
];

export function estAnnuaire(host: string): boolean {
  const h = host.replace(/^www\./, "").toLowerCase();
  return ANNUAIRES.some((a) => h === a || h.endsWith(`.${a}`));
}

/** Domaines à essayer d'après la raison sociale et les enseignes. */
export function domainesCandidats(noms: string[]): string[] {
  const out = new Set<string>();
  // Raison sociale qui est déjà un nom de domaine (« ENTRECAVISTES.COM ») : essayée telle quelle, en premier.
  for (const nom of noms) {
    const m = nom.toLowerCase().match(/\b([a-z0-9][a-z0-9-]*\.(?:com|fr|net|eu|vin|wine|bio))\b/);
    if (m) out.add(m[1]);
  }
  for (const nom of noms) {
    const u = nomUtile(nom);
    if (u.replace(/\s/g, "").length < 4) continue;
    const mots = u.split(" ");
    const variantes = new Set([mots.join(""), mots.join("-")]);
    if (mots.length > 4) continue; // au-delà, aucune société n'a ce domaine
    for (const v of variantes) for (const tld of ["fr", "com"]) out.add(`${v}.${tld}`);
  }
  return [...out].slice(0, 10);
}

/** « MARSEILLE 8 » → « marseille » ; « AIX-EN-PROVENCE » → « aix en provence ». */
export function communeNormalisee(commune: string | null): string | null {
  if (!commune) return null;
  return normaliser(commune).replace(/\s+\d+(e|er|eme)?$/, "").replace(/\s+arrondissement$/, "").trim() || null;
}

export interface Preuve {
  verifie: boolean;
  preuve: string | null;
}

/**
 * Un texte de page prouve-t-il que le site est celui de la société ?
 *  - le SIREN (ou un SIRET qui le contient) ;
 *  - ou la commune ET le nom d'un dirigeant ;
 *  - ou la raison sociale exacte ET le nom d'un dirigeant. `raisonSociale` est
 *    omise pour une entreprise individuelle : sa raison sociale est le nom du dirigeant.
 */
export function prouver(texte: string, url: string, siren: string, commune: string | null, dirigeants: string[], raisonSociale?: string): Preuve {
  const chiffres = texte.replace(/[\s.\u00a0\u202f-]/g, "");
  if (chiffres.includes(siren)) return { verifie: true, preuve: `SIREN ${siren} présent sur ${url}` };
  const n = ` ${normaliser(texte)} `;
  const d = dirigeants.map(normaliser).find((nom) => nom.length >= 3 && n.includes(` ${nom} `));
  if (!d) return { verifie: false, preuve: null };
  const c = communeNormalisee(commune);
  if (c && n.includes(` ${c} `)) return { verifie: true, preuve: `commune « ${c} » et dirigeant « ${d} » présents sur ${url}` };
  const r = raisonSociale ? nomUtile(raisonSociale) : "";
  if (r.replace(/\s/g, "").length >= 6 && n.includes(` ${r} `)) return { verifie: true, preuve: `raison sociale « ${r} » et dirigeant « ${d} » présents sur ${url}` };
  return { verifie: false, preuve: null };
}

const TEL = /(?:\+33\s?\(?0?\)?\s?|\b0)[1-9](?:[\s.-]?\d{2}){4}\b/;

/** Premier numéro de téléphone français affiché, au format 0X XX XX XX XX. */
export function telephone(texte: string): string | null {
  const m = texte.match(TEL);
  if (!m) return null;
  const d = m[0].replace(/\D/g, "").replace(/^33/, "0").replace(/^00/, "0");
  const n = d.startsWith("0") ? d : `0${d}`;
  return n.length === 10 ? n.replace(/(\d{2})(?=\d)/g, "$1 ") : null;
}

/** Liens utiles pour prouver l'identité : mentions légales, CGV, contact, à propos. */
export function liensUtiles(liens: { href: string; texte: string }[], host: string): string[] {
  const re = /mentions|legal|l[eé]gales|cgv|conditions|contact|propos|about|qui-sommes|qui sommes|equipe|[eé]quipe|team/i;
  const vus = new Set<string>();
  for (const l of liens) {
    try {
      const u = new URL(l.href);
      if (u.host.replace(/^www\./, "") !== host.replace(/^www\./, "")) continue;
      if (!re.test(u.pathname) && !re.test(l.texte)) continue;
      u.hash = "";
      vus.add(u.toString());
    } catch {
      /* ignoré */
    }
  }
  // Les mentions légales d'abord : c'est là que se trouve le SIREN.
  return [...vus].sort((a, b) => Number(/mention|legal/i.test(b)) - Number(/mention|legal/i.test(a))).slice(0, 3);
}
