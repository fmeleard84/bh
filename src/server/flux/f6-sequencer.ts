import { sysSql } from "../db";
import { json, prompt } from "../ia";
import { controler, type Controle } from "./gabarit";
import { deNom, prenomUsuel } from "../prenoms";
import { Run, evenement } from "./runs";

/**
 * F6 — Séquencer. Pour chaque compte qualifié et joignable, dans la limite du
 * quota de la ligne :
 *  1. un seul interlocuteur par société, choisi par la richesse de son canal ;
 *  2. le canal suit ce que contient la fiche (cahier §8), pas une préférence ;
 *  3. le Rédacteur (Gemma, local) écrit J0/J7/J14, la note LinkedIn et le script d'appel ;
 *  4. contrôle de gabarit par le code, une régénération au plus ;
 *  5. tout part en « à valider » : l'humain valide, il n'écrit jamais de zéro.
 */
type Gabarit = "nominatif" | "generique" | "linkedin" | "telephone";

interface Redaction {
  j0: { objet: string; corps: string };
  j7: { objet: string; corps: string };
  j14: { objet: string; corps: string };
  linkedin_note: string;
  script_appel: string;
}

const MSG = { type: "object", additionalProperties: false, required: ["objet", "corps"],
  properties: { objet: { type: "string", maxLength: 80 }, corps: { type: "string", maxLength: 900 } } };
const SCHEMA = {
  type: "object", additionalProperties: false, required: ["j0", "j7", "j14", "linkedin_note", "script_appel"],
  properties: { j0: MSG, j7: MSG, j14: MSG, linkedin_note: { type: "string", maxLength: 260 }, script_appel: { type: "string", maxLength: 900 } },
};

interface ContactLigne {
  id: string;
  prenom: string | null;
  nom: string;
  qualite: string | null;
  email: string | null;
  email_statut: string;
  linkedin_url: string | null;
  telephone_mobile: string | null;
  telephone_fixe: string | null;
}

export function salutation(gabarit: Gabarit, c: { prenom: string | null; nom: string }): string {
  const prenom = prenomUsuel(c.prenom);
  if (gabarit === "generique") return `Bonjour,\n\nÀ l'attention ${deNom([prenom, c.nom].filter(Boolean).join(" "))} :`;
  return prenom ? `Bonjour ${prenom},` : "Bonjour,";
}

/** Retire une salutation que le modèle aurait écrite malgré la consigne. */
export function sansSalutation(corps: string): string {
  const motifs = [/^\s*(bonjour|madame|monsieur|cher|ch[eè]re)\b[^\n,:]*[,:]?\s*/i, /^\s*(?:à\s+)?l'attention\s+(?:de\s+|d')[^\n:]*:\s*/i];
  let t = corps;
  for (let avant = ""; avant !== t; ) {
    avant = t;
    for (const m of motifs) t = t.replace(m, "");
  }
  return t.trim();
}

/** Canal retenu pour un contact, d'après sa fiche. */
export function choisirGabarit(c: { email_statut: string; linkedin_url: string | null; telephone: string | null }, canaux: string[]): Gabarit | null {
  if (canaux.includes("email") && c.email_statut === "valide") return "nominatif";
  if (canaux.includes("email") && c.email_statut === "generique") return "generique";
  if (canaux.includes("linkedin") && c.linkedin_url) return "linkedin";
  if (canaux.includes("telephone") && c.telephone) return "telephone";
  return null;
}

/** Rang d'un contact : email nominatif > LinkedIn > mobile > générique ; le dirigeant d'abord. */
function rang(c: { email_statut: string; linkedin_url: string | null; telephone_mobile: string | null; qualite: string | null }): number {
  return (c.email_statut === "valide" ? 8 : 0) + (c.linkedin_url ? 4 : 0) + (c.telephone_mobile ? 2 : 0) + (c.email_statut === "generique" ? 1 : 0)
    + (/g[ée]rant|pr[ée]sident|fondat|directeur g/i.test(c.qualite ?? "") ? 0.5 : 0);
}

