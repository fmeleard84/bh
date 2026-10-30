/** Outils de texte partagés par les flux : normalisation, formes juridiques, noms propres. */

export function sansAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Minuscules, sans accents, ponctuation réduite à des espaces. */
export function normaliser(s: string): string {
  return sansAccents(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const FORMES = /\b(sarl|sas|sasu|eurl|sa|sci|snc|scea|earl|gaec|selarl|ei|eirl|et cie|cie|societe|ste|ets|etablissements|groupe|holding|france)\b/g;

/** Raison sociale débarrassée des formes juridiques et des mots vides. */
export function nomUtile(nom: string): string {
  return normaliser(nom).replace(FORMES, " ").replace(/\b(le|la|les|l|de|du|des|d|et|en|a|au|aux)\b/g, " ").replace(/\s+/g, " ").trim();
}

/** « LANTUECH (LANTUECH) » → « Lantuech » ; « HERVE CHRISTOPHE » → « Herve ». */
export function nomPropre(s: string): string {
  return s
    .replace(/\s*\(.*?\)\s*/g, " ")
    .trim()
    .toLowerCase()
    .replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase());
}

export function premierPrenom(prenoms: string | null | undefined): string | null {
  const p = (prenoms ?? "").trim().split(/\s+/)[0];
  return p ? nomPropre(p) : null;
}

/** Ordre des tranches d'effectif INSEE, de la plus petite à la plus grande. */
export const TRANCHES = ["NN", "00", "01", "02", "03", "11", "12", "21", "22", "31", "32", "41", "42", "51", "52", "53"];

export function trancheDansBornes(tranche: string | null, min: string | null, max: string | null): boolean {
  const i = TRANCHES.indexOf(tranche ?? "NN");
  const a = min ? TRANCHES.indexOf(min) : 0;
  const b = max ? TRANCHES.indexOf(max) : TRANCHES.length - 1;
  return i >= a && i <= b;
}
