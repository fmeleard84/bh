import Link from "next/link";
import { CircleAlert, CircleCheck, Eye, RefreshCw } from "lucide-react";
import type { Carte, Point, Serie } from "@/server/cartes";

/**
 * Une carte par ligne : d'abord ce qui attend un humain, puis ce que BH fait seul,
 * l'entonnoir, l'évolution sur 8 semaines, les points à surveiller ; la cible en dépliant.
 */
export function CarteLigne({ c, large }: { c: Carte; large?: boolean }) {
  return (
    <article className={`card p-5 text-sm ${large ? "grid gap-6 lg:grid-cols-3 items-start [&>header]:lg:col-span-3" : "space-y-5"}`}>
      <header className="flex justify-between items-start gap-3">
        <div>
          <div className="muted text-xs">{c.marque}</div>
          <Link href={`/lignes/${c.code}`} className="font-semibold text-base hover:underline">{c.nom}</Link>
          <div className="muted text-xs mt-1">{c.domaine ?? "domaine d'envoi à définir"} · {c.boites.map((b) => b.email).join(", ") || "aucune boîte"}</div>
        </div>
        <span className={`pill whitespace-nowrap ${c.envoi === "ouvert" ? "pill-ok" : ""}`}>envoi {c.envoi}</span>
      </header>

      <section>
        <h3 className="font-semibold mb-2">À faire</h3>
        {c.aFaire.length === 0 ? (
          <p className="flex items-center gap-2" style={{ color: "var(--ok)" }}><CircleCheck size={16} /> Rien à faire : BH avance seul.</p>
        ) : (
          <ul className="space-y-1.5">{c.aFaire.map((p) => <Ligne key={p.texte} p={p} icone={<CircleAlert size={16} style={{ color: "var(--accent)" }} />} fort />)}</ul>
        )}
      </section>

      <section>
        <h3 className="font-semibold mb-2">En cours</h3>
        {c.enCours.length === 0 ? <p className="muted">Rien ne tourne en ce moment.</p> : (
          <ul className="space-y-1 text-2">{c.enCours.map((t) => <li key={t} className="flex items-start gap-2"><RefreshCw size={14} className="mt-0.5 shrink-0 muted" /> {t}</li>)}</ul>
        )}
      </section>

      <section>
        <h3 className="font-semibold mb-2">Ce que nous avons</h3>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {c.entonnoir.map((e) => (
            <div key={e.etape} className="rounded-lg p-2 text-center" style={{ background: "var(--surface-2)" }}>
              <div className="text-lg font-bold tabular-nums">{e.n}</div>
              <div className="muted text-xs">{e.etape}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="font-semibold mb-2">Évolution, 8 dernières semaines</h3>
        <table className="w-full">
          <thead className="sr-only"><tr><th>Indicateur</th><th>Courbe</th><th>Cette semaine</th><th>Total 8 semaines</th></tr></thead>
          <tbody>
            {c.evolution.map((s) => {
              const total = s.semaines.reduce((a, w) => a + w.n, 0);
              const derniere = s.semaines.at(-1)?.n ?? 0;
              return (
                <tr key={s.nom}>
                  <td className="py-1 pr-2 text-2">{s.nom}</td>
                  <td className="py-1 pr-2"><Courbe s={s} /></td>
                  <td className="py-1 pr-2 text-right tabular-nums" title="cette semaine">{derniere}</td>
                  <td className="py-1 text-right tabular-nums muted" title="total 8 semaines">{total}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="muted text-xs mt-1">Colonnes : cette semaine · total sur 8 semaines. Survolez la courbe pour le détail.</p>
      </section>

      {c.attention.length > 0 && (
        <section>
          <h3 className="font-semibold mb-2">À surveiller</h3>
          <ul className="space-y-1.5 text-2">{c.attention.map((p) => <Ligne key={p.texte} p={p} icone={<Eye size={16} className="muted" />} />)}</ul>
        </section>
      )}

      <details>
        <summary className="cursor-pointer font-semibold">Ce que nous cherchons</summary>
        <ul className="mt-2 space-y-1 text-2 list-disc pl-5">
          {c.cherche.cible.map((x) => <li key={x}>{x}</li>)}
          {c.cherche.constat && <li>Constat d'accroche : {c.cherche.constat}</li>}
          {c.cherche.offre && <li>Offre d'entrée : {c.cherche.offre}</li>}
          <li>Qualifié à partir de {c.cherche.seuil}/100 · canaux : {c.cherche.canaux.join(", ")}</li>
        </ul>
        <Link href={`/lignes/${c.code}`} className="inline-block mt-2 underline muted">Fiche complète de la ligne</Link>
      </details>
    </article>
  );
}

function Ligne({ p, icone, fort }: { p: Point; icone: React.ReactNode; fort?: boolean }) {
  const texte = <span className={fort ? "font-medium" : ""}>{p.texte}</span>;
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0">{icone}</span>
      {p.href ? <Link href={p.href} className="hover:underline">{texte}</Link> : texte}
    </li>
  );
}

/** Courbe d'une seule série : trait de 2 px, dernier point marqué, une zone de survol par semaine. */
function Courbe({ s }: { s: Serie }) {
  const L = 140, H = 30, M = 4;
  const max = Math.max(1, ...s.semaines.map((w) => w.n));
  const pas = (L - 2 * M) / Math.max(1, s.semaines.length - 1);
  const pts = s.semaines.map((w, i) => ({ x: M + i * pas, y: H - M - (w.n / max) * (H - 2 * M), ...w }));
  const dernier = pts.at(-1);
  return (
    <svg width={L} height={H} viewBox={`0 0 ${L} ${H}`} role="img" aria-label={`${s.nom} : ${s.semaines.map((w) => `${w.semaine} ${w.n}`).join(", ")}`}>
      <line x1={M} x2={L - M} y1={H - M} y2={H - M} stroke="var(--border)" strokeWidth={1} />
      <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {dernier && <circle cx={dernier.x} cy={dernier.y} r={3} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />}
      {pts.map((p) => (
        <rect key={p.semaine} x={p.x - pas / 2} y={0} width={pas} height={H} fill="transparent">
          <title>{`semaine du ${p.semaine} : ${p.n}`}</title>
        </rect>
      ))}
    </svg>
  );
}
