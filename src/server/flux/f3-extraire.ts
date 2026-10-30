import { createHash } from "node:crypto";
import { sysSql } from "../db";
import { json, prompt } from "../ia";
import { lire, type PageLue } from "../sources/web";
import { normaliser } from "../texte";
import { evenement } from "./runs";

/**
 * F3 — Crawler et extraire. Lit l'accueil et jusqu'à 6 pages utiles d'un site
 * PROUVÉ, puis l'Extracteur (Gemma local) relève les faits et les personnes.
 *
 * Garde-fou anti-invention, appliqué ici et non confié au modèle : un fait n'est
 * gardé que si sa citation figure réellement dans la page citée ; un email ou
 * un téléphone que s'il est écrit tel quel dans une page lue.
 */
const PAGES_MAX = 6;
const CARACTERES_PAR_PAGE = 6_000;

const TYPES = ["activite_declaree", "clientele", "pour_compte_de", "nb_domaines", "regions_domaines", "zone", "catalogue_pro",
  "commande_en_ligne", "expedition", "equipe", "douane", "boutique_en_ligne", "autre"] as const;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["personnes", "faits"],
  properties: {
    personnes: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["preuve_url", "prenom", "nom", "role", "email", "telephone"],
        // L'ordre des propriétés est l'ordre de génération : la preuve d'abord. Placée en dernier,
        // le modèle qui voulait l'omettre bouclait sur des espaces jusqu'à la limite de tokens.
        properties: {
          preuve_url: { type: "string", maxLength: 300 },
          prenom: { type: ["string", "null"], maxLength: 40 }, nom: { type: "string", maxLength: 60 }, role: { type: ["string", "null"], maxLength: 120 },
          email: { type: ["string", "null"], maxLength: 100 }, telephone: { type: ["string", "null"], maxLength: 30 },
        },
      },
    },
    faits: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "preuve_url", "extrait", "valeur", "valeur_num"],
        // La citation avant la valeur : le fait se formule à partir de ce qui est écrit.
        properties: {
          type: { type: "string", enum: TYPES },
          preuve_url: { type: "string", maxLength: 300 }, extrait: { type: "string", maxLength: 300 },
          valeur: { type: "string", maxLength: 200 }, valeur_num: { type: ["number", "null"] },
        },
      },
    },
  },
};

interface Sortie {
  personnes: { prenom: string | null; nom: string; role: string | null; email: string | null; telephone: string | null; preuve_url: string }[];
  faits: { type: string; valeur: string; valeur_num: number | null; preuve_url: string; extrait: string }[];
}

const UTILES = /propos|qui-sommes|equipe|[eé]quipe|team|domaines|producteurs|vignerons|maisons|marques|portefeuille|catalogue|nos-vins|vins|selection|s[eé]lection|services|contact|mentions|legal|pro|professionnels|boutique|shop/i;

export function pagesUtiles(accueil: PageLue): string[] {
  const host = new URL(accueil.url).host.replace(/^www\./, "");
  const vus = new Set<string>([accueil.url]);
  const out: string[] = [];
  for (const l of accueil.liens) {
    let u: URL;
    try { u = new URL(l.href); } catch { continue; }
    if (u.host.replace(/^www\./, "") !== host || /\.(pdf|jpg|png|zip)$/i.test(u.pathname)) continue;
    u.hash = ""; u.search = "";
    const s = u.toString();
    if (vus.has(s) || !(UTILES.test(u.pathname) || UTILES.test(l.texte))) continue;
    vus.add(s);
    out.push(s);
  }
  return out.slice(0, PAGES_MAX);
}

/** La citation figure-t-elle dans la page ? Comparaison tolérante aux espaces, accents et ponctuation. */
export function citationPresente(extrait: string, texte: string): boolean {
  const e = normaliser(extrait);
  return e.length >= 10 && normaliser(texte).includes(e);
}

const chiffres = (s: string) => s.replace(/\D/g, "").replace(/^33/, "0");

/**
 * Un nombre n'est gardé que s'il est écrit dans la citation, ou, pour un nombre
 * de domaines, si la citation énumère au moins autant d'éléments.
 */
export function nombreJustifie(type: string, n: number | null, extrait: string): boolean {
  if (n === null) return true;
  if (new RegExp(`(^|\\D)${n}(\\D|$)`).test(extrait)) return true;
  return type === "nb_domaines" && extrait.split(/[,;\n•·|]/).filter((x) => x.trim().length > 2).length >= n;
}

