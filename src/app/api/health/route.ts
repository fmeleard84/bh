import { sysSql } from "@/server/db";
import { redis, HEARTBEAT_KEY } from "@/server/queue";

export const dynamic = "force-dynamic";

/** Sonde : base, Redis et worker. 503 si l'un des trois manque. */
export async function GET() {
  const etat: Record<string, string> = {};
  try { await sysSql()`select 1`; etat.db = "ok"; } catch { etat.db = "ko"; }
  try { etat.worker = (await redis().get(HEARTBEAT_KEY)) ? "ok" : "muet"; etat.redis = "ok"; } catch { etat.redis = "ko"; etat.worker = "inconnu"; }
  const ok = Object.values(etat).every((v) => v === "ok");
  return Response.json(etat, { status: ok ? 200 : 503 });
}
