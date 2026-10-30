import { enqueue, queue, redis, QUEUES, type QueueName } from "../src/server/queue";
import { sysSql } from "../src/server/db";

/**
 * Lancer un flux à la main.
 *   npx tsx scripts/lancer.ts sourcer <ligne>
 *   npx tsx scripts/lancer.ts resoudre <siren>            (forcé)
 *   npx tsx scripts/lancer.ts resoudre-ligne <ligne>      (sociétés jamais vérifiées)
 *   npx tsx scripts/lancer.ts reverifier-ligne <ligne>    (toutes, forcé : après un changement des règles de preuve)
 *   npx tsx scripts/lancer.ts vider <file>                (retire les travaux en attente)
 *   npx tsx scripts/lancer.ts extraire-ligne <ligne>      (sites prouvés pas encore lus)
 *   npx tsx scripts/lancer.ts scorer-ligne <ligne>        (comptes lus, à (re)noter)
 *   npx tsx scripts/lancer.ts contacts-ligne <ligne>      (personnes : emails vérifiés, LinkedIn)
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
} else if (flux === "reverifier-ligne") {
  const rows = await sysSql()`select siren from hub.ciblages where ligne_code = ${cible}`;
  for (const r of rows) await enqueue("resoudre", { siren: r.siren, forcer: true }, `${r.siren}:force`);
  console.log(`${rows.length} sociétés en file`);
} else if (flux === "vider" && QUEUES.includes(cible as QueueName)) {
  await queue(cible as QueueName).drain(true);
} else if (flux === "extraire-ligne") {
  const rows = await sysSql()`select c.siren from hub.ciblages c join hub.entreprises e on e.siren = c.siren
                              where c.ligne_code = ${cible} and e.site_verifie and c.statut = 'source'`;
  for (const r of rows) await enqueue("extraire", { siren: r.siren, ligne: cible }, `${r.siren}:${cible}`);
  console.log(`${rows.length} sites en file`);
} else if (flux === "contacts-ligne") {
  const rows = await sysSql()`select c.siren, exists (select 1 from hub.signaux s where s.siren = c.siren) as lu
                              from hub.ciblages c join hub.entreprises e on e.siren = c.siren
                              where c.ligne_code = ${cible} and e.site_verifie_le is not null and c.statut in ('source', 'enrichi', 'qualifie')`;
  for (const r of rows) await enqueue("contacts", { siren: r.siren, ligne: cible, scorer: r.lu }, `${r.siren}:${cible}`);
  console.log(`${rows.length} comptes en file`);
} else if (flux === "scorer-ligne") {
  const rows = await sysSql()`select distinct c.siren from hub.ciblages c join hub.signaux s on s.siren = c.siren where c.ligne_code = ${cible}`;
  for (const r of rows) await enqueue("scorer", { siren: r.siren, ligne: cible }, `${r.siren}:${cible}`);
  console.log(`${rows.length} comptes en file`);
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
