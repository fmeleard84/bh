import { Worker, type Processor } from "bullmq";
import { QUEUES, HEARTBEAT_KEY, redis, type QueueName } from "../src/server/queue";
import { sysSql } from "../src/server/db";
import { sourcer } from "../src/server/flux/f1-sourcer";
import { resoudre } from "../src/server/flux/f2-resoudre";
import { extraire } from "../src/server/flux/f3-extraire";
import { scorer } from "../src/server/flux/f5-scorer";
import { qualifierParLinkedin } from "../src/server/flux/f5b-linkedin";
import { trouverContacts } from "../src/server/flux/f4-contacts";
import { sequencer } from "../src/server/flux/f6-sequencer";
import { envoyerDus } from "../src/server/flux/envoi";
import { relever } from "../src/server/flux/f7-reponses";
import { rapportHebdo, seuils } from "../src/server/flux/f8-pilotage";
import { queue } from "../src/server/queue";
import { enqueue } from "../src/server/queue";

/**
 * Worker BH. Chaque flux est branché ici au fil des lots.
 * Concurrence volontairement basse : l'API Sirene, SearXNG, crawl4ai et le GPU
 * de Trooper sont partagés avec d'autres services.
 */

// F2 tourne société par société : une trace d'exécution regroupe un lot, close quand la file est vide.
let runF2: string | null = null;
// Fermer le worker vide aussi ses files : cela ne doit pas passer pour la fin d'un lot.
let arretEnCours = false;
async function compterF2(trouve: boolean | null) {
  const sql = sysSql();
  if (!runF2) [{ id: runF2 }] = await sql`insert into hub.runs (flux) values ('F2') returning id`;
  await sql`update hub.runs set lus = lus + 1, ecrits = ecrits + ${trouve ? 1 : 0}, erreurs = erreurs + ${trouve === null ? 1 : 0} where id = ${runF2}`;
}

const PROCESSORS: Partial<Record<QueueName, { fn: Processor; concurrency: number; drained?: () => Promise<void> }>> = {
  // F3 : lecture des sites et Extracteur (GPU de Trooper partagé : 2 à la fois au plus, borné aussi dans ia.ts).
  // Chaîne : site prouvé (F2) → lecture (F3) → personnes (F4) → qualification (F5).
  // Sans site, F2 passe directement à F4 : LinkedIn reste un canal de repli.
  extraire: {
    fn: async (job) => {
      const r = await extraire(job.data.siren, job.data.ligne);
      await enqueue("contacts", { siren: job.data.siren, ligne: job.data.ligne, scorer: r.faits > 0 }, `${job.data.siren}:${job.data.ligne}`);
      return r;
    },
    concurrency: 2,
  },
  contacts: {
    fn: async (job) => {
      const r = await trouverContacts(job.data.siren);
      if (job.data.scorer) await enqueue("scorer", { siren: job.data.siren, ligne: job.data.ligne }, `${job.data.siren}:${job.data.ligne}`);
      return r;
    },
    concurrency: 2,
  },
  scorer: { fn: async (job) => scorer(job.data.siren, job.data.ligne), concurrency: 2 },
  // Voie LinkedIn des comptes sans site (une recherche par dirigeant, puis qualification).
  linkedin: { fn: async (job) => qualifierParLinkedin(job.data.siren, job.data.ligne), concurrency: 2 },
  // F6 : une ligne à la fois (rédaction par le GPU partagé).
  sequencer: { fn: async (job) => sequencer(job.data.ligne, { max: job.data.max, siren: job.data.siren }), concurrency: 1 },
  // Tâches périodiques : envoi (2 min), relevé des réponses (5 min), F6 quotidien (8 h, jours ouvrés).
  pilotage: {
    fn: async (job) => {
      if (job.name === "envoi") return envoyerDus();
      if (job.name === "releve") return relever();
      if (job.name === "seuils") return { alertes: await seuils() };
      if (job.name === "f8-hebdo") {
        const lignes = await sysSql()`select code from hub.lignes`;
        return Promise.all(lignes.map((l) => rapportHebdo(l.code)));
      }
      if (job.name === "f6-quotidien") {
        const lignes = await sysSql()`select code from hub.lignes where active`;
        for (const l of lignes) await enqueue("sequencer", { ligne: l.code }, l.code);
        return { lignes: lignes.length };
      }
    },
    concurrency: 1,
  },
  // Un seul F1 à la fois, toutes lignes confondues : l'API refuse au-delà de ~7 req/s.
  sourcer: { fn: async (job) => sourcer(job.data.ligne), concurrency: 1 },
  resoudre: {
    fn: async (job) => {
      try {
        const r = await resoudre(job.data.siren, { forcer: job.data.forcer });
        await compterF2(r?.trouve ?? false);
        if (r) {
          const lignes = await sysSql()`select ligne_code from hub.ciblages where siren = ${job.data.siren} and statut = 'source'`;
          for (const l of lignes) {
            if (r.trouve) await enqueue("extraire", { siren: job.data.siren, ligne: l.ligne_code }, `${job.data.siren}:${l.ligne_code}`);
            else await enqueue("contacts", { siren: job.data.siren, ligne: l.ligne_code, scorer: false }, `${job.data.siren}:${l.ligne_code}`);
          }
        }
        return r;
      } catch (e) {
        await compterF2(null);
        throw e;
      }
    },
    concurrency: 3,
    drained: async () => {
      if (!runF2 || arretEnCours) return;
      await sysSql()`update hub.runs set statut = 'ok', fin_le = now() where id = ${runF2}`;
      runF2 = null;
    },
  },
};

const workers = QUEUES.flatMap((name) => {
  const p = PROCESSORS[name];
  if (!p) return [];
  const w = new Worker(name, p.fn, { connection: redis(), concurrency: p.concurrency });
  w.on("failed", (job, err) => console.error(`${name} ${job?.id} : ${err.message}`));
  if (p.drained) w.on("drained", () => void p.drained!().catch((e) => console.error("drained", e)));
  return [w];
});

// Planification idempotente : redémarrer le worker ne duplique rien.
await queue("pilotage").upsertJobScheduler("envoi", { every: 120_000 }, { name: "envoi" });
await queue("pilotage").upsertJobScheduler("releve", { every: 300_000 }, { name: "releve" });
await queue("pilotage").upsertJobScheduler("seuils", { every: 3_600_000 }, { name: "seuils" });
await queue("pilotage").upsertJobScheduler("f8-hebdo", { pattern: "0 7 * * 1", tz: "Europe/Paris" }, { name: "f8-hebdo" });
await queue("pilotage").upsertJobScheduler("f6-quotidien", { pattern: "0 8 * * 1-5", tz: "Europe/Paris" }, { name: "f6-quotidien" });

// Battement de cœur lu par /api/health : un worker muet se voit en moins de 2 minutes.
async function battement() {
  await redis().set(HEARTBEAT_KEY, new Date().toISOString(), "EX", 120);
}
await battement();
const timer = setInterval(() => battement().catch((e) => console.error("battement", e)), 30_000);

// Un flux interrompu par un redémarrage reste lisible comme tel au tableau de bord.
await sysSql()`update hub.runs set statut = 'interrompu', fin_le = now() where statut = 'en_cours'`;

console.log(`worker BH prêt (${workers.length} flux branchés)`);

async function arret() {
  arretEnCours = true;
  clearInterval(timer);
  await Promise.all(workers.map((w) => w.close()));
  await sysSql().end();
  process.exit(0);
}
process.on("SIGTERM", arret);
process.on("SIGINT", arret);
