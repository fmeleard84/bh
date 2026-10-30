import { enqueue, queue, redis, QUEUES, type QueueName } from "../src/server/queue";
import { sysSql } from "../src/server/db";

/**
 * Lancer un flux à la main.
 *   npx tsx scripts/lancer.ts sourcer <ligne>
 *   npx tsx scripts/lancer.ts resoudre <siren>            (forcé)
 *   npx tsx scripts/lancer.ts resoudre-ligne <ligne>      (sociétés jamais vérifiées)
 *   npx tsx scripts/lancer.ts pause|reprise <file>        (geler une file sans perdre son contenu)
 */
const [flux, cible] = process.argv.slice(2);

if (flux === "sourcer") {
  await enqueue("sourcer", { ligne: cible }, cible);
} else if (flux === "resoudre") {
  await enqueue("resoudre", { siren: cible, forcer: true }, `${cible}:force`);
} else if (flux === "resoudre-ligne") {
  const rows = await sysSql()`select e.siren from hub.entreprises e join hub.ciblages c on c.siren = e.siren
                              where c.ligne_code = ${cible} and e.site_verifie_le is null`;
  for (const r of rows) await enqueue("resoudre", { siren: r.siren }, r.siren);
  console.log(`${rows.length} sociétés en file`);
} else if ((flux === "pause" || flux === "reprise") && QUEUES.includes(cible as QueueName)) {
  if (flux === "pause") await queue(cible as QueueName).pause();
  else await queue(cible as QueueName).resume();
} else {
  console.error("usage : lancer.ts sourcer|resoudre|resoudre-ligne|pause|reprise <cible>");
  process.exit(1);
}
await redis().quit();
await sysSql().end();
console.log("fait");