export async function sequencer(ligneCode: string, opts: { max?: number; siren?: string } = {}) {
  const sql = sysSql();
  const [l] = await sql`select * from hub.lignes where code = ${ligneCode}`;
  const quota = opts.max ?? Number((l.quotas as Record<string, number>).nouvelles_sequences_jour ?? 20);
  const run = await Run.debut("F6", ligneCode, { quota });

  // Comptes qualifiés sans séquence active, du meilleur score au moins bon.
  const comptes = await sql`
    select c.siren, c.score_total, e.nom as entreprise, e.telephone as tel_societe, s.constats
    from hub.ciblages c
    join hub.entreprises e on e.siren = c.siren
    join hub.scores s on s.siren = c.siren and s.ligne_code = c.ligne_code and s.version_grille = ${l.grille_version}
    where c.ligne_code = ${ligneCode} and c.statut = 'qualifie' and (c.score_total >= ${l.seuil_score} or s.raisons->>'voie' = 'linkedin')
      ${opts.siren ? sql`and c.siren = ${opts.siren}` : sql``}
      and not exists (select 1 from hub.sequences q join hub.contacts x on x.id = q.contact_id
                      where x.siren = c.siren and q.statut in ('planifiee', 'en_cours'))
    order by c.score_total desc
    limit ${quota}`;

  try {
    for (const compte of comptes) {
      run.lus++;
      const contacts = await sql`
        select * from hub.contacts where siren = ${compte.siren} and role_cible and not opt_out
          and not hub.est_supprime(email, siren, ${ligneCode})`;
      const preuves = new Set((await sql`select preuve_url from hub.signaux where siren = ${compte.siren}`).map((x) => x.preuve_url as string));
      const surSite = (await sql`select site_verifie from hub.entreprises where siren = ${compte.siren}`)[0].site_verifie as boolean;
      compte.source_constats = surSite ? "site" : "profil LinkedIn";
      const tries = (contacts as unknown as ContactLigne[])
        .map((c) => ({ ...c, telephone: c.telephone_mobile ?? c.telephone_fixe ?? (compte.tel_societe as string | null) }))
        .filter((c) => choisirGabarit(c, l.canaux_autorises))
        // Le contact dont le profil est la preuve des constats passe devant (sinon : constats d'Aurore, message à Jacques).
        .sort((a, b) => rang(b) + (preuves.has(b.linkedin_url ?? "") ? 3 : 0) - rang(a) - (preuves.has(a.linkedin_url ?? "") ? 3 : 0));
      const contact = tries[0];
      if (!contact) {
        await sql`update hub.ciblages set statut = 'ecarte', motif_ecart = 'injoignable', prochaine_action_le = now() + interval '90 days', maj_le = now()
                  where siren = ${compte.siren} and ligne_code = ${ligneCode}`;
        continue;
      }
      const gabarit = choisirGabarit(contact, l.canaux_autorises)!;
      await preparer(l, compte, contact, gabarit);
      run.ecrits++;
      await run.point();
    }
    await run.fin("ok");
  } catch (e) {
    run.erreurs++;
    await run.fin("erreur", (e as Error).message);
    throw e;
  }
  return { ligne: ligneCode, comptes: comptes.length, sequences: run.ecrits };
}

async function rediger(l: Record<string, any>, compte: Record<string, any>, contact: Record<string, any>, gabarit: Gabarit, retour?: string) {
  const constats = (compte.constats as { texte: string }[]).map((c) => c.texte);
  const g = l.gabarit as Record<string, string>;
  const { data, modele } = await json<Redaction>({
    systeme: await prompt("redacteur"),
    utilisateur: [
      `Marque : ${l.marque} (société ${l.societe_expeditrice}). Signataire : ${g.signature ?? "l'équipe"}.`,
      `Voix : ${g.voix ?? "directe, chaleureuse, vouvoiement"}.`,
      `Offre d'entrée : ${l.offre_entree ?? "un échange de 20 minutes"}.`,
      `Destinataire : ${prenomUsuel(contact.prenom) ?? ""} ${contact.nom}, ${contact.qualite ?? "dirigeant"} de ${compte.entreprise}.`,
      gabarit === "generique"
        ? "L'adresse est générique (boîte d'accueil) : n'appelle pas le destinataire par son prénom dans le texte."
        : `Tu peux t'adresser à ${prenomUsuel(contact.prenom) ?? "lui"} par son prénom, avec parcimonie.`,
      "N'écris AUCUNE salutation (ni « Bonjour », ni « À l'attention de ») : l'outil l'ajoute. Commence directement par la phrase qui dit qui écrit.",
      compte.source_constats === "site"
        ? "Les constats ont été observés sur le site de sa société."
        : "Les constats viennent de son profil LinkedIn (sa société n'a pas de site connu) : ne parle JAMAIS de « votre site » ; tu peux dire « votre profil ».",
      "Constats :",
      ...constats.map((c, i) => `${i + 1}. ${c}`),
      retour ? `\nTa version précédente ne respectait pas : ${retour}. Corrige ces points.` : "",
    ].filter(Boolean).join("\n"),
    schema: SCHEMA,
    maxTokens: 2500,
  });
  // La salutation est écrite par le code, jamais par le modèle (le gabarit générique la massacrait).
  for (const k of ["j0", "j7", "j14"] as const) data[k].corps = `${salutation(gabarit, contact as { prenom: string | null; nom: string })}\n\n${sansSalutation(data[k].corps)}`;
  const ctx = { prenom: gabarit === "generique" ? null : prenomUsuel(contact.prenom), constats, autres: `${l.offre_entree ?? ""} ${JSON.stringify(l.gabarit)}`,
                sansSite: compte.source_constats !== "site" };
  const controles: Record<string, Controle> = {
    j0: controler("j0", data.j0, ctx),
    j7: controler("j7", data.j7, ctx),
    j14: controler("j14", data.j14, ctx),
    linkedin_note: controler("linkedin_note", { corps: data.linkedin_note }, ctx),
  };
  return { data, modele, controles };
}