export async function extraire(siren: string, ligneCode: string) {
  const sql = sysSql();
  const [e] = await sql`select * from hub.entreprises where siren = ${siren}`;
  if (!e?.site_verifie) return { siren, faits: 0, raison: "site non prouvé" };

  const accueil = await lire(e.site_url);
  if (!accueil) return { siren, faits: 0, raison: "site illisible" };
  const pages = [accueil];
  for (const u of pagesUtiles(accueil)) {
    const p = await lire(u);
    if (p && p.texte.length > 100) pages.push(p);
  }
  const parUrl = new Map(pages.map((p) => [p.url, p.texte]));
  const tout = pages.map((p) => p.texte).join("\n");

  const contacts = await sql`select prenom, nom, qualite from hub.contacts where siren = ${siren}`;
  const { data, modele } = await json<Sortie>({
    systeme: await prompt("extracteur"),
    utilisateur: [
      `Société : ${e.nom} (SIREN ${siren}), ${e.commune}.`,
      `Dirigeants au registre : ${contacts.map((c) => `${c.prenom ?? ""} ${c.nom} (${c.qualite ?? "?"})`).join(", ") || "aucun"}.`,
      ...pages.map((p) => `\n=== PAGE ${p.url} ===\n${p.texte.slice(0, CARACTERES_PAR_PAGE)}`),
    ].join("\n"),
    schema: SCHEMA,
    maxTokens: 6000,
  });

  const maintenant = new Date();
  let gardes = 0;
  const rejets: string[] = [];
  for (const f of data.faits) {
    const texte = parUrl.get(f.preuve_url);
    if (!texte || !citationPresente(f.extrait, texte)) { rejets.push(`${f.type}: ${f.extrait.slice(0, 60)}`); continue; }
    if (!nombreJustifie(f.type, f.valeur_num, f.extrait)) f.valeur_num = null;
    if (/^valeur_num/i.test(f.valeur.trim())) f.valeur = f.valeur_num !== null ? String(f.valeur_num) : "";
    if (!f.valeur && f.valeur_num === null) { rejets.push(`${f.type}: valeur vide`); continue; }
    const empreinte = createHash("sha256").update([siren, f.type, normaliser(f.valeur), f.preuve_url].join("|")).digest("hex");
    const r = await sql`insert into hub.signaux (siren, type, valeur, valeur_num, preuve_url, extrait, empreinte, source, collecte_le)
                        values (${siren}, ${f.type}, ${f.valeur}, ${f.valeur_num}, ${f.preuve_url}, ${f.extrait}, ${empreinte}, ${`llm:${modele}`}, ${maintenant})
                        on conflict (empreinte) do nothing returning id`;
    gardes += r.length;
  }

  // « Hervé » sur le site et « Herve » au registre sont la même personne : on reprend l'orthographe déjà en base.
  const cle = (nom: string, prenom: string | null) => `${normaliser(nom)}|${normaliser(prenom ?? "")}`;
  const connus = new Map((await sql`select nom, prenom from hub.contacts where siren = ${siren}`).map((c) => [cle(c.nom, c.prenom), c]));

  for (const p of data.personnes) {
    if (!p.nom || !parUrl.has(p.preuve_url)) continue;
    const connu = connus.get(cle(p.nom, p.prenom));
    if (connu) { p.nom = connu.nom; p.prenom = connu.prenom; }
    let email = p.email && tout.toLowerCase().includes(p.email.toLowerCase()) ? p.email.toLowerCase() : null;
    // Une adresse partagée (contact@) reste rattachée à la première personne qui la porte.
    if (email) {
      const [pris] = await sql`select 1 from hub.contacts where siren = ${siren} and email = ${email}
                               and (lower(nom), lower(coalesce(prenom, ''))) <> (lower(${p.nom}), lower(${p.prenom ?? ""}))`;
      if (pris) email = null;
    }
    const tel = p.telephone && chiffres(tout).includes(chiffres(p.telephone)) ? p.telephone : null;
    const generique = email ? /^(contact|info|infos|bonjour|hello|commercial|commandes?|admin|accueil|vente|ventes|office|secretariat)@/.test(email) : false;
    const mobile = tel && /^0[67]/.test(chiffres(tel)) ? tel : null;
    await sql`
      insert into hub.contacts (siren, prenom, nom, qualite, email, email_statut, email_source, telephone_mobile, telephone_fixe, tel_source, source, collecte_le)
      values (${siren}, ${p.prenom}, ${p.nom}, ${p.role}, ${email}, ${generique ? "generique" : "inconnu"}, ${email ? p.preuve_url : null},
              ${mobile}, ${tel && !mobile ? tel : null}, ${tel ? p.preuve_url : null}, ${`site:${p.preuve_url}`}, ${maintenant})
      on conflict (siren, lower(nom), lower(coalesce(prenom, ''))) do update set
        email = coalesce(hub.contacts.email, excluded.email),
        email_statut = case when hub.contacts.email is null then excluded.email_statut else hub.contacts.email_statut end,
        email_source = coalesce(hub.contacts.email_source, excluded.email_source),
        telephone_mobile = coalesce(hub.contacts.telephone_mobile, excluded.telephone_mobile),
        telephone_fixe = coalesce(hub.contacts.telephone_fixe, excluded.telephone_fixe),
        tel_source = coalesce(hub.contacts.tel_source, excluded.tel_source),
        maj_le = now()`;
  }

  await sql`update hub.ciblages set statut = 'enrichi', maj_le = now() where siren = ${siren} and ligne_code = ${ligneCode} and statut = 'source'`;
  await evenement({ siren, ligne: ligneCode, type: "site_lu", donnees: { pages: pages.map((p) => p.url), faits: gardes, rejets }, acteur: "F3" });
  return { siren, pages: pages.length, faits: gardes, rejets: rejets.length, personnes: data.personnes.length };
}
