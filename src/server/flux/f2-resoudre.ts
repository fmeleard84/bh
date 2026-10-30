import { sysSql } from "../db";
import { domaineExiste, lire, rechercher } from "../sources/web";
import { communeNormalisee, domainesCandidats, estAnnuaire, liensUtiles, prouver, telephone } from "./verification";
import { evenement } from "./runs";

/**
 * F2 — Résoudre le site, entièrement en local.
 *  1. domaines devinés depuis la raison sociale et les enseignes (DNS puis lecture) ;
 *  2. à défaut, recherche web par SearXNG (« nom » commune), annuaires exclus.
 * Chaque candidat est lu (accueil + mentions légales/contact) et n'est retenu
 * que s'il est prouvé. Sans preuve, le site n'est pas utilisé par la suite.
 */
const NATURE_EI = "1000";

export async function resoudre(siren: string, opts: { forcer?: boolean } = {}) {
  const sql = sysSql();
  const [e] = await sql`select * from hub.entreprises where siren = ${siren}`;
  if (!e) return;
  if (e.site_verifie && !opts.forcer) return;
  const dirigeants = (await sql`select nom from hub.contacts where siren = ${siren} and source = 'api:recherche-entreprises'`).map((c) => c.nom as string);

  // Pour une entreprise individuelle, la raison sociale est le nom de la personne : seules les enseignes servent.
  const noms = e.nature_juridique === NATURE_EI ? e.enseignes : [...e.enseignes, e.nom];
  const essais: string[] = [];

  const verifier = async (origine: string) => {
    essais.push(origine);
    const accueil = await lire(origine);
    if (!accueil) return null;
    const host = new URL(accueil.url).host;
    if (estAnnuaire(host)) return null;
    const pages = [accueil];
    for (const url of liensUtiles(accueil.liens, host)) {
      const p = await lire(url);
      if (p) pages.push(p);
    }
    for (const p of pages) {
      const r = prouver(p.texte, p.url, siren, e.commune, dirigeants);
      if (r.verifie) {
        const tel = pages.map((x) => ({ t: telephone(x.texte), url: x.url })).find((x) => x.t);
        return { url: new URL(accueil.url).origin, preuve: r.preuve!, tel };
      }
    }
    return null;
  };

  let trouve: Awaited<ReturnType<typeof verifier>> = null;
  let methode = "";

  for (const d of domainesCandidats(noms)) {
    if (!(await domaineExiste(d))) continue;
    trouve = await verifier(`https://${d}/`);
    if (trouve) { methode = "domaine_devine"; break; }
  }

  if (!trouve) {
    const commune = communeNormalisee(e.commune) ?? "";
    const requetes = [...new Set([...e.enseignes, e.nature_juridique === NATURE_EI ? null : e.nom].filter(Boolean))].slice(0, 2);
    // Entreprise individuelle sans enseigne : on cherche la personne et la commune.
    if (!requetes.length && dirigeants[0]) requetes.push(dirigeants[0]);
    const vus = new Set<string>();
    for (const q of requetes) {
      let resultats: Awaited<ReturnType<typeof rechercher>> = [];
      try {
        resultats = await rechercher(`"${q}" ${commune}`);
      } catch (err) {
        await evenement({ siren, type: "recherche_echec", donnees: { erreur: (err as Error).message }, acteur: "F2" });
      }
      for (const r of resultats.slice(0, 8)) {
        let origine: string;
        try { origine = new URL(r.url).origin; } catch { continue; }
        if (estAnnuaire(new URL(origine).host) || vus.has(origine)) continue;
        vus.add(origine);
        if (vus.size > 4) break;
        trouve = await verifier(`${origine}/`);
        if (trouve) { methode = "recherche"; break; }
      }
      if (trouve) break;
    }
  }

  if (trouve) {
    await sql`update hub.entreprises set site_url = ${trouve.url}, site_verifie = true, site_preuve = ${trouve.preuve},
                site_verifie_le = now(),
                telephone = coalesce(telephone, ${trouve.tel?.t ?? null}),
                telephone_source = coalesce(telephone_source, ${trouve.tel?.url ?? null}),
                maj_le = now()
              where siren = ${siren}`;
    await evenement({ siren, type: "site_verifie", donnees: { url: trouve.url, preuve: trouve.preuve, methode, essais }, acteur: "F2" });
  } else {
    await sql`update hub.entreprises set site_verifie = false, site_verifie_le = now(), maj_le = now() where siren = ${siren}`;
    await evenement({ siren, type: "site_introuvable", donnees: { essais }, acteur: "F2" });
  }
  return { siren, trouve: !!trouve, methode };
}
