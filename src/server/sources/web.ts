import { promises as dns } from "node:dns";

/**
 * Lecture du web, en local uniquement : requête HTTP directe, crawl4ai (vaya)
 * pour les pages rendues en JavaScript, SearXNG (vaya) pour la recherche.
 * SearXNG est partagé avec la Rédaction : une requête toutes les 5 s au plus.
 */
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const TAILLE_MAX = 1_500_000;

export interface PageLue {
  url: string;
  html: string;
  texte: string;
  liens: { href: string; texte: string }[];
  /** Page vide sans JavaScript, lue par navigateur (crawl4ai). */
  renduJs?: boolean;
}

export function htmlVersTexte(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|section|footer|header)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&rsquo;/g, "'")
    .replace(/&eacute;/g, "é").replace(/&egrave;/g, "è").replace(/&agrave;/g, "à").replace(/&ccedil;/g, "ç")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function extraireLiens(html: string, base: string): { href: string; texte: string }[] {
  const liens: { href: string; texte: string }[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      liens.push({ href: new URL(m[1], base).toString(), texte: htmlVersTexte(m[2]).slice(0, 120) });
    } catch {
      /* lien mal formé */
    }
  }
  return liens;
}

export async function domaineExiste(domaine: string): Promise<boolean> {
  try {
    await dns.lookup(domaine);
    return true;
  } catch {
    return false;
  }
}

export async function lire(url: string): Promise<PageLue | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, "accept-language": "fr-FR,fr;q=0.9" },
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
    const html = (await res.text()).slice(0, TAILLE_MAX);
    let page: PageLue = { url: res.url, html, texte: htmlVersTexte(html), liens: extraireLiens(html, res.url) };
    // Page quasi vide : site rendu en JavaScript, on passe par crawl4ai.
    if (page.texte.length < 300) page = (await lireAvecNavigateur(res.url)) ?? page;
    return page;
  } catch {
    return null;
  }
}

async function lireAvecNavigateur(url: string): Promise<PageLue | null> {
  const base = process.env.CRAWL4AI_URL;
  if (!base) return null;
  try {
    const res = await fetch(`${base}/crawl`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ urls: [url], crawler_config: { type: "CrawlerRunConfig", params: { cache_mode: "bypass" } } }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    const r = ((await res.json()) as { results?: { html?: string; url?: string; success?: boolean }[] }).results?.[0];
    if (!r?.success || !r.html) return null;
    return { url: r.url ?? url, html: r.html, texte: htmlVersTexte(r.html), liens: extraireLiens(r.html, r.url ?? url), renduJs: true };
  } catch {
    return null;
  }
}

// ─── Recherche ──────────────────────────────────────────────────────────────

const ECART_RECHERCHE_MS = 5_000;
let derniereRecherche = 0;
let file: Promise<unknown> = Promise.resolve();

export interface ResultatRecherche {
  url: string;
  titre: string;
  extrait: string;
}

/**
 * Recherche web. Serper (résultats Google, service cloud validé le 2026-10-30)
 * quand une clé est configurée et que le plafond du mois n'est pas atteint ;
 * sinon SearXNG local, sérialisé et espacé (service partagé avec la Rédaction).
 */
export async function rechercher(q: string): Promise<ResultatRecherche[]> {
  if (process.env.SERPER_API_KEY && (await reserverSerper())) {
    try {
      return await rechercherSerper(q);
    } catch {
      /* Serper indisponible : repli local */
    }
  }
  return rechercherSearxng(q);
}

// Compteur mensuel partagé par tous les processus (Redis) : le plafond protège le budget.
async function reserverSerper(): Promise<boolean> {
  const { redis } = await import("../queue");
  const cle = `bh:serper:${new Date().toISOString().slice(0, 7)}`;
  const n = await redis().incr(cle);
  if (n === 1) await redis().expire(cle, 40 * 86400);
  if (n > Number(process.env.SERPER_MAX_MOIS ?? 2400)) {
    await redis().decr(cle);
    return false;
  }
  return true;
}

export async function consommationSerper(): Promise<number> {
  const { redis } = await import("../queue");
  return Number((await redis().get(`bh:serper:${new Date().toISOString().slice(0, 7)}`)) ?? 0);
}

async function rechercherSerper(q: string): Promise<ResultatRecherche[]> {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": process.env.SERPER_API_KEY!, "content-type": "application/json" },
    body: JSON.stringify({ q, gl: "fr", hl: "fr", num: 10 }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`serper ${res.status}`);
  const d = (await res.json()) as { organic?: { link: string; title: string; snippet?: string }[] };
  return (d.organic ?? [])
    .filter((r) => !/^https?:\/\/(www\.)?google\.[a-z.]+\/goto/.test(r.link))
    .map((r) => ({ url: r.link, titre: r.title, extrait: r.snippet ?? "" }));
}

/** SearXNG local, sérialisé et espacé. */
function rechercherSearxng(q: string): Promise<ResultatRecherche[]> {
  const tache = file.then(async () => {
    const attente = derniereRecherche + ECART_RECHERCHE_MS - Date.now();
    if (attente > 0) await new Promise((r) => setTimeout(r, attente));
    derniereRecherche = Date.now();
    const base = process.env.SEARXNG_URL ?? "http://127.0.0.1:8089";
    const engines = process.env.SEARXNG_ENGINES ?? "yandex";
    const res = await fetch(`${base}/search?${new URLSearchParams({ q, format: "json", engines, language: "fr" })}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`searxng ${res.status}`);
    const d = (await res.json()) as { results: { url: string; title: string; content?: string }[] };
    return d.results.map((r) => ({ url: r.url, titre: r.title, extrait: r.content ?? "" }));
  });
  file = tache.catch(() => {});
  return tache;
}
