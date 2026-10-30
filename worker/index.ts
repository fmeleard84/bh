import { Worker, type Processor } from "bullmq";
import { QUEUES, HEARTBEAT_KEY, redis, type QueueName } from "../src/server/queue";
import { sysSql } from "../src/server/db";
import { sourcer } from "../src/server/flux/f1-sourcer";
import { resoudre } from "../src/server/flux/f2-resoudre";

/**
 * Worker BH. Chaque flux est branché ici au fil des lots.
 * Concurrence volontairement basse : l'API Sirene, SearXNG, crawl4ai et le GPU
 * de Trooper sont partagés avec d'autres services.
 */

// F2 tourne société par société : une trace d'exécution regroupe un lot, close quand la file est vide.
let runF2: string | null = null;
async function compterF2(trouve: boolean | null) {
  const sql = sysSql();
  if (!runF2) [{ id: runF2 }] = await sql`insert into hub.runs (flux) values ('F2') returning id`;
  await sql`update hub.runs set lus = lus + 1, ecrits = ecrits + ${trouve ? 1 : 0}, erreurs = erreurs + ${trouve === null ? 1 : 0} where id = ${runF2}`;
}

const PROCESSORS: Partial<Record<QueueName, { fn: Processor; concurrency: number; drained?: () => Promise<void> }>> = {
  // Un seul F1 à la fois, toutes lignes confondues : l'API refuse au-delà de ~7 req/s.
  sourcer: { fn: async (job) => sourcer(job.data.ligne), concurrency: 1 },
  resoudre: {
    fn: async (job) => {
      try {
        const r = await resoudre(job.data.siren, { forcer: job.data.forcer });
        await compterF2(r?.trouve ?? false);
        return r;
      } catch (e) {
        await compterF2(null);
        throw e;
      }
    },
    concurrency: 3,
    drained: async () => {
      if (!runF2) return;
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
  clearInterval(timer);
  await Promise.all(workers.map((w) => w.close()));
  await sysSql().end();
  process.exit(0);
}
process.on("SIGTERM", arret);
process.on("SIGINT", arret);
