import { normaliser, nomUtile, sansAccents } from "../texte";

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
 *  - le SIREN (ou un SIRET qui le contient) suffit ;
 *  - sinon il faut les TROIS :
 *    1. le prénom ET le nom d'un dirigeant, côte à côte (un nom de famille seul
 *       — Paris, Bar, Pages, Martinez — se retrouve partout) ;
 *    2. la commune, ou la raison sociale quand elle n'est pas le nom du dirigeant ;
 *    3. un nom de domaine qui porte un mot de la raison sociale, d'une enseigne
 *       ou du dirigeant (ouigo.com n'est le site d'aucun agent).
 * Audit du 2026-10-30 : la règle « commune + nom de famille » donnait une
 * vingtaine de faux positifs sur 37, presque tous des entreprises individuelles.
 */
export interface Identite {
  siren: string;
  commune: string | null;
  dirigeants: { prenom: string | null; nom: string }[];
  /** Raison sociale ; omise pour une entreprise individuelle (c'est le nom du dirigeant). */
  raisonSociale?: string;
  enseignes?: string[];
}

const MOTS_FAIBLES = new Set(["vins", "wine", "wines", "france", "groupe", "diffusion", "distribution", "international", "services", "conseil", "commerce", "provence"]);

/** Mots distinctifs (4 lettres et plus) qui peuvent apparaître dans un nom de domaine. */
function motsDistinctifs(...noms: (string | null | undefined)[]): string[] {
  return noms.flatMap((x) => (x ? nomUtile(x).split(" ") : [])).filter((m) => m.length >= 4 && !MOTS_FAIBLES.has(m));
}

export function domainePertinent(url: string, id: Identite): boolean {
  let host: string;
  try { host = new URL(url).host.replace(/^www\./, "").toLowerCase(); } catch { return false; }
  const compact = sansAccents(host.split(".").slice(0, -1).join("")).replace(/[^a-z0-9]/g, "");
  const mots = motsDistinctifs(id.raisonSociale, ...(id.enseignes ?? []), ...id.dirigeants.map((d) => d.nom));
  return mots.some((m) => compact.includes(m.replace(/\s/g, "")));
}

export function prouver(texte: string, url: string, id: Identite): Preuve {
  const chiffres = texte.replace(/[\s.  -]/g, "");
  if (chiffres.includes(id.siren)) return { verifie: true, preuve: `SIREN ${id.siren} présent sur ${url}` };
  if (!domainePertinent(url, id)) return { verifie: false, preuve: null };
  const n = ` ${normaliser(texte)} `;
  const d = id.dirigeants
    .filter((x) => x.prenom && normaliser(x.nom).length >= 2)
    .map((x) => [normaliser(`${x.prenom} ${x.nom}`), normaliser(`${x.nom} ${x.prenom}`)])
    .find(([a, b]) => n.includes(` ${a} `) || n.includes(` ${b} `))?.[0];
  if (!d) return { verifie: false, preuve: null };
  const c = communeNormalisee(id.commune);
  if (c && n.includes(` ${c} `)) return { verifie: true, preuve: `commune « ${c} » et dirigeant « ${d} » présents sur ${url}` };
  const r = id.raisonSociale ? nomUtile(id.raisonSociale) : "";
  const sansDirigeant = id.dirigeants.reduce((acc, x) => acc.replace(normaliser(x.nom), ""), r).replace(/\s/g, "");
  if (sansDirigeant.length >= 6 && n.includes(` ${r} `)) return { verifie: true, preuve: `raison sociale « ${r} » et dirigeant « ${d} » présents sur ${url}` };
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
