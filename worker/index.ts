import { Worker, type Processor } from "bullmq";
import { QUEUES, HEARTBEAT_KEY, redis, type QueueName } from "../src/server/queue";
import { sysSql } from "../src/server/db";

/**
 * Worker BH. Chaque flux est branché ici au fil des lots (F1 au lot 1, etc.).
 * Concurrence volontairement basse : le GPU de Trooper et l'API Sirene sont partagés.
 */
const PROCESSORS: Partial<Record<QueueName, { fn: Processor; concurrency: number }>> = {};

const workers = QUEUES.flatMap((name) => {
  const p = PROCESSORS[name];
  if (!p) return [];
  return [new Worker(name, p.fn, { connection: redis(), concurrency: p.concurrency })];
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
