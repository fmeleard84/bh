# Domaines d'envoi — procédure de mise en service

Domaines achetés le 2026-10-30 (chez LWS). À reprendre une fois la propagation DNS faite
(vérifier : `dig +short NS <domaine>` répond `lwsdns.com`).

Règle : la prospection ne part **jamais** d'un domaine de marque (tontongg.com, velosiq.com,
isoligne.com…), ni d'un alias sur ces domaines. Un domaine secondaire dédié, de vrais utilisateurs.

| Marque | Workspace | Domaine secondaire | Boîtes (personnes réelles) | Société expéditrice |
|---|---|---|---|---|
| Velosiq | Velosiq (existant, à faire en premier) | _à compléter_ | Jamil, Adrien | DeltaPro |
| TTGG | vaya.rip | _à compléter_ | Vincent + Francis ou Nadège | Tonton Gégé |
| Isoligne | vaya.rip | _à compléter_ | Francis | LUNA |

## Étapes, pour chaque domaine

1. **Workspace** — admin.google.com → Compte → Domaines → Gérer les domaines → Ajouter un domaine →
   **« Domaine secondaire »** (pas « Alias de domaine de l'utilisateur »). Noter le TXT de vérification.
2. **DNS chez LWS** (fiche exacte préparée par Claude au moment voulu) :
   - TXT de vérification Google
   - MX `1 smtp.google.com`
   - TXT SPF `v=spf1 include:_spf.google.com ~all`
   - TXT `_dmarc` : `v=DMARC1; p=none; rua=mailto:<boîte de rapports>` (puis `p=quarantine` après 2 semaines)
   - A `@` et `www` → `37.27.67.11` (vaya : redirection vers le site de la marque + page de désinscription, route Traefik ajoutée par Claude)
3. **DKIM** — Applications → Google Workspace → Gmail → Authentifier les e-mails → domaine → clé **2048 bits** →
   publier le TXT `google._domainkey` chez LWS → « Démarrer l'authentification ».
4. **Utilisateurs** — `prenom@<domaine>` ; chaque personne se connecte, active la validation en deux étapes
   (autorisée dans Sécurité → Validation en deux étapes), crée un mot de passe d'application
   (myaccount.google.com/apppasswords).
5. **Secrets** — ajouter soi-même dans `/opt/bh/.env` : `BOITE_<PRENOM>_<MARQUE>=<mot de passe d'application>`
   (jamais dans une conversation ni en base). Puis :
   `npx tsx scripts/boite.ts ajouter <email> "<Nom>" <ligne> BOITE_<PRENOM>_<MARQUE> 25`
   et `npx tsx scripts/boite.ts signature <email> "<Signature>" "<Adresse postale>"`. Les boîtes restent **inactives**.
6. **Warm-up** — 3 à 4 semaines, de 5 à 25 messages/jour/boîte (montée manuelle ou service, à décider).
7. **Postmaster Tools** — postmaster.google.com → ajouter le domaine (TXT).
8. **Ouverture** — `BH_DESINSCRIPTION_URL=https://<domaine>/d` par ligne, `scripts/boite.ts activer`, ligne active,
   `BH_ENVOI_ACTIF=1`. Critère : test de placement > 90 % en boîte principale avant tout envoi réel.
