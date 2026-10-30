import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import postgres from "postgres";

/**
 * Fiches de ligne v1 (cahier des charges §9) et premier administrateur.
 * Rejouable : une fiche existante n'est pas écrasée (elle a pu être réglée depuis).
 * Les lignes démarrent inactives : aucun flux ne tourne avant leur activation.
 */
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

const LIGNES = [
  {
    code: "ttgg_agents",
    marque: "Tonton Gégé",
    nom: "TTGG Pro — agents commerciaux en vins",
    societe_expeditrice: "Tonton Gégé",
    naf: ["46.17B"],
    departements: ["13", "84", "83", "06", "30", "34", "11", "66", "31"],
    effectif_min: "NN",
    effectif_max: "03",
    classes_retenues: ["agent"],
    grille_signal: [
      { critere: "vend à cavistes/CHR pour le compte de domaines", points: 30 },
      { critere: "représente au moins 5 domaines", points: 15 },
      { critere: "représente au moins 15 domaines", points: 25 },
      { critere: "domaines dans au moins 3 régions", points: 15 },
      { critere: "pas de commande en ligne pour les pros", points: 10 },
      { critere: "« le vigneron expédie »", points: 10 },
      { critere: "2 personnes ou plus", points: 5 },
    ],
    seuil_score: 60,
    constat_type: "Vous représentez N domaines dans M régions : chaque commande panachée part de plusieurs chais.",
    offre_entree: "Baromètre agents (marché, marges, coûts logistiques) puis atelier visio 40 min, 10 agents",
    gabarit: { voix: "chaleureuse, directe, vouvoiement", longueur_max_j0: 90, signature: "Vincent Charulié" },
    canaux_autorises: ["email", "linkedin", "telephone"],
    quotas: { emails_jour: 150, invitations_linkedin_jour_par_compte: 15 },
    objectif_mensuel: { sources: 600, qualifies: 350, contactes: 250, reponses: "20-30", rdv: "8-12" },
  },
  {
    code: "isoligne_pme",
    marque: "Isoligne",
    nom: "Isoligne — PME à catalogue",
    societe_expeditrice: "LUNA",
    naf: [],
    departements: [],
    effectif_min: "02",
    effectif_max: "31",
    classes_retenues: ["e_commerce", "b2b_catalogue"],
    grille_signal: [
      { critere: "catalogue de plus de 50 références", points: 20 },
      { critere: "prix/stock non lisibles sans JS (scan)", points: 25 },
      { critere: "pas de données structurées produit", points: 20 },
      { critere: "FAQ absente", points: 10 },
      { critere: "trafic ou avis significatifs", points: 15 },
      { critere: "secteur avec intermédiation IA probable", points: 10 },
    ],
    seuil_score: 55,
    constat_type: "Un assistant IA ne lit ni vos prix ni vos stocks : score Isoligne X/100, axe faible Y.",
    offre_entree: "Rapport de scan gratuit, adresse permanente",
    gabarit: { voix: "experte, sobre, chiffrée", signature: "Francis" },
    canaux_autorises: ["email"],
    quotas: { emails_jour: 180 },
    objectif_mensuel: { scannes: 800, qualifies: 400, contactes: 300, reponses: "25-35", rdv: "10-15" },
  },
  {
    code: "velosiq_transit",
    marque: "Velosiq",
    nom: "Velosiq — transit et douane",
    societe_expeditrice: "DeltaPro",
    naf: ["52.29B", "52.29A"],
    departements: ["13", "76", "59", "62", "44", "33", "69", "67", "974"],
    effectif_min: "11",
    effectif_max: "31",
    classes_retenues: ["transitaire", "declarant", "commissionnaire"],
    grille_signal: [
      { critere: "mentionne dédouanement / représentation en douane", points: 30 },
      { critere: "agrément RDE ou OEA", points: 20 },
      { critere: "site muet sur les services ou les délais", points: 15 },
      { critere: "multi-sites", points: 10 },
      { critere: "export hors UE cité", points: 10 },
      { critere: "pas de portail client", points: 15 },
    ],
    seuil_score: 60,
    constat_type: "Vos clients ne trouvent sur votre site ni vos délais ni votre périmètre douanier.",
    offre_entree: "Présentation sécurité / souveraineté des données + démo",
    gabarit: { voix: "experte, réglementaire, rassurante", signature: "Jamil Moussa" },
    canaux_autorises: ["email", "linkedin", "telephone"],
    quotas: { emails_jour: 120, invitations_linkedin_jour_par_compte: 15 },
    objectif_mensuel: { sources: 400, qualifies: 200, contactes: 150, reponses: "12-18", rdv: "5-8" },
  },
];

for (const l of LIGNES) {
  await sql`insert into hub.lignes ${sql(l as any)} on conflict (code) do nothing`;
}

const email = process.env.ADMIN_EMAIL;
if (email) {
  const [existant] = await sql`select id from hub.utilisateurs where email = ${email}`;
  if (!existant) {
    const mdp = randomBytes(12).toString("base64url");
    await sql`insert into hub.utilisateurs (email, nom, mot_de_passe_hash, super_admin)
              values (${email}, ${process.env.ADMIN_NAME ?? "Administrateur"}, ${await bcrypt.hash(mdp, 12)}, true)`;
    console.log(`administrateur créé : ${email} / ${mdp}`);
  }
}
await sql.end();
console.log("seed terminé");
