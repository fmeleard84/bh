/**
 * Le registre des entreprises écrit les prénoms en majuscules, sans accents.
 * Pour s'adresser à quelqu'un, on rétablit l'orthographe usuelle des prénoms
 * français les plus courants ; un prénom inconnu est gardé tel quel.
 */
const USUELS = [
  "Adélaïde", "Adèle", "Agnès", "Amélie", "Anaïs", "André", "Andrée", "Anaëlle", "Aurélie", "Aurélien", "Benoît", "Bérangère", "Bérénice",
  "Cécile", "Céline", "Chloé", "Clément", "Clémence", "Clémentine", "Danièle", "Delphine", "Désiré", "Élisabeth", "Élise", "Éloïse",
  "Émile", "Émilie", "Emmanuèle", "Éric", "Étienne", "Eugénie", "Félix", "Frédéric", "Frédérique", "Gaël", "Gaëlle",
  "Gaëtan", "Gérald", "Gérard", "Géraldine", "Géraud", "Grégoire", "Grégory", "Hélène", "Héloïse", "Hervé", "Inès", "Irène", "Jérémie",
  "Jérémy", "Jérôme", "Joël", "Joëlle", "José", "Josée", "Léa", "Léna", "Léo", "Léon", "Léonie", "Lætitia", "Loïc", "Loïs", 
  "Maël", "Maëlle", "Maïté", "Mathéo", "Médéric", "Mélanie", "Mélissa", "Michèle", "Mégane", "Noël", "Noémie", "Pénélope", "Raphaël",
  "Raphaëlle", "Rémi", "Rémy", "Régis", "Régine", "René", "Renée", "Sébastien", "Séverine", "Stéphane", "Stéphanie", "Thérèse",
  "Théo", "Théophile", "Timothée", "Valérie", "Véronique", "Zoé",
];
const PAR_CLE = new Map(USUELS.map((p) => [p.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(), p]));

export function prenomUsuel(prenom: string | null | undefined): string | null {
  if (!prenom) return null;
  return prenom
    .split("-")
    .map((part) => {
      const cle = part.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      return PAR_CLE.get(cle) ?? (part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part);
    })
    .join("-");
}

/** « de Olivier » → « d'Olivier » ; « de Hervé » reste (h aspiré non traité : on garde « de »). */
export function deNom(nom: string): string {
  return /^[aeiouyàâéèêëîïôöùûüœ]/i.test(nom) ? `d'${nom}` : `de ${nom}`;
}
