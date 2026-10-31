import { sysSql } from "../db";

/**
 * Client Apify de la veille (docs/veille.md §4), sur le modèle des connecteurs de Mamie Futée :
 * les robots viennent du registre hub.connecteurs (principal d'abord, puis secours par priorité),
 * chaque appel met à jour l'état du connecteur et la consommation du jour, un plafond mensuel
 * arrête tout au-delà du budget (APIFY_PLAFOND_CENTS, 2 000 = 20 $ par défaut).
 *
 * Un seul mode d'appel : lancement d'une exécution avec attente (waitForFinish), puis lecture
 * du jeu de données. Il couvre le cas « synchrone » des petits volumes et donne le coût réel
 * de l'exécution (usageTotalUsd), là où run-sync-get-dataset-items ne le donne pas.
 */
const API = "https://api.apify.com/v2";
const ATTENTE_S = 240;

export interface Connecteur {
  id: string; plateforme: string; usage: string; robot: string; principal: boolean; priorite: number;
  sans_cookie: boolean; config: Record<string, unknown>;
}

export class PlafondAtteint extends Error {}

function cle(): string {
  const k = process.env.APIFY_API_KEY;
  if (!k) throw new Error("APIFY_API_KEY absent de l'environnement");
  return k;
}

export async function depensesDuMois(): Promise<number> {
  const [r] = await sysSql()`select coalesce(sum(cout_cents), 0)::numeric as c from hub.consommation
                             where service = 'apify' and jour >= date_trunc('month', current_date)`;
  return Number(r.c);
}

export function plafond(): number {
  return Number(process.env.APIFY_PLAFOND_CENTS ?? 2000);
}

/** Remplace {{url}} dans le modèle d'entrée du robot, à toute profondeur. */
export function entree(config: unknown, url: string): unknown {
  if (typeof config === "string") return config.replaceAll("{{url}}", url);
  if (Array.isArray(config)) return config.map((x) => entree(x, url));
  if (config && typeof config === "object") return Object.fromEntries(Object.entries(config).map(([k, v]) => [k, entree(v, url)]));
  return config;
}

async function connecteurs(plateforme: string, usage: string, robot?: string): Promise<Connecteur[]> {
  return (await sysSql()`
    select * from hub.connecteurs where plateforme = ${plateforme} and usage = ${usage} and actif
      ${robot ? sysSql()`and robot = ${robot}` : sysSql()``}
    order by principal desc, priorite`) as unknown as Connecteur[];
}

async function noter(c: Connecteur, ok: boolean, erreur: string | null, detail: Record<string, unknown>) {
  await sysSql()`update hub.connecteurs set dernier_test_le = now(), dernier_test_statut = ${ok ? "ok" : "erreur"},
                 dernier_test_erreur = ${erreur}, dernier_test_detail = ${sysSql().json(detail as never)} where id = ${c.id}`;
}

async function compter(unites: number, cents: number) {
  await sysSql()`insert into hub.consommation (service, unites, cout_cents) values ('apify', ${unites}, ${cents})
                 on conflict (jour, service) do update set unites = hub.consommation.unites + excluded.unites,
                   cout_cents = hub.consommation.cout_cents + excluded.cout_cents`;
}

/** Une exécution d'un robot précis. Lève une erreur lisible ; ne bascule pas de robot. */
export async function executer(c: Connecteur, url: string): Promise<{ items: Record<string, unknown>[]; cents: number }> {
  if (c.plateforme === "linkedin" && !c.sans_cookie) throw new Error(`robot ${c.robot} refusé : LinkedIn exige un robot sans cookie`);
  if ((await depensesDuMois()) >= plafond()) throw new PlafondAtteint(`plafond Apify du mois atteint (${plafond() / 100} $)`);

  const res = await fetch(`${API}/acts/${encodeURIComponent(c.robot)}/runs?waitForFinish=${ATTENTE_S}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cle()}` },
    body: JSON.stringify(entree(c.config, url)),
    signal: AbortSignal.timeout((ATTENTE_S + 30) * 1000),
  });
  const corps = (await res.json().catch(() => ({}))) as { data?: { status?: string; defaultDatasetId?: string; usageTotalUsd?: number }; error?: { message?: string } };
  if (!res.ok || !corps.data) throw new Error(`Apify ${res.status} : ${corps.error?.message ?? "réponse illisible"}`);
  const run = corps.data;
  const cents = Math.round((run.usageTotalUsd ?? 0) * 10000) / 100;
  if (run.status !== "SUCCEEDED") {
    await compter(0, cents);
    throw new Error(`exécution ${run.status ?? "?"}${run.status === "RUNNING" ? ` (plus de ${ATTENTE_S} s)` : ""}`);
  }
  const ds = await fetch(`${API}/datasets/${run.defaultDatasetId}/items?clean=true&format=json&limit=200`, {
    headers: { authorization: `Bearer ${cle()}` },
    signal: AbortSignal.timeout(60_000),
  });
  const items = ds.ok ? ((await ds.json()) as Record<string, unknown>[]) : [];
  await compter(items.length, cents);
  return { items, cents };
}

/**
 * Appel d'un usage (« linkedin / profile_posts ») : le robot principal, puis les secours.
 * L'état de chaque robot essayé est noté ; le plafond arrête tout, sans essayer les suivants.
 */
export async function appeler(plateforme: string, usage: string, url: string): Promise<{ robot: string; items: Record<string, unknown>[] }> {
  const erreurs: string[] = [];
  for (const c of await connecteurs(plateforme, usage)) {
    const t0 = Date.now();
    try {
      const { items, cents } = await executer(c, url);
      await noter(c, true, null, { url, items: items.length, cents, duree_s: Math.round((Date.now() - t0) / 1000) });
      return { robot: c.robot, items };
    } catch (e) {
      if (e instanceof PlafondAtteint) throw e;
      const m = (e as Error).message.slice(0, 500);
      await noter(c, false, m, { url, duree_s: Math.round((Date.now() - t0) / 1000) });
      erreurs.push(`${c.robot} : ${m}`);
    }
  }
  throw new Error(`aucun robot ${plateforme}/${usage} n'a abouti${erreurs.length ? ` — ${erreurs.join(" ; ")}` : " (aucun robot actif)"}`);
}

/** Test d'un robot précis, sans bascule : pour départager les candidats (scripts/connecteurs.ts). */
export async function tester(plateforme: string, usage: string, robot: string, url: string) {
  const [c] = await connecteurs(plateforme, usage, robot);
  if (!c) throw new Error(`robot ${robot} inconnu ou inactif pour ${plateforme}/${usage}`);
  const t0 = Date.now();
  try {
    const { items, cents } = await executer(c, url);
    const duree_s = Math.round((Date.now() - t0) / 1000);
    await noter(c, true, null, { url, items: items.length, cents, duree_s, champs: Object.keys(items[0] ?? {}).slice(0, 30) });
    return { ok: true as const, items, cents, duree_s };
  } catch (e) {
    await noter(c, false, (e as Error).message.slice(0, 500), { url });
    return { ok: false as const, erreur: (e as Error).message };
  }
}
