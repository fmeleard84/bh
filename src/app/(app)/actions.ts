"use server";

import { revalidatePath } from "next/cache";
import { peutPiloter, requireUser } from "@/server/auth";
import { asUser, sysSql } from "@/server/db";
import { enqueue } from "@/server/queue";
import { validerSequence } from "@/server/flux/envoi";

/**
 * Décisions humaines de « Ma journée ». La RLS garantit que l'utilisateur voit
 * l'objet ; peutPiloter qu'il a le droit d'agir sur sa ligne.
 */
async function sequenceAutorisee(sequenceId: string) {
  const user = await requireUser();
  const [s] = await asUser(user.id, (sql) => sql`select id, ligne_code, contact_id from hub.sequences where id = ${sequenceId}`);
  if (!s || !(await peutPiloter(user, s.ligne_code))) throw new Error("Réservé au responsable de la ligne.");
  return { user, s };
}

export async function valider(form: FormData) {
  const { user } = await sequenceAutorisee(String(form.get("sequence")));
  const retouches: Record<string, { objet?: string; corps?: string }> = {};
  for (const [k, v] of form.entries()) {
    const [champ, id] = k.split(":");
    if ((champ === "objet" || champ === "corps") && id) (retouches[id] ??= {})[champ] = String(v);
  }
  await validerSequence(String(form.get("sequence")), user.id, retouches);
  revalidatePath("/");
}

async function supprimerBrouillon(sequenceId: string) {
  await sysSql().begin(async (tx) => {
    await tx`delete from hub.echanges where sequence_id = ${sequenceId} and statut_envoi = 'a_valider'`;
    await tx`delete from hub.sequences where id = ${sequenceId} and statut = 'planifiee'`;
  });
}

export async function regenerer(form: FormData) {
  const { s } = await sequenceAutorisee(String(form.get("sequence")));
  const [c] = await sysSql()`select siren from hub.contacts where id = ${s.contact_id}`;
  await supprimerBrouillon(s.id);
  await enqueue("sequencer", { ligne: s.ligne_code, siren: c.siren, max: 1 }, `${s.ligne_code}:${c.siren}`);
  revalidatePath("/");
}

export async function ecarter(form: FormData) {
  const { user, s } = await sequenceAutorisee(String(form.get("sequence")));
  const [c] = await sysSql()`select siren from hub.contacts where id = ${s.contact_id}`;
  await supprimerBrouillon(s.id);
  await sysSql()`update hub.ciblages set statut = 'ecarte', motif_ecart = ${`écarté par ${user.nom}`}, maj_le = now()
                 where siren = ${c.siren} and ligne_code = ${s.ligne_code}`;
  revalidatePath("/");
}

export async function tacheFaite(form: FormData) {
  const user = await requireUser();
  const id = String(form.get("tache"));
  await asUser(user.id, (sql) => sql`update hub.taches set fait_le = now(), fait_par = ${user.id}, resultat = ${String(form.get("resultat") ?? "fait")}
                                     where id = ${id} and fait_le is null`);
  revalidatePath("/");
}

/** Réponse traitée ; « opportunite » fait passer le compte dans le suivi commercial. */
export async function reponseTraitee(form: FormData) {
  const user = await requireUser();
  const id = String(form.get("echange"));
  const issue = String(form.get("issue") ?? "traite");
  await asUser(user.id, async (sql) => {
    const [x] = await sql`update hub.echanges set traite_par = ${user.id}, traite_le = now() where id = ${id} returning contact_id, ligne_code`;
    if (x && issue === "opportunite") {
      await sql`update hub.ciblages set statut = 'opportunite', maj_le = now()
                where ligne_code = ${x.ligne_code} and siren = (select siren from hub.contacts where id = ${x.contact_id})`;
    }
  });
  revalidatePath("/");
}
