/** Lecture des réglages de ligne saisis dans l'interface (fonctions pures, testées). */

export function lireGrille(texte: string): { critere: string; points: number }[] {
  return texte.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^\s*\+?(\d{1,3})\s*\|\s*(.+)$/);
    if (!m) throw new Error(`Ligne de grille illisible : « ${l} » (attendu : « 15 | critère »)`);
    return { points: Number(m[1]), critere: m[2].trim() };
  });
}

export function lireClasses(texte: string): Record<string, string> {
  return Object.fromEntries(texte.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.indexOf(":");
    if (i < 1) throw new Error(`Classe illisible : « ${l} » (attendu : « classe : définition »)`);
    return [l.slice(0, i).trim().toLowerCase().replace(/\s+/g, "_"), l.slice(i + 1).trim()];
  }));
}
