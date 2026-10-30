import { sysSql } from "../db";
import { enqueue } from "../queue";
import { chercher, type Resultat } from "../sources/recherche-entreprises";
import { nomPropre, premierPrenom, trancheDansBornes } from "../texte";
import { Run } from "./runs";

/**
 * F1 — Sourcer. Pour chaque NAF × département de la ligne : toutes les sociétés
 * actives du registre, avec leurs dirigeants personnes physiques.
 * Idempotent : une société déjà ciblée n'est ni dupliquée ni remise à zéro.
 *
 * Écartées dès la source :
 *  - opposition à la diffusion commerciale (registre INSEE) : jamais stockées ;
 *  - hors tranche d'effectif de la ligne ;
 *  - siège à l'étranger (succursale française d'une société étrangère).
 */
const SOURCE = "api:recherche-entreprises";

export async function sourcer(ligneCode: string) {
  const [ligne] = await sysSql()`select * from hub.lignes where code = ${ligneCode}`;
  if (!ligne) throw new Error(`ligne inconnue : ${ligneCode}`);
  if (!ligne.naf.length || !ligne.departements.length) throw new Error(`ligne ${ligneCode} : sourcing par NAF × département non configuré`);

  const run = await Run.debut("F1", ligneCode, { naf: ligne.naf, departements: ligne.departements });
  const ecarts = { opposition: 0, effectif: 0, inactive: 0, etranger: 0 };
  let nouveaux = 0;
  try {
    for (const naf of ligne.naf as string[]) {
      for (const dep of ligne.departements as string[]) {
        for (let page = 1; ; page++) {
          const p = await chercher({ activite_principale: naf, departement: dep, etat_administratif: "A", per_page: 25, page });
          for (const r of p.results) {
            run.lus++;
            if (r.etat_administratif !== "A") { ecarts.inactive++; continue; }
            if (r.opposition_diffusion_commerciale) { ecarts.opposition++; continue; }
            if (r.siege?.code_pays_etranger || !r.siege?.departement) { ecarts.etranger++; continue; }
            if (!trancheDansBornes(r.tranche_effectif_salarie, ligne.effectif_min, ligne.effectif_max)) { ecarts.effectif++; continue; }
            if (await enregistrer(r, ligneCode)) {
              nouveaux++;
              // L'enrichissement consomme des crédits de recherche : seulement si la ligne l'autorise.
              if (ligne.enrichissement_actif) await enqueue("resoudre", { siren: r.siren }, r.siren);
            }
            run.ecrits++;
          }
          run.detail = { ...run.detail, ecarts, nouveaux, en_cours: `${naf} × ${dep} page ${page}/${p.total_pages}` };
          await run.point();
          if (page >= p.total_pages) break;
        }
      }
    }
    delete run.detail.en_cours;
    await run.fin("ok");
  } catch (e) {
    run.erreurs++;
    await run.fin("erreur", (e as Error).message);
    throw e;
  }
}

/** Écrit la société, son ciblage et ses dirigeants. Rend true si le ciblage est nouveau. */
async function enregistrer(r: Resultat, ligneCode: string): Promise<boolean> {
  const sql = sysSql();
  const s = r.siege ?? {};
  const maintenant = new Date();
  const enseignes = [...new Set([...(s.liste_enseignes ?? []), s.nom_commercial, r.sigle].filter((x): x is string => !!x))];
  return sql.begin(async (tx) => {
    await tx`
      insert into hub.entreprises (siren, nom, nature_juridique, naf, date_creation, tranche_effectif, categorie, etat_administratif,
        adresse, cp, commune, departement, lat, lon, nb_etablissements, enseignes, source, collecte_le)
      values (${r.siren}, ${r.nom_raison_sociale ?? r.nom_complet}, ${r.nature_juridique}, ${r.activite_principale}, ${r.date_creation},
        ${r.tranche_effectif_salarie}, ${r.categorie_entreprise}, ${r.etat_administratif}, ${s.adresse}, ${s.code_postal},
        ${s.libelle_commune}, ${s.departement}, ${s.latitude ? Number(s.latitude) : null}, ${s.longitude ? Number(s.longitude) : null},
        ${r.nombre_etablissements_ouverts}, ${enseignes}, ${SOURCE}, ${maintenant})
      on conflict (siren) do update set nom = excluded.nom, nature_juridique = excluded.nature_juridique, naf = excluded.naf,
        tranche_effectif = excluded.tranche_effectif, categorie = excluded.categorie, etat_administratif = excluded.etat_administratif,
        adresse = excluded.adresse, cp = excluded.cp, commune = excluded.commune, departement = excluded.departement,
        lat = excluded.lat, lon = excluded.lon, nb_etablissements = excluded.nb_etablissements, enseignes = excluded.enseignes, maj_le = now()`;

    for (const d of r.dirigeants ?? []) {
      if (d.type_dirigeant !== "personne physique" || !d.nom) continue;
      await tx`
        insert into hub.contacts (siren, prenom, nom, qualite, annee_naissance, role_cible, source, collecte_le)
        values (${r.siren}, ${premierPrenom(d.prenoms)}, ${nomPropre(d.nom)}, ${d.qualite ?? null},
          ${d.annee_de_naissance ? Number(d.annee_de_naissance) : null}, true, ${SOURCE}, ${maintenant})
        on conflict (siren, lower(nom), lower(coalesce(prenom, ''))) do update set qualite = excluded.qualite, maj_le = now()`;
    }

    const nouveau = await tx`insert into hub.ciblages (siren, ligne_code) values (${r.siren}, ${ligneCode})
                             on conflict (siren, ligne_code) do nothing returning id`;
    if (nouveau.length) {
      await tx`insert into hub.evenements (siren, ligne_code, type, donnees, acteur)
               values (${r.siren}, ${ligneCode}, 'source', ${tx.json({ nom_complet: r.nom_complet } as never)}, 'F1')`;
    }
    return nouveau.length > 0;
  }) as Promise<boolean>;
}
