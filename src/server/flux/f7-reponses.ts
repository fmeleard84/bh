import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import { sysSql } from "../db";
import { json } from "../ia";
import { arreterSequences, desinscrire } from "./envoi";
import { evenement } from "./runs";

/**
 * F7 — Traiter les réponses (IMAP des boîtes d'envoi, local).
 *  - opposition (« stop », désinscription) et rebond : détectés par le code, sans IA,
 *    écrits immédiatement dans la suppression du groupe ;
 *  - absence automatique : notée, la séquence continue ;
 *  - toute autre réponse arrête tous les canaux, puis le Trieur (service decide de
 *    Trooper, sortie contrainte et confiance calibrée) la classe ; sous 0,7 de
 *    confiance, elle va « à lire » chez l'humain ; un brouillon de réponse est préparé.
 */
const CLASSES = ["interesse", "pas_maintenant", "mauvaise_personne", "objection", "absent", "stop"] as const;
const STOP = /^\s*(stop|unsubscribe|d[ée]sinscri\w*)\b|ne plus (me |nous )?(contacter|recevoir|écrire|ecrire)|retirez[- ]moi|supprimez[- ]moi/im;

export function estOpposition(texte: string): boolean {
  return STOP.test(texte);
}

export function estRebond(m: Pick<ParsedMail, "from" | "headers" | "subject">): boolean {
  const de = m.from?.value?.[0]?.address?.toLowerCase() ?? "";
  const type = String(m.headers.get("content-type") ?? "");
  return /mailer-daemon|postmaster/.test(de) || /report-type=delivery-status/i.test(JSON.stringify(type)) || /undeliverable|delivery status notification|non remis|échec de la remise/i.test(m.subject ?? "");
}

export function estAbsence(m: Pick<ParsedMail, "headers" | "subject">): boolean {
  const auto = String(m.headers.get("auto-submitted") ?? "");
  return (auto !== "" && auto !== "no") || /absent|out of office|r[ée]ponse automatique|automatic reply|cong[ée]s/i.test(m.subject ?? "");
}

/** Texte de la réponse sans la citation du message d'origine. */
export function sansCitation(texte: string): string {
  // Gmail coupe souvent « Le sam. 31 oct. 2026 à 11:23, X <x@y> a écrit : » sur deux lignes.
  const coupe = texte.search(/^\s*(>|Le .{3,200}(?:\n.{0,200})?\s?a écrit|On .{3,200}(?:\n.{0,200})?\s?wrote|-----Original Message|De :|From:)/m);
  return (coupe > 0 ? texte.slice(0, coupe) : texte).trim();
}

async function trier(texte: string): Promise<{ classe: (typeof CLASSES)[number] | "a_lire"; confiance: number }> {
  const base = (process.env.TROOPER_LLM_URL ?? "http://172.18.0.1:17138/v1").replace(/\/v1$/, "");
  const res = await fetch(`${base}/v1/decide`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      context: texte.slice(0, 4000),
      system: "Tu classes la réponse d'un prospect à un email de prospection B2B. interesse : veut en savoir plus, un appel, un rendez-vous, une documentation. pas_maintenant : pas le moment, recontacter plus tard. mauvaise_personne : renvoie vers quelqu'un d'autre. objection : déjà équipé, trop cher, pas concerné, avec une raison. absent : réponse d'absence. stop : refuse d'être recontacté.",
      questions: [{ id: "classe", kind: "choice", question: "Nature de la réponse ?", choices: CLASSES }],
      priority: -5,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) return { classe: "a_lire", confiance: 0 };
  const a = ((await res.json()) as { answers: { classe: { value: string; confidence?: number } } }).answers.classe;
  const confiance = a.confidence ?? 0;
  return { classe: confiance < 0.7 ? "a_lire" : (a.value as (typeof CLASSES)[number]), confiance };
}

