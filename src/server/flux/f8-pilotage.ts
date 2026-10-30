import { sysSql } from "../db";
import { json } from "../ia";
import { consommationSerper } from "../sources/web";

/**
 * F8 — Pilotage. Rapport hebdomadaire par ligne (lundi 7 h) et seuils d'arrêt
 * automatiques (cahier §7) :
 *  - rebonds > 2 % sur 7 jours (au moins 20 envois) → boîte en pause ;
 *  - taux de réponse < 1 % après 300 envois → alerte « revoir le gabarit ».
 * Le résumé est écrit par Gemma à partir des seuls chiffres ; un chiffre qui n'y
 * figure pas fait rejeter le texte, remplacé par un résumé sans IA.
 */
export function semaineIso(d = new Date()): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const jour = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - jour);
  const an = t.getUTCFullYear();
  const semaine = Math.ceil(((t.getTime() - Date.UTC(an, 0, 1)) / 86_400_000 + 1) / 7);
  return `${an}-W${String(semaine).padStart(2, "0")}`;
}

export async function seuils(): Promise<string[]> {
  const sql = sysSql();
  const alertes: string[] = [];
  const boites = await sql`
    select b.id, b.email,
      (select count(*) from hub.echanges x where x.boite_id = b.id and x.envoye_le > now() - interval '7 days')::int as envoyes,
      (select count(*) from hub.evenements v join hub.contacts c on c.id = v.contact_id
         where v.type = 'rebond' and v.cree_le > now() - interval '7 days'
           and exists (select 1 from hub.echanges x where x.boite_id = b.id and x.contact_id = c.id))::int as rebonds
    from hub.boites b where b.active`;
  for (const b of boites) {
    if (b.envoyes >= 20 && b.rebonds / b.envoyes > 0.02) {
      await sql`update hub.boites set active = false, pause_motif = ${`rebonds ${b.rebonds}/${b.envoyes} sur 7 jours`} where id = ${b.id}`;
      alertes.push(`Boîte ${b.email} mise en pause : ${b.rebonds} rebonds pour ${b.envoyes} envois sur 7 jours.`);
    }
  }
  return alertes;
}

export async function chiffresLigne(ligne: string, debut: Date, fin: Date) {
  const sql = sysSql();
  const [c] = await sql`
    select
      (select count(*) from hub.evenements where ligne_code = ${ligne} and type = 'source' and cree_le between ${debut} and ${fin})::int as sources,
      (select count(*) from hub.evenements v join hub.ciblages g on g.siren = v.siren and g.ligne_code = ${ligne}
         where v.type = 'site_verifie' and v.cree_le between ${debut} and ${fin})::int as sites_prouves,
      (select count(*) from hub.evenements where ligne_code = ${ligne} and type = 'score' and donnees->>'statut' = 'qualifie' and cree_le between ${debut} and ${fin})::int as qualifies,
      (select count(*) from hub.sequences where ligne_code = ${ligne} and debut_le between ${debut} and ${fin})::int as sequences_validees,
      (select count(*) from hub.echanges where ligne_code = ${ligne} and sens = 'sortant' and canal = 'email' and envoye_le between ${debut} and ${fin})::int as emails_envoyes,
      (select count(*) from hub.taches where ligne_code = ${ligne} and fait_le between ${debut} and ${fin} and resultat = 'fait')::int as taches_faites,
      (select count(*) from hub.echanges where ligne_code = ${ligne} and sens = 'entrant' and classe_reponse <> 'absent' and repondu_le between ${debut} and ${fin})::int as reponses,
      (select count(*) from hub.echanges where ligne_code = ${ligne} and sens = 'entrant' and classe_reponse = 'interesse' and repondu_le between ${debut} and ${fin})::int as interesses,
      (select count(*) from hub.evenements where ligne_code = ${ligne} and type = 'opposition' and cree_le between ${debut} and ${fin})::int as oppositions,
      (select count(*) from hub.runs where ligne_code = ${ligne} and statut = 'erreur' and debut_le between ${debut} and ${fin})::int as flux_en_erreur,
      (select count(*) from hub.echanges where ligne_code = ${ligne} and sens = 'sortant' and canal = 'email' and statut_envoi = 'envoye')::int as emails_envoyes_cumul,
      (select count(*) from hub.echanges where ligne_code = ${ligne} and sens = 'entrant' and classe_reponse <> 'absent')::int as reponses_cumul`;
  const statuts = Object.fromEntries((await sql`select statut, count(*)::int as n from hub.ciblages where ligne_code = ${ligne} group by statut`).map((r) => [r.statut, r.n]));
  return { ...(c as Record<string, number>), statuts } as Record<string, number> & { statuts: Record<string, number> };
}

