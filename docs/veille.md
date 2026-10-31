# Cahier des charges — F9 Veille des comptes

Version 1 — 2026-10-31. Statut : à valider (Francis). Rien n'est développé.

## 1. Objet

Aujourd'hui, BH lit une société **une fois**, pour la qualifier, puis ne la regarde plus.
F9 surveille dans la durée les comptes qui comptent. Quand un compte ou son contact prend la
parole, ou quand un signal fort apparaît, F9 en tire **une proposition d'action** : un
commentaire, un message ou une relance appuyée sur ce signal. Cette proposition est soumise
à validation humaine.

> Dans le secteur A, le lead B a publié ceci → voici pourquoi c'est une occasion → voici ce
> que nous proposons de répondre.

Principe directeur, celui de toute l'application : BH travaille seul et ne fait remonter que
ce qui attend une décision. La veille ne doit **pas** produire un flux d'actualités à lire.
Elle produit au plus quelques propositions par semaine et par ligne, triées.

## 2. Périmètre

| Qui est surveillé | Pourquoi |
|---|---|
| Comptes **qualifiés**, **en séquence**, **ont répondu**, **opportunité** | Ceux avec qui une conversation existe ou va commencer |
| Leurs contacts dont le profil LinkedIn est **prouvé** (`contacts.linkedin_url`) | La preuve d'identité existe déjà (voie F5b) |
| Hors périmètre : comptes sourcés, écartés, et toute personne en **opposition** ou en liste de suppression | Minimisation (RGPD), coût |

Ordre de grandeur actuel : une trentaine de comptes (14 qualifiés pour TTGG), quelques
centaines à terme.

## 3. Sources

