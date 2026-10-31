import { sysSql } from "../src/server/db";
import { depensesDuMois, plafond, tester } from "../src/server/sources/apify";

/**
 * Connecteurs de la veille (docs/veille.md, lot 1).
 *   npx tsx scripts/connecteurs.ts liste
 *   npx tsx scripts/connecteurs.ts tester <plateforme> <usage> [robot] [url…]
 *       sans url : 5 cibles réelles prises en base (profils LinkedIn prouvés des comptes
 *       les mieux notés ; pour google_maps, « nom commune » de ces comptes).
 *       Rien n'est conservé du contenu : on relève le nombre d'éléments, la durée, le coût
 *       et les champs rendus ; le coût unitaire moyen est inscrit sur le connecteur.
 *   npx tsx scripts/connecteurs.ts principal <plateforme> <usage> <robot>
 */
const [action, plateforme, usage, robotArg, ...urls] = process.argv.slice(2);
const sql = sysSql();

async function cibles(): Promise<string[]> {
  if (urls.length) return urls;
  if (plateforme === "linkedin" && usage === "profile_posts") {
    return (await sql`select distinct on (c.score_total, k.linkedin_url) k.linkedin_url from hub.contacts k
                      join hub.ciblages c on c.siren = k.siren where k.linkedin_url is not null and not k.opt_out
                      order by c.score_total desc nulls last limit 5`).map((r) => r.linkedin_url as string);
  }
  if (plateforme === "google_maps") {
    return (await sql`select e.nom || ' ' || coalesce(e.commune, '') as q from hub.entreprises e join hub.ciblages c on c.siren = e.siren
                      where c.statut in ('qualifie', 'enrichi') order by c.score_total desc nulls last limit 5`).map((r) => r.q as string);
  }
  throw new Error(`donnez les url à tester pour ${plateforme}/${usage}`);
}

if (action === "liste") {
  for (const c of await sql`select plateforme, usage, robot, principal, priorite, actif, sans_cookie, cout_unitaire_cents,
                                   dernier_test_le, dernier_test_statut, dernier_test_erreur from hub.connecteurs order by plateforme, usage, priorite`) console.log(c);
  console.log(`dépenses du mois : ${(await depensesDuMois()) / 100} $ sur ${plafond() / 100} $`);
} else if (action === "tester") {
  const robots = robotArg && !robotArg.startsWith("http")
    ? [robotArg]
    : (await sql`select robot from hub.connecteurs where plateforme = ${plateforme} and usage = ${usage} and actif order by principal desc, priorite`).map((r) => r.robot as string);
  if (robotArg?.startsWith("http")) urls.unshift(robotArg);
  const liste = await cibles();
  for (const robot of robots) {
    let items = 0, cents = 0, ok = 0;
    for (const url of liste) {
      const r = await tester(plateforme, usage, robot, url);
      if (r.ok) {
        ok++; items += r.items.length; cents += r.cents;
        console.log(`${robot} ✓ ${url} : ${r.items.length} éléments, ${r.cents} c, ${r.duree_s} s ; champs : ${Object.keys(r.items[0] ?? {}).slice(0, 12).join(", ")}`);
      } else console.log(`${robot} ✗ ${url} : ${r.erreur}`);
    }
    if (items) await sql`update hub.connecteurs set cout_unitaire_cents = ${Math.round((cents / items) * 1000) / 1000}
                         where plateforme = ${plateforme} and usage = ${usage} and robot = ${robot}`;
    console.log(`→ ${robot} : ${ok}/${liste.length} réussis, ${items} éléments, ${cents} c${items ? `, ${(cents / items).toFixed(3)} c/élément` : ""}\n`);
  }
} else if (action === "principal") {
  await sql.begin(async (tx) => {
    await tx`update hub.connecteurs set principal = false where plateforme = ${plateforme} and usage = ${usage}`;
    await tx`update hub.connecteurs set principal = true, note = 'retenu' where plateforme = ${plateforme} and usage = ${usage} and robot = ${robotArg}`;
  });
} else {
  console.error("usage : connecteurs.ts liste | tester <plateforme> <usage> [robot] [url…] | principal <plateforme> <usage> <robot>");
  process.exit(1);
}
await sql.end();
