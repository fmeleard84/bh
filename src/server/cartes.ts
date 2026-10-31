import type postgres from "postgres";
import { queue, QUEUES } from "./queue";

/**
 * Cartes de « Ma journée » : une par ligne (une marque, un canal d'acquisition).
 * BH tourne seul ; la carte ne met en avant que ce qui attend un humain (« À faire »),
 * signale ce qui mérite d'être surveillé (« Attention ») et résume le reste en une ligne.
 * Les règles sont ici, lisibles : ajouter une alerte = ajouter une condition.
 */
export interface Point { texte: string; href?: string }
export interface Serie { nom: string; semaines: { semaine: string; n: number }[] }
export interface Carte {
  code: string; marque: string; nom: string;
  envoi: "ouvert" | "en préparation";
  domaine: string | null;
  boites: { email: string; active: boolean; pause_motif: string | null }[];
  aFaire: Point[];
  attention: Point[];
  enCours: string[];
  cherche: { cible: string[]; offre: string | null; constat: string | null; seuil: number; canaux: string[] };
  entonnoir: { etape: string; n: number }[];
  evolution: Serie[];
}

const SEMAINES = 8;
const ETAPES: [string, string[]][] = [
  ["sourcés", ["source", "enrichi", "qualifie", "ecarte", "en_sequence", "repondu", "opportunite", "client"]],
  ["lus", ["enrichi", "qualifie", "ecarte", "en_sequence", "repondu", "opportunite", "client"]],
  ["qualifiés", ["qualifie", "en_sequence", "repondu", "opportunite", "client"]],
  ["en séquence", ["en_sequence", "repondu", "opportunite", "client"]],
  ["ont répondu", ["repondu", "opportunite", "client"]],
  ["opportunités", ["opportunite", "client"]],
];
const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

/** Travaux en file et en échec, par ligne. F2 ne porte que le SIREN : on le rattache par les ciblages. */
async function files(sql: postgres.TransactionSql) {
  const parLigne = new Map<string, { attente: number; echecs: number }>();
  const sansLigne: { siren: string; echec: boolean }[] = [];
  for (const nom of QUEUES) {
    if (nom === "pilotage" || nom === "reponses") continue;
    const q = queue(nom);
    const jobs = [
      ...(await q.getJobs(["waiting", "active", "delayed", "prioritized"], 0, 3000)).map((j) => ({ j, echec: false })),
      ...(await q.getFailed(0, 3000)).map((j) => ({ j, echec: true })),
    ];
    for (const { j, echec } of jobs) {
      if (!j) continue;
      if (j.data?.ligne) {
        const x = parLigne.get(j.data.ligne) ?? { attente: 0, echecs: 0 };
        if (echec) x.echecs++; else x.attente++;
        parLigne.set(j.data.ligne, x);
      } else if (j.data?.siren) sansLigne.push({ siren: j.data.siren, echec });
    }
  }
  if (sansLigne.length) {
    const rattaches = await sql`select siren, ligne_code from hub.ciblages where siren = any(${sansLigne.map((s) => s.siren)})`;
    for (const s of sansLigne) {
      for (const r of rattaches.filter((r) => r.siren === s.siren)) {
        const x = parLigne.get(r.ligne_code) ?? { attente: 0, echecs: 0 };
        if (s.echec) x.echecs++; else x.attente++;
        parLigne.set(r.ligne_code, x);
      }
    }
  }
  return parLigne;
}