async function preparer(l: Record<string, any>, compte: Record<string, any>, contact: Record<string, any>, gabarit: Gabarit) {
  let r = await rediger(l, compte, contact, gabarit);
  const defauts = () => Object.entries(r.controles).flatMap(([k, c]) => c.defauts.map((d) => `${k} : ${d}`));
  if (defauts().length) r = await rediger(l, compte, contact, gabarit, defauts().join(" ; "));

  const sql = sysSql();
  const canal = gabarit === "nominatif" || gabarit === "generique" ? "email" : gabarit;
  await sql.begin(async (tx) => {
    const [seq] = await tx`insert into hub.sequences (contact_id, ligne_code, canal, outil, gabarit, statut)
                           values (${contact.id}, ${l.code}, ${canal}, 'bh', ${gabarit}, 'planifiee') returning id`;
    const etapes: [number, "j0" | "j7" | "j14"][] = gabarit === "generique" ? [[0, "j0"], [7, "j7"]] : [[0, "j0"], [7, "j7"], [14, "j14"]];
    if (canal === "email") {
      for (const [jour, k] of etapes) {
        await tx`insert into hub.echanges (contact_id, sequence_id, ligne_code, canal, sens, objet, corps, statut_envoi, etape, controle, modele)
                 values (${contact.id}, ${seq.id}, ${l.code}, 'email', 'sortant', ${r.data[k].objet}, ${r.data[k].corps}, 'a_valider', ${jour},
                         ${tx.json(r.controles[k] as never)}, ${r.modele})`;
      }
    }
    // Compléments humains, validés avec la séquence : note LinkedIn, script d'appel.
    if (contact.linkedin_url && l.canaux_autorises.includes("linkedin")) {
      await tx`insert into hub.echanges (contact_id, sequence_id, ligne_code, canal, sens, corps, statut_envoi, etape, controle, modele)
               values (${contact.id}, ${seq.id}, ${l.code}, 'linkedin', 'sortant', ${r.data.linkedin_note}, 'a_valider', ${canal === "linkedin" ? 0 : 3},
                       ${tx.json(r.controles.linkedin_note as never)}, ${r.modele})`;
    }
    // Canal LinkedIn seul : deuxième touche, un message une semaine après l'invitation (cahier §8).
    if (canal === "linkedin") {
      await tx`insert into hub.echanges (contact_id, sequence_id, ligne_code, canal, sens, corps, statut_envoi, etape, controle, modele)
               values (${contact.id}, ${seq.id}, ${l.code}, 'linkedin', 'sortant', ${r.data.j7.corps}, 'a_valider', 7,
                       ${tx.json(r.controles.j7 as never)}, ${r.modele})`;
    }
    if (contact.telephone && l.canaux_autorises.includes("telephone")) {
      await tx`insert into hub.echanges (contact_id, sequence_id, ligne_code, canal, sens, corps, statut_envoi, etape, controle, modele)
               values (${contact.id}, ${seq.id}, ${l.code}, 'telephone', 'sortant', ${r.data.script_appel}, 'a_valider', ${canal === "telephone" ? 0 : 2},
                       '{}', ${r.modele})`;
    }
  });
  await evenement({ siren: compte.siren, contactId: contact.id, ligne: l.code, type: "sequence_preparee", donnees: { gabarit, defauts: defauts() }, acteur: "F6" });
}
