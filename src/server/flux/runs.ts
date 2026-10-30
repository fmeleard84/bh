import { sysSql } from "../db";

/**
 * Trace d'exécution d'un flux (table hub.runs) : ce que lit le pilotage pour
 * repérer un flux en panne. Les compteurs sont écrits au fil de l'eau.
 */
export class Run {
  lus = 0;
  ecrits = 0;
  erreurs = 0;
  detail: Record<string, unknown> = {};

  private constructor(readonly id: string) {}

  static async debut(flux: string, ligneCode: string | null, detail: Record<string, unknown> = {}): Promise<Run> {
    const [r] = await sysSql()`insert into hub.runs (flux, ligne_code, detail) values (${flux}, ${ligneCode}, ${sysSql().json(detail as never)}) returning id`;
    const run = new Run(r.id);
    run.detail = detail;
    return run;
  }

  async point() {
    await sysSql()`update hub.runs set lus = ${this.lus}, ecrits = ${this.ecrits}, erreurs = ${this.erreurs},
                   detail = ${sysSql().json(this.detail as never)} where id = ${this.id}`;
  }

  async fin(statut: "ok" | "erreur", message?: string) {
    if (message) this.detail.message = message;
    await this.point();
    await sysSql()`update hub.runs set statut = ${statut}, fin_le = now() where id = ${this.id}`;
  }
}

export async function evenement(e: { siren?: string; contactId?: string; ligne?: string; type: string; donnees?: Record<string, unknown>; acteur: string }) {
  await sysSql()`insert into hub.evenements (siren, contact_id, ligne_code, type, donnees, acteur)
                 values (${e.siren ?? null}, ${e.contactId ?? null}, ${e.ligne ?? null}, ${e.type}, ${sysSql().json((e.donnees ?? {}) as never)}, ${e.acteur})`;
}