async function brouillonReponse(fil: string, classe: string, prenom: string | null, signataire: string): Promise<{ resume: string; brouillon: string }> {
  const { data } = await json<{ resume: string; brouillon: string }>({
    systeme: "Tu prépares, pour un commercial, la réponse à un prospect qui a répondu à une prospection. Résumé : une phrase factuelle de ce que dit le prospect. Brouillon : réponse courte (80 mots au plus), vouvoiement, sans superlatif, qui répond à sa question ou propose deux créneaux si un échange est souhaité. Aucun fait inventé, aucun tarif, et ne promets ni pièce jointe ni document : le commercial les ajoutera lui-même s'il le souhaite.",
    utilisateur: `Classe : ${classe}. Prénom du prospect : ${prenom ?? "?"}. Signataire : ${signataire}.\n\nFil :\n${fil.slice(0, 6000)}`,
    schema: { type: "object", additionalProperties: false, required: ["resume", "brouillon"],
      properties: { resume: { type: "string", maxLength: 300 }, brouillon: { type: "string", maxLength: 900 } } },
    maxTokens: 800,
  });
  // Texte brut : le modèle glisse parfois des <br>.
  return { ...data, brouillon: data.brouillon.replace(/<br\s*\/?>/gi, "\n") };
}

/** Adresses destinataires d'un message (To, Cc, Delivered-To), en minuscules. */
function destinataires(m: ParsedMail): string[] {
  const listes = [m.to, m.cc].flatMap((x) => (Array.isArray(x) ? x : x ? [x] : []));
  const livre = m.headers.get("delivered-to");
  return [...listes.flatMap((l) => l.value.map((v) => v.address ?? "")), ...(Array.isArray(livre) ? livre : livre ? [livre] : []).map(String)]
    .map((a) => a.toLowerCase())
    .filter(Boolean);
}

export async function relever(): Promise<{ boites: number; messages: number }> {
  const sql = sysSql();
  const boites = await sql`select * from hub.boites where active`;
  // Des alias d'un même compte partagent une boîte de réception : une seule relève par compte.
  const comptes = new Map<string, Record<string, any>[]>();
  for (const b of boites) {
    const cle = `${b.imap_host}:${(b.identifiant ?? b.email).toLowerCase()}`;
    comptes.set(cle, [...(comptes.get(cle) ?? []), b]);
  }
  let messages = 0;
  for (const groupe of comptes.values()) {
    const b0 = groupe[0];
    const pass = process.env[b0.secret_ref];
    if (!pass) continue;
    const client = new ImapFlow({ host: b0.imap_host, port: b0.imap_port, secure: true, auth: { user: b0.identifiant ?? b0.email, pass }, logger: false });
    await client.connect();
    const verrou = await client.getMailboxLock("INBOX");
    let dernier = Math.min(...groupe.map((b) => Number(b.imap_dernier_uid)));
    try {
      for await (const msg of client.fetch({ uid: `${dernier + 1}:*` }, { uid: true, source: true }, { uid: true })) {
        if (msg.uid <= dernier) continue;
        const m = await simpleParser(msg.source as Buffer);
        const pour = destinataires(m);
        await traiter(m, groupe.find((b) => pour.includes(b.email.toLowerCase())) ?? b0);
        dernier = Math.max(dernier, msg.uid);
        messages++;
      }
    } finally {
      verrou.release();
      await client.logout();
      await sql`update hub.boites set imap_dernier_uid = greatest(imap_dernier_uid, ${dernier}) where id = any(${groupe.map((b) => b.id)})`;
    }
  }
  return { boites: boites.length, messages };
}

