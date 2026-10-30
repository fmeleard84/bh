import { sysSql } from "../db";
import { json, prompt } from "../ia";
import { normaliser } from "../texte";
import { evenement } from "./runs";

/**
 * F5 — Scorer. Deux notes, transparentes :
 *  - score_fit (règles, sans IA) : la société est-elle dans la cible et joignable ?
 *  - score_signal (Qualificateur) : somme des points des critères de la grille
 *    que les faits prouvés établissent.
 * score_total = 25 % fit + 75 % signal. Le statut « qualifie » exige en plus une
 * fiche complète (cahier §2) : sinon le compte reste « enrichi », avec sa note.
 *
 * Garde-fous côté code : un critère ou un constat qui cite un fait inexistant
 * est retiré ; la classe décide de l'écart et du re-routage, pas le modèle.
 */
const MOTS_VIN = /\b(vin|vins|vigne|vignoble|vigneron|vignerons|cave|caves|wine|wines|cru|chateau|domaine|domaines|oeno\w*|bouteille|spirits|spiritueux|champagne|terroir|boissons?)\b/;

/** « … clientèle professionnelle [2, 3]. » → « … clientèle professionnelle. » */
const sansRenvois = (t: string) => t.replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, "").trim();

interface Sortie {
  classe_activite: string;
  criteres: { vrai: boolean; faits: number[] }[];
  constats: { texte: string; fait: number }[];
  raisons: string[];
}