export async function cartesLignes(sql: postgres.TransactionSql): Promise<Carte[]> {
  const envoiGlobal = process.env.BH_ENVOI_ACTIF === "1";
  const lignes = await sql`
    select l.*,
      (select coalesce(json_object_agg(statut, n), '{}') from (select statut, count(*)::int n from hub.ciblages c where c.ligne_code = l.code group by statut) s) as statuts,
      (select coalesce(json_agg(json_build_object('email', b.email, 'active', b.active, 'pause_motif', b.pause_motif) order by b.email), '[]')
         from hub.boites b where b.ligne_code = l.code) as boites,
      (select count(*)::int from hub.v_a_traiter v where v.ligne_code = l.code) as reponses,
      (select count(*)::int from hub.v_brouillons v where v.ligne_code = l.code) as brouillons,
      (select count(*)::int from hub.taches t where t.ligne_code = l.code and t.fait_le is null and t.echeance < now() + interval '1 day') as taches,
      (select count(*)::int from hub.sequences s where s.ligne_code = l.code and s.statut = 'en_cours') as sequences,
      (select count(*)::int from hub.echanges x where x.ligne_code = l.code and x.statut_envoi = 'planifie') as planifies,
      (select r.alertes from hub.rapports r where r.ligne_code = l.code order by r.cree_le desc limit 1) as alertes
    from hub.lignes l order by l.code`;

  const series = await sql`
    with semaines as (select generate_series(date_trunc('week', now()) - make_interval(weeks => ${SEMAINES - 1}), date_trunc('week', now()), interval '1 week') as s)
    select l.code, to_char(w.s, 'DD/MM') as semaine,
      (select count(*)::int from hub.evenements v where v.ligne_code = l.code and v.type = 'source'
         and v.cree_le >= w.s and v.cree_le < w.s + interval '1 week') as sources,
      (select count(distinct v.siren)::int from hub.evenements v where v.ligne_code = l.code and v.type = 'score'
         and v.donnees->>'statut' = 'qualifie' and v.cree_le >= w.s and v.cree_le < w.s + interval '1 week') as qualifies,
      (select count(*)::int from hub.echanges x where x.ligne_code = l.code and x.sens = 'sortant' and x.statut_envoi = 'envoye'
         and x.envoye_le >= w.s and x.envoye_le < w.s + interval '1 week') as envois,
      (select count(*)::int from hub.echanges x where x.ligne_code = l.code and x.sens = 'entrant' and x.classe_reponse <> 'absent'
         and x.repondu_le >= w.s and x.repondu_le < w.s + interval '1 week') as reponses
    from hub.lignes l cross join semaines w order by l.code, w.s`;

  const definitions: Record<string, string> = Object.assign({}, ...lignes.map((l) => l.classes));
  const travaux = await files(sql);

  return lignes.map((l) => {
    const st = l.statuts as Record<string, number>;
    const boites = l.boites as Carte["boites"];
    const t = travaux.get(l.code) ?? { attente: 0, echecs: 0 };
    const aFaire: Point[] = [];
    const attention: Point[] = [];
    const enCours: string[] = [];

    // ─── À faire : seulement ce qu'un humain doit trancher ou faire ─────────
    if (l.reponses) aFaire.push({ texte: `${pluriel(l.reponses, "réponse", "réponses")} de prospect à traiter`, href: "#reponses" });
    if (l.brouillons) aFaire.push({ texte: `${pluriel(l.brouillons, "séquence", "séquences")} à relire et valider`, href: "#brouillons" });
    if (l.taches) aFaire.push({ texte: `${pluriel(l.taches, "tâche", "tâches")} du jour (LinkedIn, appels)`, href: "#taches" });
    if (!l.naf.length || !l.departements.length)
      aFaire.push({ texte: "Définir les codes NAF et les départements : la recherche de comptes ne peut pas démarrer", href: `/lignes/${l.code}` });
    if (!l.enrichissement_actif && st.source)
      aFaire.push({ texte: `${pluriel(st.source, "compte sourcé attend", "comptes sourcés attendent")} : décider d'activer l'enrichissement (crédits de recherche)`, href: `/lignes/${l.code}` });
    if (t.echecs) aFaire.push({ texte: `${pluriel(t.echecs, "traitement en échec", "traitements en échec")} à relancer`, href: "/pilotage" });
    if (!boites.length) aFaire.push({ texte: "Déclarer une boîte d'envoi" });
    for (const b of boites) if (b.pause_motif) aFaire.push({ texte: `Boîte ${b.email} en pause : ${b.pause_motif}` });
    for (const a of (l.alertes as string[] | null) ?? []) aFaire.push({ texte: a, href: "/pilotage" });

    // ─── Attention : à surveiller, rien à faire tout de suite ──────────────
    const ouvert = envoiGlobal && l.active && boites.some((b) => b.active);
    if (!ouvert) {
      const pourquoi = !boites.some((b) => b.active) ? "boîte inactive (montée en réputation du domaine)" : !l.active ? "ligne inactive" : "envoi global désactivé";
      attention.push({ texte: `Envoi pas encore ouvert : ${pourquoi}` });
    }
    if (st.qualifie && !l.brouillons && !l.sequences) attention.push({ texte: `${pluriel(st.qualifie, "compte qualifié", "comptes qualifiés")} sans séquence : F6 les prépare chaque jour ouvré à 8 h` });
    attention.push({ texte: "Veille des comptes non active (cahier des charges : docs/veille.md)" });

    // ─── En cours : ce que BH fait seul ─────────────────────────────────────
    if (t.attente) enCours.push(`${pluriel(t.attente, "traitement automatique en file", "traitements automatiques en file")} (sites, contacts, notation)`);
    if (l.sequences) enCours.push(`${pluriel(l.sequences, "séquence en cours", "séquences en cours")}`);
    if (l.planifies) enCours.push(`${pluriel(l.planifies, "mail planifié", "mails planifiés")}`);

    const s = series.filter((r) => r.code === l.code);
    const serie = (nom: string, col: string): Serie => ({ nom, semaines: s.map((r) => ({ semaine: r.semaine, n: r[col] as number })) });
    const classes = (l.classes_retenues as string[]).map((c) => `${c} : ${definitions[c] ?? "?"}`);

    return {
      code: l.code, marque: l.marque, nom: l.nom,
      envoi: ouvert ? "ouvert" : "en préparation",
      domaine: (l.domaines_envoi as string[])[0] ?? null,
      boites, aFaire, attention, enCours,
      cherche: {
        cible: [
          ...classes,
          `NAF : ${l.naf.join(", ") || "à définir"} · départements : ${l.departements.join(", ") || "à définir"}`,
          `Effectif : tranches ${l.effectif_min ?? "?"} à ${l.effectif_max ?? "?"}`,
        ],
        offre: l.offre_entree, constat: l.constat_type, seuil: l.seuil_score, canaux: l.canaux_autorises,
      },
      entonnoir: ETAPES.map(([etape, statuts]) => ({ etape, n: statuts.reduce((a, x) => a + (st[x] ?? 0), 0) })),
      evolution: [serie("Comptes sourcés", "sources"), serie("Qualifiés", "qualifies"), serie("Mails envoyés", "envois"), serie("Réponses", "reponses")],
    };
  });
}