export async function rapportHebdo(ligne: string, maintenant = new Date()) {
  const sql = sysSql();
  const [l] = await sql`select nom from hub.lignes where code = ${ligne}`;
  const fin = maintenant;
  const debut = new Date(fin.getTime() - 7 * 86_400_000);
  const chiffres: Record<string, any> = { ...(await chiffresLigne(ligne, debut, fin)), credits_recherche_mois: await consommationSerper() };
  const alertes: string[] = [];
  if (chiffres.emails_envoyes_cumul >= 300 && chiffres.reponses_cumul / chiffres.emails_envoyes_cumul < 0.01) {
    alertes.push(`Taux de réponse sous 1 % après ${chiffres.emails_envoyes_cumul} envois : revoir le gabarit avant de continuer.`);
  }
  if (chiffres.flux_en_erreur) alertes.push(`${chiffres.flux_en_erreur} exécution(s) de flux en erreur cette semaine.`);

  const brut = JSON.stringify(chiffres);
  let resume = resumeSansIa(l.nom, chiffres);
  try {
    const { data } = await json<{ resume: string }>({
      systeme: "Tu rédiges le point hebdomadaire d'une ligne de prospection, en 6 à 10 lignes, en français, sobre. Tu n'utilises QUE les chiffres fournis, sans en calculer de nouveaux sauf un taux de réponse si les envois sont non nuls. Tu termines par la priorité de la semaine qui vient, déduite des chiffres (où se trouve le goulot).",
      utilisateur: `Ligne : ${l.nom}\nChiffres (7 derniers jours, statuts = état actuel) : ${brut}\nAlertes : ${alertes.join(" ") || "aucune"}`,
      schema: { type: "object", additionalProperties: false, required: ["resume"], properties: { resume: { type: "string", maxLength: 1200 } } },
      maxTokens: 700,
    });
    const autorises = new Set([...brut.matchAll(/\d+/g)].map((m) => m[0]));
    const invente = [...data.resume.matchAll(/\d+/g)].map((m) => m[0]).some((n) => !autorises.has(n) && !/^(1|2|7|100)$/.test(n) && !data.resume.includes(`${n} %`));
    if (!invente) resume = data.resume;
  } catch {
    /* Trooper indisponible : le résumé sans IA suffit */
  }
  await sql`insert into hub.rapports (semaine, ligne_code, chiffres, resume, alertes) values (${semaineIso(fin)}, ${ligne}, ${sql.json(chiffres as never)}, ${resume}, ${sql.json(alertes as never)})
            on conflict (semaine, ligne_code) do update set chiffres = excluded.chiffres, resume = excluded.resume, alertes = excluded.alertes, cree_le = now()`;
  return { ligne, semaine: semaineIso(fin), alertes };
}

function resumeSansIa(nom: string, c: Record<string, any>): string {
  return [
    `${nom} — 7 derniers jours : ${c.sources} sociétés sourcées, ${c.sites_prouves} sites prouvés, ${c.qualifies} comptes qualifiés.`,
    `${c.sequences_validees} séquences validées, ${c.emails_envoyes} emails envoyés, ${c.taches_faites} tâches humaines faites.`,
    `${c.reponses} réponses dont ${c.interesses} intéressées ; ${c.oppositions} oppositions.`,
  ].join("\n");
}
