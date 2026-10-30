import { normaliser } from "../texte";

/**
 * Contrôle de gabarit (cahier §5), appliqué par le code et jamais confié au
 * modèle : un message hors gabarit est régénéré une fois, puis signalé à l'humain.
 */
export interface Controle {
  ok: boolean;
  defauts: string[];
  mots: number;
}

const SUPERLATIFS = /\b(r[ée]volutionnaire|unique|incroyable|exceptionnel(le)?|extraordinaire|meilleur(e|s)?|leader|n[°o] ?1|booster|innovant(e)?|ultime|parfait(e)?|g[ée]nial(e)?)\b|!/i;
const TUTOIEMENT = /\b(tu|toi|ton|ta|tes|t'as|t'es)\b/i;
const LIEN = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|fr|net|io|vin)\b)/gi;

export function compterMots(texte: string): number {
  return texte.trim().split(/\s+/).filter(Boolean).length;
}

/** Le message reprend-il un constat ? Au moins 3 mots significatifs, ou un nombre, en commun. */
export function citeUnConstat(corps: string, constats: string[]): boolean {
  const mots = new Set(normaliser(corps).split(" ").filter((m) => m.length >= 5));
  const nombres = new Set(corps.match(/\d+/g) ?? []);
  return constats.some((c) => {
    const communs = normaliser(c).split(" ").filter((m) => m.length >= 5 && mots.has(m)).length;
    const memeNombre = (c.match(/\d+/g) ?? []).some((n) => nombres.has(n));
    return communs >= 3 || memeNombre;
  });
}

export function controler(
  etape: "j0" | "j7" | "j14" | "linkedin_note" | "script_appel",
  msg: { objet?: string; corps: string },
  ctx: { prenom: string | null; constats: string[]; lienAutorise?: boolean; autres?: string },
): Controle {
  const defauts: string[] = [];
  const mots = compterMots(msg.corps);
  const liens = msg.corps.match(LIEN) ?? [];
  const max = { j0: 90, j7: 70, j14: 50, linkedin_note: 40, script_appel: 120 }[etape];
  if (mots > max) defauts.push(`${mots} mots (max ${max})`);
  if (TUTOIEMENT.test(msg.corps)) defauts.push("tutoiement");
  if (SUPERLATIFS.test(`${msg.objet ?? ""} ${msg.corps}`)) defauts.push("superlatif ou point d'exclamation");
  if (/d[ée]sinscri|ne plus recevoir/i.test(msg.corps)) defauts.push("mention de désinscription (ajoutée par l'outil)");
  // Un nombre cité doit venir d'un constat prouvé ou de l'offre : le modèle n'invente aucun chiffre.
  const autorises = new Set([...ctx.constats.join(" ").matchAll(/\d+/g), ...(ctx.autres ?? "").matchAll(/\d+/g)].map((m) => m[0]));
  const inventes = [...`${msg.objet ?? ""} ${msg.corps}`.matchAll(/\d+/g)].map((m) => m[0]).filter((n) => !autorises.has(n));
  if (inventes.length) defauts.push(`chiffre(s) sans preuve : ${[...new Set(inventes)].join(", ")}`);
  if (msg.objet !== undefined && /^\s*(re|tr|fwd?)\s*:/i.test(msg.objet)) defauts.push("objet qui imite une réponse ou un transfert");

  if (etape === "j0") {
    if (liens.length) defauts.push("lien au premier message");
    if ((msg.corps.match(/\?/g) ?? []).length !== 1) defauts.push("il faut exactement une question");
    if (!citeUnConstat(msg.corps, ctx.constats)) defauts.push("aucun constat cité");
    if (ctx.prenom && !normaliser(msg.corps.split("\n")[0]).includes(normaliser(ctx.prenom))) defauts.push("salutation sans le prénom");
  }
  if (etape === "j7" && liens.length > (ctx.lienAutorise ? 1 : 0)) defauts.push("lien non autorisé");
  if (etape === "j14" && liens.length) defauts.push("lien au dernier message");
  if (etape === "linkedin_note") {
    if (msg.corps.length > 200) defauts.push(`${msg.corps.length} caractères (max 200)`);
    if (liens.length) defauts.push("lien dans la note LinkedIn");
  }
  if (msg.objet !== undefined) {
    const n = compterMots(msg.objet);
    if (n < 2 || n > 8) defauts.push(`objet de ${n} mots`);
  }
  return { ok: defauts.length === 0, defauts, mots };
}