| # | Source | Ce qu'on en tire | Outil | Fréquence |
|---|---|---|---|---|
| S1 | **Publications LinkedIn du contact** (profil) | Sujet, date, extrait | Apify, robot *profile posts* **sans cookie** | hebdo |
| S2 | **Publications de la page entreprise** LinkedIn | Annonces, recrutements, salons | Apify, robot *company posts* sans cookie | hebdo |
| S3 | **Actualités de la société** | Presse, levée, rachat, nouveau client, salon | Serper (Google Actualités), déjà en place | hebdo |
| S4 | **Changements du site** | Nouvelles pages (produits, domaines représentés, équipe, offres d'emploi) | Lecteur BH (F3) : empreinte des pages déjà lues | mensuel |
| S5 | **Recrutements** | Offre d'emploi « déclarant en douane », « commercial vins »… : signal d'activité ou de besoin | Serper (Indeed, Welcome to the Jungle, France Travail), puis Apify au besoin | hebdo |
| S6 | **Google Maps** (Isoligne, TTGG cavistes) | Note, nombre d'avis, évolution | Apify `compass/crawler-google-places` | mensuel |

S5 reprend une pratique qui existe déjà : DeltaPro a mené une « veille recrutement douane »
(comptes et dirigeants, octobre 2026). Pour Velosiq, c'est le signal le plus utile : un
commissionnaire qui recrute un déclarant manque de temps de saisie.

S6 alimente aussi la notation : le critère Isoligne « trafic ou avis significatifs », que
rien ne mesure aujourd'hui.

## 4. Connecteurs Apify (modèle Mamie Futée)

Repris de `sales-vineyard-navigator/supabase/functions/_shared/apifyConnectors.ts`, qui a fait ses preuves :

- **un registre en base** des robots, et non des identifiants écrits dans le code. On change de
  robot sans redéployer, et on garde un robot de secours ;
- **appel synchrone** `POST /v2/acts/{robot}/run-sync-get-dataset-items` pour les petits volumes ;
  au-delà de quelques minutes, lancement asynchrone `runs`, suivi de l'exécution, puis lecture
  du jeu de données (comme `v4-sync-instagram-follows`) ;
- **état du dernier test** sur chaque robot (succès ou erreur, message), affiché dans Pilotage ;
- **consommation journalisée** (comme `_shared/usage.ts`) avec un plafond mensuel.

```sql
create table hub.connecteurs (
  id uuid primary key default gen_random_uuid(),
  plateforme text not null,          -- linkedin | google_maps | web
  usage text not null,               -- profile_posts | company_posts | places
  robot text not null,               -- identifiant Apify (« auteur~nom » ou id)
  principal boolean not null default false,
  priorite int not null default 10,  -- ordre des robots de secours
  actif boolean not null default true,
  config jsonb not null default '{}',-- paramètres d'entrée propres au robot
  sans_cookie boolean not null,      -- exigé à true pour LinkedIn (voir §8)
  cout_unitaire_cents numeric,       -- pour le plafond mensuel
  dernier_test_le timestamptz, dernier_test_statut text, dernier_test_erreur text
);
create table hub.consommation (jour date, service text, unites int, cout_cents numeric, primary key (jour, service));
```

Secret : `APIFY_API_KEY` dans `/opt/bh/.env`, ajouté par Francis. Le compte Apify existe
déjà, c'est celui de Mamie Futée. **Une clé dédiée à BH** est préférable, pour séparer la
consommation et pouvoir la révoquer.

Robots candidats, **à tester au lot 1** avant d'en retenir un. Ils sont choisis parmi ceux
qui n'exigent ni cookie ni compte LinkedIn :
- profile posts : *harvestapi/linkedin-profile-posts*, *apimaestro/linkedin-profile-posts* ;
- company posts : *harvestapi/linkedin-company-posts* ;
- Google Maps : *compass/crawler-google-places*.

Les robots de profil de Mamie Futée (`jupri`, `curious_coder`, `dev_fusion`) servent à
l'enrichissement de profils, pas aux publications. Ils sont à réévaluer avec la même règle.

## 5. Flux F9

```
lundi 6 h (avant F8 à 7 h)
  périmètre (§2) ─► collecte S1…S6 (connecteurs, Serper, F3)
                 ─► dédoublonnage (URL de la publication) et filtre de fraîcheur (< 21 jours)
                 ─► tri (IA « Trieur », service decide de Trooper) : pertinent ? pourquoi ? confiance
                 ─► sous 0,7 de confiance : ignoré (pas de « à lire » pour la veille)
                 ─► proposition (IA « Rédacteur ») : commentaire / message / relance
                 ─► tâche « veille » dans Ma journée, sur la carte de la ligne
```

**Tri : ce qui compte comme une occasion.** Les critères sont propres à la ligne et vivent
dans la fiche de ligne, pas dans le code (comme la grille) :
- TTGG : nouveau domaine représenté, salon (Wine Paris, Vinexpo, Prowein), recrutement d'un
  commercial, plainte sur la logistique ou les commandes panachées ;
- Velosiq : recrutement en douane ou en transit, nouvelle ligne, nouveau client, changement
  réglementaire commenté (ICS2, Brexit, CBAM), plainte sur la saisie ;
- Isoligne : refonte du site, lancement de catalogue, prise de parole sur l'IA ou le SEO, chute des avis.

**Proposition.** C'est la même règle que les séquences : aucun fait inventé, chaque
proposition cite le signal (lien et extrait), vouvoiement, pas de superlatif, 60 mots au plus
pour un commentaire. Trois formes :
- **commentaire** sous la publication. C'est l'humain qui le publie, BH ne publie rien ;
- **message** au contact, si une relation existe déjà (invitation acceptée ou mail échangé) ;
- **relance** : si une séquence est en cours, BH propose de remplacer la prochaine étape par un
  message qui s'appuie sur le signal (« j'ai vu que vous recrutiez un déclarant… »).

Un signal fort, comme un recrutement ou une levée, **remonte la priorité** du compte
(`ciblages.prochaine_action_le`) et peut requalifier un compte « enrichi » proche du seuil.

## 6. Données

```sql
create table hub.veille (
  id uuid primary key default gen_random_uuid(),
  ligne_code text not null references hub.lignes(code),
  siren char(9) not null references hub.entreprises(siren) on delete cascade,
  contact_id uuid references hub.contacts(id) on delete cascade,
  source text not null,              -- S1…S6
  url text not null,                 -- lien de la publication / de l'article
  publie_le timestamptz,
  extrait text not null check (length(extrait) <= 300), -- citation courte, jamais le texte entier
  sujet text,                        -- une phrase, écrite par le Trieur
  pertinent boolean, confiance real, raison text,
  proposition jsonb,                 -- {forme, texte}
  statut text not null default 'nouveau', -- nouveau | propose | fait | ignore
  traite_par uuid references hub.utilisateurs(id), traite_le timestamptz,
  collecte_le timestamptz not null default now(),
  expire_le timestamptz not null default now() + interval '90 days',
  unique (url, contact_id)
);
```

RLS par ligne, comme les autres tables. Une purge quotidienne supprime les lignes expirées.
Une opposition supprime immédiatement la veille du contact (`desinscrire`).

## 7. Interface