export async function scorer(siren: string, ligneCode: string) {
  const sql = sysSql();
  const [l] = await sql`select * from hub.lignes where code = ${ligneCode}`;
  const [e] = await sql`select * from hub.entreprises where siren = ${siren}`;
  const signaux = await sql`select id, type, valeur, valeur_num, preuve_url, extrait from hub.signaux where siren = ${siren} order by id`;
  const contacts = await sql`select * from hub.contacts where siren = ${siren} and role_cible and not opt_out`;
  const grille = l.grille_signal as { critere: string; points: number }[];
  // Classes : celles de toutes les lignes (définitions dans les fiches), pour pouvoir re-router.
  const definitions: Record<string, string> = {};
  for (const x of await sql`select classes from hub.lignes`) Object.assign(definitions, x.classes);
  const classes = [...Object.keys(definitions), "autre"];

  // ─── Fit : règles fixes, lisibles par un humain ─────────────────────────
  const fit = { cible: 0, nom: 0, site: 0, dirigeant: 0, joignable: 0 };
  if ((l.naf as string[]).includes(e.naf) && (l.departements as string[]).includes(e.departement)) fit.cible = 40;
  if (MOTS_VIN.test(normaliser(`${e.nom} ${e.enseignes.join(" ")}`))) fit.nom = 10;
  if (e.site_verifie) fit.site = 20;
  if (contacts.length) fit.dirigeant = 15;
  if (contacts.some((c) => c.email_statut === "valide" || c.telephone_mobile) || e.telephone) fit.joignable = 15;
  const scoreFit = Object.values(fit).reduce((a, b) => a + b, 0);

  // ─── Signal : le Qualificateur, seulement s'il a des faits à lire ───────
  let sortie: Sortie = { classe_activite: "autre", criteres: [], constats: [], raisons: ["aucun fait relevé sur un site prouvé"] };
  let moteur = "regles";
  let constats: { texte: string; preuve_url: string; signal_id: number }[] = [];
  if (signaux.length) {
    const numero = new Map(signaux.map((s, i) => [i + 1, s]));
    const r = await json<Sortie>({
      systeme: await prompt("qualificateur"),
      utilisateur: [
        `Ligne : ${l.nom}. Classes retenues par cette ligne : ${l.classes_retenues.join(", ")}.`,
        "Classes possibles :",
        ...Object.entries(definitions).map(([k, v]) => `- ${k} : ${v}`),
        "- autre : aucune de ces classes, ou faits insuffisants pour trancher.",
        `Société : ${e.nom}, ${e.commune}.`,
        "", "Faits :",
        ...[...numero].map(([n, s]) => `[${n}] ${s.type} : ${s.valeur}${s.valeur_num != null ? ` (${s.valeur_num})` : ""} — « ${s.extrait} »`),
        "", "Grille (dans l'ordre) :",
        ...grille.map((g, i) => `${i + 1}. ${g.critere}`),
      ].join("\n"),
      schema: {
        type: "object", additionalProperties: false, required: ["classe_activite", "criteres", "constats", "raisons"],
        properties: {
          classe_activite: { type: "string", enum: classes },
          criteres: { type: "array", minItems: grille.length, maxItems: grille.length, items: {
            type: "object", additionalProperties: false, required: ["vrai", "faits"],
            properties: { vrai: { type: "boolean" }, faits: { type: "array", maxItems: 6, items: { type: "integer" } } } } },
          constats: { type: "array", maxItems: 3, items: {
            type: "object", additionalProperties: false, required: ["texte", "fait"],
            properties: { texte: { type: "string", maxLength: 300 }, fait: { type: "integer" } } } },
          raisons: { type: "array", maxItems: 3, items: { type: "string", maxLength: 300 } },
        },
      },
      maxTokens: 2500,
    });
    sortie = r.data;
    sortie.raisons = sortie.raisons.map(sansRenvois);
    moteur = `llm:${r.modele}`;
    // Un critère sans fait existant n'est pas établi ; un constat sans fait existant est retiré.
    sortie.criteres = sortie.criteres.map((c) => ({ vrai: c.vrai && c.faits.some((n) => numero.has(n)), faits: c.faits.filter((n) => numero.has(n)) }));
    constats = sortie.constats.filter((c) => numero.has(c.fait))
      .map((c) => ({ texte: sansRenvois(c.texte), preuve_url: numero.get(c.fait)!.preuve_url as string, signal_id: Number(numero.get(c.fait)!.id) }));
  }

  const scoreSignal = Math.min(100, grille.reduce((s, g, i) => s + (sortie.criteres[i]?.vrai ? g.points : 0), 0));
  const retenue = (l.classes_retenues as string[]).includes(sortie.classe_activite);
  const scoreTotal = retenue ? Math.round(0.25 * scoreFit + 0.75 * scoreSignal) : 0;
  const raisons = { fit, classe: sortie.raisons, criteres: grille.map((g, i) => ({ ...g, vrai: !!sortie.criteres[i]?.vrai })) };

  await sql`insert into hub.scores (siren, ligne_code, version_grille, score_fit, score_signal, score_total, classe_activite, raisons, constats, moteur)
            values (${siren}, ${ligneCode}, ${l.grille_version}, ${scoreFit}, ${scoreSignal}, ${scoreTotal}, ${sortie.classe_activite},
                    ${sql.json(raisons as never)}, ${sql.json(constats as never)}, ${moteur})
            on conflict (siren, ligne_code, version_grille) do update set score_fit = excluded.score_fit, score_signal = excluded.score_signal,
              score_total = excluded.score_total, classe_activite = excluded.classe_activite, raisons = excluded.raisons,
              constats = excluded.constats, moteur = excluded.moteur, calcule_le = now()`;

  // ─── Statut ─────────────────────────────────────────────────────────────
  let statut = "enrichi";
  let motif: string | null = null;
  let rerouter: string | null = null;
  // Sans site, un profil LinkedIn trop pauvre donne « autre » faute d'information : ce n'est pas un motif d'écart.
  const ecartable = e.site_verifie || sortie.classe_activite !== "autre";
  if (signaux.length && !retenue && ecartable) {
    statut = "ecarte";
    motif = `classe ${sortie.classe_activite}`;
    const [autre] = await sql`select code from hub.lignes where ${sortie.classe_activite} = any(classes_retenues) and code <> ${ligneCode} limit 1`;
    rerouter = autre?.code ?? null;
  } else if (e.site_verifie) {
    const contactVerifie = contacts.some((c) => c.email_statut === "valide" || c.telephone_mobile || c.linkedin_url);
    const complete = contactVerifie && constats.length >= 3;
    if (complete && scoreTotal >= l.seuil_score) statut = "qualifie";
  } else if (retenue && constats.length >= 1 && contacts.some((c) => c.linkedin_url) && (l.canaux_autorises as string[]).includes("linkedin")
             && MOTS_VIN.test(normaliser(`${e.nom} ${e.enseignes.join(" ")} ${signaux.map((x) => `${x.valeur} ${x.extrait}`).join(" ")}`))) {
    // La voie LinkedIn exige un indice vin/boissons (nom, enseigne ou profil) : « agent commercial » seul ne dit pas de quoi.
    // Voie LinkedIn : sans site, la grille ne peut pas être notée ; un agent confirmé par son profil
    // est qualifié pour le seul canal LinkedIn (humain), quel que soit le seuil.
    statut = "qualifie";
    (raisons as Record<string, unknown>).voie = "linkedin";
  }
  if ((raisons as Record<string, unknown>).voie) {
    await sql`update hub.scores set raisons = ${sql.json(raisons as never)} where siren = ${siren} and ligne_code = ${ligneCode} and version_grille = ${l.grille_version}`;
  }
  await sql`update hub.ciblages set statut = ${statut}, motif_ecart = ${motif}, rerouter_vers = ${rerouter}, score_total = ${scoreTotal}, maj_le = now()
            where siren = ${siren} and ligne_code = ${ligneCode} and statut in ('source', 'enrichi', 'qualifie', 'ecarte')`;
  if (rerouter) {
    await sql`insert into hub.ciblages (siren, ligne_code) values (${siren}, ${rerouter}) on conflict do nothing`;
  }
  await evenement({ siren, ligne: ligneCode, type: "score", donnees: { scoreFit, scoreSignal, scoreTotal, classe: sortie.classe_activite, statut, rerouter }, acteur: "F5" });
  return { siren, classe: sortie.classe_activite, scoreFit, scoreSignal, scoreTotal, statut, constats: constats.length };
}
