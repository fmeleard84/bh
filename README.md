# BH — Business Hub

Hub commercial multi-marques (https://bh.vaya.rip). Il source, qualifie, contacte et suit les
prospects de toutes les lignes, sur le modèle de la Rédaction (/opt/blog). Cahier des charges :
`/opt/business/Hub commercial - Structure technique.docx`.

## Principes

- **Une ligne = une fiche de configuration** (`hub.lignes`) : cible, grille, seuil, voix, canaux,
  quotas, humain. Aucun code spécifique à une marque.
- **Société ≠ ciblage** : `entreprises` (faits, clé SIREN) et `ciblages` (SIREN × ligne : statut,
  score). Une société peut intéresser plusieurs lignes sans conflit.
- **Sans preuve, pas de donnée** : toute donnée porte `source` et `collecte_le` ; un signal porte
  sa `preuve_url`.
- **Cloisonnement par la base** : RLS par ligne (`db/migrations/0002_rls.sql`). L'application
  utilise le rôle `bh_app` avec l'utilisateur posé par transaction ; le worker est propriétaire.
- **Suppression de groupe** : `hub.est_supprime()` est vérifiée avant tout envoi, toutes lignes.
- **Local d'abord** : Trooper (LLM, embeddings), SearXNG, crawl4ai. Aucun service cloud n'est
  branché sans validation explicite.

## Exploitation

```bash
docker compose build && docker compose up -d       # web, worker, db, redis
set -a; . ./.env; set +a
DATABASE_URL=postgres://bh:$POSTGRES_PASSWORD@127.0.0.1:5490/bh npx tsx scripts/migrate.ts
DATABASE_URL=… ADMIN_EMAIL=… ADMIN_NAME=… npx tsx scripts/seed.ts
curl https://bh.vaya.rip/api/health                # base, redis, worker
./scripts/backup.sh                                # pg_dump vers /opt/backups/bh (14 jours)
```

Ports locaux : 3300 (web), 5490 (Postgres), 6393 (Redis), tous sur 127.0.0.1.
Secrets dans `.env` (non versionné).
