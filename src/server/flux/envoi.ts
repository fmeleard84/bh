import { createHmac } from "node:crypto";
import nodemailer, { type Transporter } from "nodemailer";
import { sysSql } from "../db";
import { evenement } from "./runs";

/**
 * Moteur d'envoi (remplace Smartlead : local d'abord).
 *
 * Trois verrous avant tout envoi : BH_ENVOI_ACTIF=1, ligne active, boîte active.
 * Avant CHAQUE message, on revérifie : séquence toujours en cours (aucune réponse),
 * contact sans opposition, absent de la liste de suppression du groupe.
 * Fenêtre : du lundi au vendredi, 8 h - 18 h (heure de Paris). Quota par boîte.
 * Chaque message porte qui écrit, pour quelle société, l'origine des coordonnées
 * et un lien de désinscription en un clic (cahier §10, RFC 8058).
 */
const FUSEAU = "Europe/Paris";

function heureParis(d: Date): { jour: number; heure: number } {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: FUSEAU, weekday: "short", hour: "numeric", hour12: false }).formatToParts(d);
  const jours = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return { jour: jours.indexOf(p.find((x) => x.type === "weekday")!.value), heure: Number(p.find((x) => x.type === "hour")!.value) % 24 };
}

export function dansFenetre(d: Date): boolean {
  const { jour, heure } = heureParis(d);
  return jour >= 1 && jour <= 5 && heure >= 8 && heure < 18;
}

/** Premier instant d'envoi possible à partir de `d`, avancé heure par heure (simple et sans piège de fuseau). */
export function prochaineFenetre(d: Date): Date {
  const t = new Date(d);
  for (let i = 0; i < 24 * 8 && !dansFenetre(t); i++) t.setTime(t.getTime() + 3_600_000);
  return t;
}

// ─── Désinscription ─────────────────────────────────────────────────────────

export function jetonDesinscription(contactId: string): string {
  const sig = createHmac("sha256", process.env.SESSION_SECRET!).update(`desinscription:${contactId}`).digest("base64url").slice(0, 22);
  return `${Buffer.from(contactId).toString("base64url")}.${sig}`;
}

export function lireJeton(jeton: string): string | null {
  const [b, sig] = jeton.split(".");
  if (!b || !sig) return null;
  const id = Buffer.from(b, "base64url").toString();
  return jetonDesinscription(id) === jeton ? id : null;
}

/** Opposition : écrite pour tout le groupe, toutes marques, jamais purgée. */
export async function desinscrire(contactId: string, origine: string) {
  const sql = sysSql();
  const [c] = await sql`update hub.contacts set opt_out = true, opt_out_le = now(), maj_le = now() where id = ${contactId} returning email, siren`;
  if (!c) return false;
  // Une opposition est définitive : elle remplace une éventuelle pause temporaire sur la même adresse.
  if (c.email) await sql`insert into hub.suppression (type, valeur, motif, ligne_code) values ('email', ${c.email}, 'opt_out', '*')
                         on conflict (type, valeur, ligne_code) do update set motif = 'opt_out', expire_le = null`;
  await arreterSequences(contactId, "opposition");
  await evenement({ siren: c.siren, contactId, type: "opposition", donnees: { origine }, acteur: "F7" });
  return true;
}

/** Toute réponse, sur n'importe quel canal, arrête tous les canaux (cahier §8). */
export async function arreterSequences(contactId: string, motif: string) {
  const sql = sysSql();
  const seqs = await sql`update hub.sequences set statut = 'stoppee', stop_motif = ${motif}, fin_le = now()
                         where contact_id = ${contactId} and statut in ('planifiee', 'en_cours') returning id`;
  for (const s of seqs) {
    await sql`update hub.echanges set statut_envoi = 'annule' where sequence_id = ${s.id} and statut_envoi in ('a_valider', 'valide', 'planifie')`;
    await sql`update hub.taches set fait_le = now(), resultat = ${`annulée : ${motif}`} where sequence_id = ${s.id} and fait_le is null and type <> 'repondre'`;
  }
}

