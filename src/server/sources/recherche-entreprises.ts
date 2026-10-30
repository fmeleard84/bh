/**
 * API Recherche d'entreprises (recherche-entreprises.api.gouv.fr) : publique,
 * sans clé, Licence Ouverte 2.0. Elle refuse au-delà d'environ 7 requêtes/s
 * (mesuré au pilote) : un appel à la fois, 900 ms d'écart, reprise sur 429.
 */
const BASE = "https://recherche-entreprises.api.gouv.fr/search";
const ECART_MS = 900;

let dernierAppel = 0;

async function attendreTour() {
  const attente = dernierAppel + ECART_MS - Date.now();
  if (attente > 0) await new Promise((r) => setTimeout(r, attente));
  dernierAppel = Date.now();
}

export interface Dirigeant {
  nom?: string;
  prenoms?: string;
  annee_de_naissance?: string;
  qualite?: string;
  type_dirigeant: string;
  denomination?: string;
}

export interface Resultat {
  siren: string;
  nom_complet: string;
  nom_raison_sociale: string | null;
  sigle: string | null;
  nature_juridique: string | null;
  activite_principale: string | null;
  date_creation: string | null;
  tranche_effectif_salarie: string | null;
  categorie_entreprise: string | null;
  etat_administratif: string;
  nombre_etablissements_ouverts: number | null;
  opposition_diffusion_commerciale?: boolean;
  siege: {
    adresse: string | null;
    code_pays_etranger?: string | null;
    code_postal: string | null;
    libelle_commune: string | null;
    departement: string | null;
    latitude: string | null;
    longitude: string | null;
    liste_enseignes?: string[] | null;
    nom_commercial?: string | null;
  };
  dirigeants: Dirigeant[];
}

export interface Page {
  results: Resultat[];
  total_results: number;
  total_pages: number;
  page: number;
}

export async function chercher(params: Record<string, string | number>, essais = 5): Promise<Page> {
  const url = `${BASE}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`;
  for (let i = 0; i < essais; i++) {
    await attendreTour();
    const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
    if (res.ok) return (await res.json()) as Page;
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 2_000 * 2 ** i));
      continue;
    }
    throw new Error(`recherche-entreprises ${res.status} : ${(await res.text()).slice(0, 200)}`);
  }
  throw new Error(`recherche-entreprises : abandon après ${essais} essais (${url})`);
}
