import { cookies } from "next/headers";
import { asUser } from "./db";

/**
 * Société en cours (une marque = une ligne) : choisie dans le sélecteur, gardée dans un cookie.
 * Une fois choisie, chaque page ne montre qu'elle ; « null » = vue d'ensemble, toutes marques.
 * Le code est revérifié contre les lignes visibles par l'utilisateur (RLS) : un cookie
 * modifié à la main ne donne accès à rien de plus.
 */
export const COOKIE_MARQUE = "bh_marque";

export interface Marque { code: string; marque: string; nom: string }

export async function marques(userId: string): Promise<Marque[]> {
  return (await asUser(userId, (sql) => sql`select code, marque, nom from hub.lignes order by marque, code`)) as unknown as Marque[];
}

export async function marqueCourante(userId: string): Promise<Marque | null> {
  const code = (await cookies()).get(COOKIE_MARQUE)?.value;
  if (!code) return null;
  return (await marques(userId)).find((m) => m.code === code) ?? null;
}
