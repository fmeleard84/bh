import { Queue } from "bullmq";
import IORedis from "ioredis";

/**
 * Une file par flux (cahier des charges §4). Une file lente (crawl, GPU partagé)
 * ne bloque jamais le traitement des réponses.
 */
export const QUEUES = ["sourcer", "resoudre", "extraire", "contacts", "scorer", "sequencer", "reponses", "pilotage"] as const;
export type QueueName = (typeof QUEUES)[number];

const g = globalThis as unknown as { __redis?: IORedis; __queues?: Partial<Record<QueueName, Queue>> };

export function redis(): IORedis {
  g.__redis ??= new IORedis(process.env.REDIS_URL ?? "redis://127.0.0.1:6393", { maxRetriesPerRequest: null });
  return g.__redis;
}

export function queue(name: QueueName): Queue {
  g.__queues ??= {};
  g.__queues[name] ??= new Queue(name, { connection: redis() });
  return g.__queues[name];
}

/** Un seul travail actif ou en attente par clé : relancer ne duplique rien. */
export async function enqueue(name: QueueName, data: Record<string, unknown>, cle: string, opts: { delay?: number } = {}) {
  await queue(name).add(name, data, {
    deduplication: { id: `${name}:${cle}` },
    attempts: 3,
    backoff: { type: "exponential", delay: 60_000 },
    removeOnComplete: 500,
    removeOnFail: 1000,
    ...opts,
  });
}

export const HEARTBEAT_KEY = "bh:worker:heartbeat";