// ─── Validation : l'humain valide, BH planifie ──────────────────────────────

export async function validerSequence(sequenceId: string, userId: string, retouches: Record<string, { objet?: string; corps?: string }>) {
  const sql = sysSql();
  await sql.begin(async (tx) => {
    const [s] = await tx`select * from hub.sequences where id = ${sequenceId} and statut = 'planifiee' for update`;
    if (!s) throw new Error("Séquence introuvable ou déjà validée.");
    const [ct] = await tx`select siren from hub.contacts where id = ${s.contact_id}`;
    const msgs = await tx`select * from hub.echanges where sequence_id = ${sequenceId} and statut_envoi = 'a_valider' order by etape`;
    const j0 = prochaineFenetre(new Date());
    for (const m of msgs) {
      const r = retouches[m.id] ?? {};
      const objet = r.objet?.trim() || m.objet;
      const corps = r.corps?.trim() || m.corps;
      if (m.canal === "email") {
        const quand = prochaineFenetre(new Date(j0.getTime() + m.etape * 86_400_000));
        await tx`update hub.echanges set objet = ${objet}, corps = ${corps}, statut_envoi = 'planifie', planifie_le = ${quand},
                 valide_par = ${userId}, valide_le = now() where id = ${m.id}`;
      } else {
        // LinkedIn et téléphone : des tâches pour l'humain, à l'échéance de l'étape.
        await tx`update hub.echanges set corps = ${corps}, statut_envoi = 'valide', valide_par = ${userId}, valide_le = now() where id = ${m.id}`;
        const type = m.canal === "linkedin" ? (s.canal === "linkedin" && m.etape > 0 ? "linkedin_message" : "linkedin_invitation") : "appel";
        await tx`insert into hub.taches (ligne_code, siren, contact_id, sequence_id, type, echeance, contenu)
                 values (${s.ligne_code}, ${ct.siren}, ${s.contact_id}, ${sequenceId}, ${type},
                         ${prochaineFenetre(new Date(j0.getTime() + m.etape * 86_400_000))}, ${corps})`;
      }
    }
    await tx`update hub.sequences set statut = 'en_cours', debut_le = now() where id = ${sequenceId}`;
    await tx`update hub.ciblages set statut = 'en_sequence', maj_le = now() where siren = ${ct.siren} and ligne_code = ${s.ligne_code}`;
  });
}

// ─── Envoi ──────────────────────────────────────────────────────────────────

const transporteurs = new Map<string, Transporter>();
function transporteur(b: Record<string, any>): Transporter {
  if (!transporteurs.has(b.id)) {
    const pass = process.env[b.secret_ref];
    if (!pass) throw new Error(`secret ${b.secret_ref} absent`);
    transporteurs.set(b.id, nodemailer.createTransport({ host: b.smtp_host, port: b.smtp_port, secure: b.smtp_port === 465, auth: { user: b.email, pass } }));
  }
  return transporteurs.get(b.id)!;
}

export function piedDeMessage(b: { nom_affiche: string; signature: string; adresse_postale: string }, societe: string, lien: string): string {
  return [
    "",
    b.signature || b.nom_affiche,
    `${societe}${b.adresse_postale ? ` — ${b.adresse_postale}` : ""}`,
    "",
    `Vous recevez ce message car vos coordonnées professionnelles sont publiques (site de votre société, registre des entreprises). Pour ne plus être contacté : ${lien} ou répondez STOP.`,
  ].join("\n");
}