export async function traiter(m: ParsedMail, b: Record<string, any>) {
  const sql = sysSql();
  const idExterne = m.messageId ?? `${b.id}:${m.date?.toISOString()}:${m.subject}`;
  const [deja] = await sql`select 1 from hub.echanges where id_externe = ${idExterne}`;
  if (deja) return;

  // Rebond : l'adresse d'origine est dans le rapport ; elle rejoint la suppression du groupe.
  if (estRebond(m)) {
    const cible = (m.text ?? "").match(/[\w.+-]+@[\w-]+\.[\w.-]+/g)?.find((a) => !a.toLowerCase().includes(b.email.toLowerCase().split("@")[1]));
    const [ct] = cible ? await sql`select id, siren from hub.contacts where email = ${cible.toLowerCase()} limit 1` : [];
    if (ct && cible) {
      await sql`update hub.contacts set email_statut = 'invalide', maj_le = now() where id = ${ct.id}`;
      await sql`insert into hub.suppression (type, valeur, motif, ligne_code) values ('email', ${cible.toLowerCase()}, 'bounce', '*') on conflict do nothing`;
      await arreterSequences(ct.id, "rebond");
      await evenement({ siren: ct.siren, contactId: ct.id, type: "rebond", donnees: { email: cible }, acteur: "F7" });
    }
    return;
  }

  // Rattachement : au message envoyé (fil), sinon à l'expéditeur.
  const refs = [m.inReplyTo, ...(Array.isArray(m.references) ? m.references : m.references ? [m.references] : [])].filter(Boolean) as string[];
  const de = m.from?.value?.[0]?.address?.toLowerCase() ?? "";
  const [orig] = refs.length
    ? await sql`select x.contact_id, x.sequence_id, x.ligne_code from hub.echanges x where x.message_id = any(${refs}) limit 1`
    : [];
  const [ct] = orig
    ? await sql`select * from hub.contacts where id = ${orig.contact_id}`
    : await sql`select * from hub.contacts where email = ${de} limit 1`;
  if (!ct) return; // message sans rapport avec une prospection : on n'y touche pas

  const texte = sansCitation(m.text ?? "");
  const ligne = orig?.ligne_code ?? b.ligne_code;
  const base = { contactId: ct.id, sequenceId: orig?.sequence_id ?? null, ligne };

  if (estAbsence(m)) {
    await sql`insert into hub.echanges (contact_id, sequence_id, ligne_code, canal, sens, objet, corps, repondu_le, classe_reponse, confiance, id_externe, traite_le)
              values (${ct.id}, ${base.sequenceId}, ${ligne}, 'email', 'entrant', ${m.subject ?? ""}, ${texte}, now(), 'absent', 1, ${idExterne}, now())`;
    return;
  }

  // Toute vraie réponse arrête tous les canaux.
  await arreterSequences(ct.id, "reponse");
  await sql`update hub.ciblages set statut = 'repondu', maj_le = now() where siren = ${ct.siren} and ligne_code = ${ligne}`;

  if (estOpposition(texte)) {
    await desinscrire(ct.id, "réponse STOP");
    await sql`insert into hub.echanges (contact_id, sequence_id, ligne_code, canal, sens, objet, corps, repondu_le, classe_reponse, confiance, id_externe, traite_le)
              values (${ct.id}, ${base.sequenceId}, ${ligne}, 'email', 'entrant', ${m.subject ?? ""}, ${texte}, now(), 'stop', 1, ${idExterne}, now())`;
    return;
  }

  const { classe, confiance } = await trier(texte);
  const envoyes = base.sequenceId ? await sql`select corps from hub.echanges where sequence_id = ${base.sequenceId} and statut_envoi = 'envoye' order by etape` : [];
  const fil = [...envoyes.map((e) => `[nous] ${e.corps}`), `[prospect] ${texte}`].join("\n\n");
  const { resume, brouillon } = await brouillonReponse(fil, classe, ct.prenom, b.nom_affiche);
  const [x] = await sql`insert into hub.echanges (contact_id, sequence_id, ligne_code, canal, sens, objet, corps, repondu_le, classe_reponse, confiance, resume, brouillon_reponse, id_externe, in_reply_to, boite_id)
            values (${ct.id}, ${base.sequenceId}, ${ligne}, 'email', 'entrant', ${m.subject ?? ""}, ${texte}, now(), ${classe}, ${confiance}, ${resume}, ${brouillon}, ${idExterne}, ${m.messageId ?? null}, ${b.id})
            returning id`;
  if (classe === "stop") await desinscrire(ct.id, "réponse classée stop");
  if (classe === "pas_maintenant") await sql`update hub.ciblages set prochaine_action_le = now() + interval '90 days' where siren = ${ct.siren} and ligne_code = ${ligne}`;
  await evenement({ siren: ct.siren, contactId: ct.id, ligne, type: "reponse", donnees: { classe, confiance, echange: x.id }, acteur: "F7" });
}
