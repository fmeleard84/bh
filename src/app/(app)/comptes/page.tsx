import Link from "next/link";
import { requireUser } from "@/server/auth";
import { asUser } from "@/server/db";

export const dynamic = "force-dynamic";

const PAR_PAGE = 50;
const STATUTS = ["source", "enrichi", "qualifie", "ecarte", "en_sequence", "repondu", "opportunite", "client"];

/**
 * Recherche de comptes : un outil pour retrouver et contrôler, pas une page
 * d'accueil. Filtres obligatoires par ligne, 50 résultats par page.
 */
export default async function Comptes({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const page = Math.max(1, Number(sp.page ?? 1));
  const q = (sp.q ?? "").trim();
  const site = sp.site ?? "";

  const { lignes, comptes, total } = await asUser(user.id, async (sql) => {
    const lignes = await sql`select code, nom from hub.lignes order by code`;
    const ligne = sp.ligne ?? lignes[0]?.code;
    const filtres = sql`
      c.ligne_code = ${ligne}
      ${sp.statut ? sql`and c.statut = ${sp.statut}` : sql``}
      ${site === "oui" ? sql`and e.site_verifie` : site === "non" ? sql`and not e.site_verifie and e.site_verifie_le is not null` : site === "attente" ? sql`and e.site_verifie_le is null` : sql``}
      ${q ? sql`and (e.nom ilike ${"%" + q + "%"} or e.siren = ${q} or e.commune ilike ${q + "%"})` : sql``}`;
    const comptes = await sql`
      select e.siren, e.nom, e.commune, e.departement, e.site_url, e.site_verifie, e.site_verifie_le, c.statut, c.score_total,
        (select string_agg(coalesce(prenom || ' ', '') || nom, ', ') from hub.contacts ct where ct.siren = e.siren and ct.role_cible) as dirigeants
      from hub.ciblages c join hub.entreprises e on e.siren = c.siren
      where ${filtres}
      order by c.score_total desc nulls last, e.nom
      limit ${PAR_PAGE} offset ${(page - 1) * PAR_PAGE}`;
    const [{ n }] = await sql`select count(*)::int as n from hub.ciblages c join hub.entreprises e on e.siren = c.siren where ${filtres}`;
    return { lignes, comptes, total: n as number };
  });

  const ligne = sp.ligne ?? lignes[0]?.code;
  const lien = (p: Record<string, string | number>) => `/comptes?${new URLSearchParams({ ...(sp as Record<string, string>), ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v)])) })}`;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Comptes</h1>
        <p className="muted text-sm">{total} comptes correspondent. Retrouver et contrôler : le travail du jour est dans « Ma journée ».</p>
      </header>

      <form className="card p-4 grid gap-3 sm:grid-cols-5">
        <select name="ligne" defaultValue={ligne} className="input">{lignes.map((l) => <option key={l.code} value={l.code}>{l.nom}</option>)}</select>
        <select name="statut" defaultValue={sp.statut ?? ""} className="input"><option value="">Tous statuts</option>{STATUTS.map((s) => <option key={s}>{s}</option>)}</select>
        <select name="site" defaultValue={site} className="input">
          <option value="">Site : tous</option><option value="oui">Site prouvé</option><option value="non">Site introuvable</option><option value="attente">Non encore cherché</option>
        </select>
        <input name="q" defaultValue={q} placeholder="Nom, SIREN, commune" className="input" />
        <button className="btn justify-center">Filtrer</button>
      </form>

      <section className="card overflow-x-auto">
        <table className="text-sm w-full">
          <thead><tr className="muted text-left"><th className="p-3">Société</th><th>Dirigeant</th><th>Commune</th><th>Site</th><th>Statut</th><th className="text-right pr-3">Score</th></tr></thead>
          <tbody>
            {comptes.map((c) => (
              <tr key={c.siren} className="border-t" style={{ borderColor: "var(--border)" }}>
                <td className="p-3"><Link href={`/comptes/${c.siren}`} className="font-medium hover:underline">{c.nom}</Link></td>
                <td className="text-2">{c.dirigeants ?? "—"}</td>
                <td className="text-2">{c.commune} ({c.departement})</td>
                <td>{c.site_verifie ? <a href={c.site_url} target="_blank" rel="noreferrer" className="pill pill-ok">{new URL(c.site_url).host}</a> : c.site_verifie_le ? <span className="pill">introuvable</span> : <span className="muted">…</span>}</td>
                <td><span className="pill">{c.statut}</span></td>
                <td className="text-right pr-3 tabular-nums">{c.score_total ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <nav className="flex gap-3 text-sm">
        {page > 1 && <Link className="pill" href={lien({ page: page - 1 })}>← Précédents</Link>}
        {page * PAR_PAGE < total && <Link className="pill" href={lien({ page: page + 1 })}>Suivants →</Link>}
      </nav>
    </div>
  );
}
