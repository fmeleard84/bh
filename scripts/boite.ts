import { sysSql } from "../src/server/db";

/**
 * Boîtes d'envoi : seul ce script les crée et les active (l'application ne le peut pas).
 *   npx tsx scripts/boite.ts ajouter <email> "<Nom affiché>" <ligne> <SECRET_REF> [quota]
 *   npx tsx scripts/boite.ts signature <email> "<signature>" "<adresse postale>"
 *   npx tsx scripts/boite.ts activer|pause <email> [motif]
 *   npx tsx scripts/boite.ts liste
 * Le mot de passe d'application Google vit dans .env sous le nom SECRET_REF, jamais en base.
 */
const [action, email, a, b, c, d] = process.argv.slice(2);
const sql = sysSql();

if (action === "ajouter") {
  if (!process.env[c]) console.warn(`attention : ${c} n'est pas défini dans l'environnement`);
  await sql`insert into hub.boites (email, nom_affiche, ligne_code, secret_ref, quota_jour) values (${email}, ${a}, ${b}, ${c}, ${Number(d ?? 25)})`;
  console.log(`boîte ${email} ajoutée, INACTIVE (warm-up d'abord, puis : activer)`);
} else if (action === "signature") {
  await sql`update hub.boites set signature = ${a}, adresse_postale = ${b} where email = ${email}`;
} else if (action === "activer") {
  await sql`update hub.boites set active = true, pause_motif = null where email = ${email}`;
} else if (action === "pause") {
  await sql`update hub.boites set active = false, pause_motif = ${a ?? "pause manuelle"} where email = ${email}`;
} else if (action === "liste") {
  for (const r of await sql`select email, ligne_code, active, quota_jour, pause_motif, secret_ref from hub.boites order by ligne_code, email`) console.log(r);
} else {
  console.error("usage : boite.ts ajouter|signature|activer|pause|liste …");
  process.exit(1);
}
await sql.end();