export async function envoyerDus(): Promise<{ envoyes: number; motif?: string }> {
  if (process.env.BH_ENVOI_ACTIF !== "1") return { envoyes: 0, motif: "BH_ENVOI_ACTIF désactivé" };
  if (!dansFenetre(new Date())) return { envoyes: 0, motif: "hors fenêtre" };
  const sql = sysSql();
  const dus = await sql`
    select x.*, s.ligne_code, ct.email, ct.opt_out, ct.siren, l.societe_expeditrice
    from hub.echanges x
    join hub.sequences s on s.id = x.sequence_id and s.statut = 'en_cours'
    join hub.contacts ct on ct.id = x.contact_id
    join hub.lignes l on l.code = s.ligne_code and l.active
    where x.sens = 'sortant' and x.canal = 'email' and x.statut_envoi = 'planifie' and x.planifie_le <= now()
    order by x.planifie_le limit 20`;
  let envoyes = 0;
  for (const m of dus) {
    const [{ supprime }] = await sql`select hub.est_supprime(${m.email}, ${m.siren}, ${m.ligne_code}) as supprime`;
    if (m.opt_out || supprime || !m.email) {
      await arreterSequences(m.contact_id, supprime ? "suppression" : "opposition");
      continue;
    }
    // Même boîte pour toute la séquence (fil de discussion), sinon la boîte active la moins chargée du jour.
    const [prec] = await sql`select boite_id, message_id from hub.echanges where sequence_id = ${m.sequence_id} and statut_envoi = 'envoye' order by etape desc limit 1`;
    const [b] = await sql`
      select b.*, (select count(*) from hub.echanges e where e.boite_id = b.id and e.envoye_le::date = current_date)::int as du_jour
      from hub.boites b where b.ligne_code = ${m.ligne_code} and b.active and b.pause_motif is null
        ${prec ? sql`and b.id = ${prec.boite_id}` : sql``}
      order by du_jour limit 1`;
    if (!b || b.du_jour >= b.quota_jour) continue;
    const lien = `${process.env.BH_DESINSCRIPTION_URL ?? "https://bh.vaya.rip/d"}/${jetonDesinscription(m.contact_id)}`;
    try {
      const info = await transporteur(b).sendMail({
        from: { name: b.nom_affiche, address: b.email },
        to: m.email,
        subject: m.objet,
        text: `${m.corps}\n${piedDeMessage(b as unknown as Parameters<typeof piedDeMessage>[0], m.societe_expeditrice, lien)}`,
        headers: { "List-Unsubscribe": `<${lien}/1clic>, <mailto:${b.email}?subject=STOP>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        ...(prec?.message_id ? { inReplyTo: prec.message_id, references: [prec.message_id] } : {}),
      });
      await sql`update hub.echanges set statut_envoi = 'envoye', envoye_le = now(), boite_id = ${b.id}, message_id = ${info.messageId} where id = ${m.id}`;
      envoyes++;
    } catch (e) {
      await sql`update hub.echanges set statut_envoi = 'echec', erreur = ${(e as Error).message.slice(0, 500)} where id = ${m.id}`;
    }
  }
  // Séquence dont le dernier message est parti depuis 7 jours sans réponse : terminée, et pause de 90 jours pour tout le groupe.
  const finies = await sql`
    update hub.sequences s set statut = 'terminee', fin_le = now()
    where s.statut = 'en_cours'
      and not exists (select 1 from hub.echanges x where x.sequence_id = s.id and x.statut_envoi in ('planifie', 'valide'))
      and (select max(envoye_le) from hub.echanges x where x.sequence_id = s.id) < now() - interval '7 days'
    returning s.contact_id`;
  for (const f of finies) {
    await sql`insert into hub.suppression (type, valeur, motif, ligne_code, expire_le)
              select 'email', email, 'croisee', '*', now() + interval '90 days' from hub.contacts where id = ${f.contact_id} and email is not null
              on conflict (type, valeur, ligne_code) do update set expire_le = excluded.expire_le
              where hub.suppression.motif = 'croisee'`; // jamais d'échéance sur une opposition
  }
  return { envoyes };
}