- **Carte de la ligne (Ma journée)** :
  - « À faire » : « 3 occasions de veille à saisir » ;
  - « À surveiller » : la santé de la veille (robot en erreur, plafond mensuel atteint à 80 %).
- **Section « Veille »** de Ma journée, au même format que les tâches : le signal (source, date,
  extrait, lien), pourquoi c'est une occasion, la proposition modifiable, puis les boutons
  **Fait**, **Ignorer** et **Pas pertinent**. Ce dernier sert d'exemple négatif au Trieur.
- **Fiche compte** : la frise des signaux de veille, avec les autres événements.
- **Pilotage** : les connecteurs (état, dernier test), la consommation du mois, et le taux
  d'occasions saisies par ligne.

## 8. Garde-fous

1. **Lecture seule.** BH ne publie, ne commente, ne s'abonne à rien et n'envoie aucune
   invitation. Toute action sur LinkedIn reste humaine (cahier §8).
2. **Aucun cookie, aucun compte.** Seuls les robots `sans_cookie = true` sont autorisés pour
   LinkedIn ; c'est vérifié par le code au moment de l'appel. Le compte LinkedIn de Francis
   n'est jamais exposé.
3. **Conditions d'utilisation de LinkedIn.** Elles interdisent l'extraction automatisée.
   C'est un risque **accepté par décision** de Francis, limité par le périmètre (§2) et les
   volumes. Cette décision modifie la règle du cahier §10, « aucune page LinkedIn n'est lue ni
   stockée », qui devient : « seuls le lien, la date et un extrait de 300 caractères au plus
   d'une publication publique sont conservés, 90 jours ».
4. **RGPD.**
   - Intérêt légitime documenté dans la page Conformité : prospection B2B, publications
     publiques et professionnelles.
   - Minimisation : lien, date, extrait court.
   - Conservation : 90 jours.
   - Opposition : elle arrête aussi la veille.
   - Aucune donnée sensible : le Trieur écarte les publications personnelles (santé, opinions,
     vie privée).
5. **Budget.** Un plafond mensuel par service dans `hub.consommation`. À 80 %, une alerte ;
   à 100 %, la veille s'arrête jusqu'au mois suivant, comme le plafond Serper.

## 9. Coûts estimés

Périmètre de 100 comptes et 150 contacts, collecte hebdomadaire :
- S1 et S2 : environ 250 profils ou pages × 4 semaines × ~5 publications, soit environ 5 000 éléments par mois. Aux tarifs Apify courants pour ce type de robot (de l'ordre de 1 à 2 $ pour 1 000 éléments), cela fait **5 à 10 $ par mois** ;
- S3 et S5 : environ 200 requêtes Serper par semaine, soit 800 par mois, dans le forfait actuel ;
- S6 : mensuel, quelques centaines de lieux, **moins de 5 $ par mois**.

Les tarifs exacts sont à relever au lot 1, robot par robot, et à inscrire dans `connecteurs.cout_unitaire_cents`.

## 10. Lots et critères d'acceptation

| Lot | Contenu | Accepté quand |
|---|---|---|
| **1 — Connecteurs** | `hub.connecteurs`, `hub.consommation`, client Apify (synchrone et asynchrone, secours, journal), test des robots candidats sur 5 contacts réels | Un robot par usage retenu, testé, sans cookie ; coût unitaire relevé ; Pilotage affiche l'état |
| **2 — Collecte** | F9 hebdomadaire, S1, S2, S3 ; table `hub.veille` ; purge à 90 jours ; opposition | Une semaine de collecte sur le périmètre ; zéro doublon ; zéro contact en opposition collecté |
| **3 — Tri et propositions** | Trieur et Rédacteur ; critères dans la fiche de ligne ; section Veille et carte | Sur 20 signaux relus par Francis, au moins 15 jugés bien triés ; aucune proposition qui cite un fait absent du signal |
| **4 — Signaux forts** | S5 recrutement, S4 changements du site, remontée de priorité, requalification | Un recrutement détecté fait remonter le compte dans la carte |
| **5 — Google Maps** | S6, alimentation du critère Isoligne « avis » | Le critère est noté sur les comptes Isoligne avec une fiche Maps |

## 11. Décisions attendues

1. Accepter le risque lié aux conditions de LinkedIn (§8.3) et la nouvelle règle §10 du cahier.
2. Créer une clé Apify dédiée à BH, ou réutiliser celle de Mamie Futée.
3. Valider les critères d'occasion par ligne (§5), qui iront dans les fiches de ligne.
4. Fixer le plafond mensuel : proposition 20 $ pour Apify.
