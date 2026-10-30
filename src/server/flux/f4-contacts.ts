import { sysSql } from "../db";
import { rechercher } from "../sources/web";
import { normaliser, sansAccents } from "../texte";
import { evenement } from "./runs";

/**
 * F4 — Trouver la personne, en local :
 *  (a) emails affichés sur le site (déjà relevés par F3) ;
 *  (b) emails devinés sur le domaine du site prouvé (prenom.nom@, prenom@…) ;
 *  (c) vérification SMTP par Reacher (auto-hébergé sur Trooper, le port 25 étant
 *      bloqué sur vaya) : sans vérificateur, rien n'est marqué « valide » ;
 *  (d) profil LinkedIn par la recherche locale, accepté seulement si le titre
 *      porte le nom de la personne ET celui de la société.
 * Seul un email « valide » entre en séquence (cahier §3).
 */
const SOURCE_LINKEDIN = "recherche:searxng";

type Statut = "valide" | "risque" | "invalide" | "generique" | "inconnu";

/** Reacher : POST /v0/check_email → is_reachable safe | risky | invalid | unknown. */
async function verifierEmail(email: string): Promise<Statut | null> {
  const base = process.env.REACHER_URL;
  if (!base) return null;
  try {
    const res = await fetch(`${base}/v0/check_email`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(process.env.REACHER_TOKEN ? { authorization: process.env.REACHER_TOKEN } : {}) },
      body: JSON.stringify({ to_email: email }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) return null;
    const r = (await res.json()) as { is_reachable: string; smtp?: { is_catch_all?: boolean } };
    if (r.smtp?.is_catch_all) return "risque"; // le serveur accepte tout : rien n'est prouvé
    return ({ safe: "valide", risky: "risque", invalid: "invalide" } as Record<string, Statut>)[r.is_reachable] ?? "inconnu";
  } catch {
    return null;
  }
}

function slug(s: string): string {
  return sansAccents(s).toLowerCase().replace(/[^a-z]/g, "");
}

/** Motifs les plus fréquents en France, du plus probable au moins probable. */
export function motifs(prenom: string, nom: string, domaine: string): string[] {
  const p = slug(prenom), n = slug(nom); // « Le Goff » → legoff
  if (!p || !n) return [];
  return [`${p}.${n}`, `${p}`, `${p[0]}.${n}`, `${p}${n}`, `${p[0]}${n}`, `${n}`, `${p}-${n}`, `${n}.${p}`].map((l) => `${l}@${domaine}`);
}

export async function trouverContacts(siren: string) {
  const sql = sysSql();
  const [e] = await sql`select * from hub.entreprises where siren = ${siren}`;
  if (!e) return;
  const contacts = await sql`select * from hub.contacts where siren = ${siren} and role_cible and not opt_out`;
  const domaine = e.site_verifie ? new URL(e.site_url).host.replace(/^www\./, "") : null;
  const bilan: Record<string, unknown>[] = [];

  for (const c of contacts) {
    const r: Record<string, unknown> = { contact: `${c.prenom ?? ""} ${c.nom}`.trim() };

    // (a)+(c) email affiché : on le vérifie s'il est nominatif.
    if (c.email && c.email_statut === "inconnu") {
      const s = await verifierEmail(c.email);
      if (s) {
        await sql`update hub.contacts set email_statut = ${s}, email_verifie_le = now(), maj_le = now() where id = ${c.id}`;
        r.email_affiche = s;
      }
    }

    // (b)+(c) email deviné, seulement s'il y a un vérificateur : un motif non vérifié ne vaut rien.
    if (!c.email && domaine && c.prenom && process.env.REACHER_URL) {
      for (const m of motifs(c.prenom, c.nom, domaine)) {
        const s = await verifierEmail(m);
        if (s === "valide") {
          await sql`update hub.contacts set email = ${m}, email_statut = 'valide', email_source = ${"motif+smtp"}, email_verifie_le = now(), maj_le = now()
                    where id = ${c.id} and email is null`;
          r.email_devine = m;
          break;
        }
        if (s === "risque" || s === null) break; // serveur « catch-all » ou injoignable : inutile d'insister
      }
    }

    // (d) LinkedIn
    if (!c.linkedin_url && c.prenom) {
      const societe = normaliser(e.nom);
      const enseignes = e.enseignes.map(normaliser);
      try {
        const res = await rechercher(`${c.prenom} ${c.nom} ${e.enseignes[0] ?? e.nom} linkedin`);
        const profil = res.find((x) => {
          if (!/linkedin\.com\/in\//.test(x.url)) return false;
          const t = ` ${normaliser(x.titre)} `;
          return t.includes(` ${normaliser(c.nom)} `) && (t.includes(societe) || enseignes.some((s: string) => s && t.includes(s)));
        });
        if (profil) {
          const url = profil.url.split("?")[0];
          await sql`update hub.contacts set linkedin_url = ${url}, linkedin_source = ${SOURCE_LINKEDIN}, maj_le = now()
                    where id = ${c.id} and linkedin_url is null
                      and not exists (select 1 from hub.contacts x where x.siren = ${siren} and x.linkedin_url = ${url})`;
          r.linkedin = url;
        }
      } catch (err) {
        r.linkedin_erreur = (err as Error).message;
      }
    }
    bilan.push(r);
  }
  await evenement({ siren, type: "contacts_cherches", donnees: { verificateur: !!process.env.REACHER_URL, bilan }, acteur: "F4" });
  return { siren, bilan };
}
