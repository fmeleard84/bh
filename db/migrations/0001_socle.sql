-- BH — socle de données.
--
-- Écart assumé avec le cahier des charges (§3) : la société (entreprises, clé
-- SIREN) est séparée de son ciblage par une ligne (ciblages, clé SIREN × ligne).
-- Une même société peut intéresser plusieurs lignes (caviste re-routé, base
-- réutilisée par Isoligne) sans écraser le statut ni le score d'une autre.
--
-- Toute donnée collectée porte sa source et sa date (source, collecte_le).

create extension if not exists citext;
create schema if not exists hub;

-- ─── Utilisateurs et droits ────────────────────────────────────────────────
create table hub.utilisateurs (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  nom text not null,
  mot_de_passe_hash text,
  super_admin boolean not null default false,
  actif boolean not null default true,
  cree_le timestamptz not null default now()
);

-- ─── Lignes : une fiche de configuration par cible commerciale ─────────────
create table hub.lignes (
  code text primary key check (code ~ '^[a-z0-9_]+$'),
  marque text not null,
  nom text not null,
  societe_expeditrice text not null,
  naf text[] not null default '{}',
  departements text[] not null default '{}',
  effectif_min text,
  effectif_max text,
  classes_retenues text[] not null default '{}',
  grille_signal jsonb not null default '[]',
  grille_version int not null default 1,
  seuil_score int not null default 60 check (seuil_score between 0 and 100),
  constat_type text,
  offre_entree text,
  gabarit jsonb not null default '{}',
  canaux_autorises text[] not null default '{}',
  proprietaire_id uuid references hub.utilisateurs(id),
  domaines_envoi text[] not null default '{}',
  quotas jsonb not null default '{}',
  objectif_mensuel jsonb not null default '{}',
  active boolean not null default false,
  maj_le timestamptz not null default now()
);

create table hub.acces_lignes (
  utilisateur_id uuid not null references hub.utilisateurs(id) on delete cascade,
  ligne_code text not null references hub.lignes(code) on delete cascade,
  role text not null check (role in ('responsable', 'membre', 'lecteur')),
  primary key (utilisateur_id, ligne_code)
);

-- ─── Entreprises : les faits sur une société, indépendants des lignes ──────
create table hub.entreprises (
  siren char(9) primary key check (siren ~ '^[0-9]{9}$'),
  nom text not null,
  nature_juridique text,
  naf text,
  date_creation date,
  tranche_effectif text,
  categorie text,
  etat_administratif text,
  adresse text,
  cp text,
  commune text,
  departement text,
  lat double precision,
  lon double precision,
  nb_etablissements int,
  site_url text,
  site_verifie boolean not null default false,
  site_preuve text,
  site_verifie_le timestamptz,
  telephone text,
  telephone_source text,
  source text not null,
  collecte_le timestamptz not null,
  maj_le timestamptz not null default now()
);
create index on hub.entreprises (naf, departement);

-- ─── Ciblages : une société vue par une ligne ──────────────────────────────
create table hub.ciblages (
  id bigint generated always as identity primary key,
  siren char(9) not null references hub.entreprises(siren) on delete cascade,
  ligne_code text not null references hub.lignes(code),
  statut text not null default 'source' check (statut in
    ('source', 'enrichi', 'qualifie', 'ecarte', 'en_sequence', 'repondu', 'opportunite', 'client')),
  motif_ecart text,
  rerouter_vers text references hub.lignes(code),
  score_total int,
  prochaine_action_le timestamptz,
  cree_le timestamptz not null default now(),
  maj_le timestamptz not null default now(),
  unique (siren, ligne_code)
);
create index on hub.ciblages (ligne_code, statut, score_total desc);

-- ─── Contacts ───────────────────────────────────────────────────────────────
create table hub.contacts (
  id uuid primary key default gen_random_uuid(),
  siren char(9) not null references hub.entreprises(siren) on delete cascade,
  prenom text,
  nom text not null,
  qualite text,
  annee_naissance int,
  email citext,
  email_statut text not null default 'inconnu' check (email_statut in
    ('valide', 'risque', 'invalide', 'generique', 'inconnu')),
  email_source text,
  email_verifie_le timestamptz,
  telephone_fixe text,
  telephone_mobile text,
  tel_source text,
  linkedin_url text,
  linkedin_source text,
  role_cible boolean not null default false,
  opt_out boolean not null default false,
  opt_out_le timestamptz,
  source text not null,
  collecte_le timestamptz not null,
  maj_le timestamptz not null default now(),
  unique (siren, email),
  unique (siren, linkedin_url)
);
-- Une même personne sourcée deux fois (registre puis site) fusionne au lieu de dupliquer.
create unique index contacts_personne on hub.contacts (siren, lower(nom), lower(coalesce(prenom, '')));

-- ─── Signaux : un fait + sa preuve, jamais une interprétation ──────────────
create table hub.signaux (
  id bigint generated always as identity primary key,
  siren char(9) not null references hub.entreprises(siren) on delete cascade,
  type text not null,
  valeur text,
  valeur_num numeric,
  preuve_url text not null,
  extrait text,
  -- Empreinte (siren, type, valeur, preuve) : une ré-extraction n'ajoute rien.
  empreinte text not null unique,
  source text not null,
  collecte_le timestamptz not null
);
create index on hub.signaux (siren);

-- ─── Scores : historisés par version de grille ─────────────────────────────
create table hub.scores (
  siren char(9) not null references hub.entreprises(siren) on delete cascade,
  ligne_code text not null references hub.lignes(code),
  version_grille int not null,
  score_fit int check (score_fit between 0 and 100),
  score_signal int check (score_signal between 0 and 100),
  score_total int check (score_total between 0 and 100),
  classe_activite text,
  raisons jsonb not null default '[]',
  constats jsonb not null default '[]',
  moteur text not null,
  calcule_le timestamptz not null default now(),
  primary key (siren, ligne_code, version_grille)
);

-- ─── Séquences : une seule active par contact, tous canaux confondus ───────
create table hub.sequences (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references hub.contacts(id) on delete cascade,
  ligne_code text not null references hub.lignes(code),
  canal text not null check (canal in ('email', 'linkedin', 'telephone', 'courrier')),
  outil text not null,
  id_externe text,
  etape int not null default 0,
  statut text not null default 'planifiee' check (statut in ('planifiee', 'en_cours', 'stoppee', 'terminee')),
  debut_le timestamptz,
  fin_le timestamptz,
  stop_motif text,
  cree_le timestamptz not null default now()
);
create unique index sequences_une_active on hub.sequences (contact_id) where statut in ('planifiee', 'en_cours');

-- ─── Échanges : alimentés par les événements, jamais saisis à la main ──────
create table hub.echanges (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references hub.contacts(id) on delete cascade,
  sequence_id uuid references hub.sequences(id),
  ligne_code text not null references hub.lignes(code),
  canal text not null,
  sens text not null check (sens in ('sortant', 'entrant')),
  objet text,
  corps text,
  envoye_le timestamptz,
  ouvert_le timestamptz,
  clique_le timestamptz,
  repondu_le timestamptz,
  classe_reponse text check (classe_reponse in
    ('interesse', 'pas_maintenant', 'mauvaise_personne', 'objection', 'absent', 'stop', 'a_lire')),
  confiance numeric,
  resume text,
  brouillon_reponse text,
  traite_par uuid references hub.utilisateurs(id),
  traite_le timestamptz,
  id_externe text unique,
  cree_le timestamptz not null default now()
);
create index on hub.echanges (ligne_code, sens, traite_le);

-- ─── Suppression : vérifiée avant tout envoi, jamais purgée ────────────────
create table hub.suppression (
  id bigint generated always as identity primary key,
  type text not null check (type in ('email', 'domaine', 'siren')),
  valeur citext not null,
  motif text not null check (motif in ('opt_out', 'bounce', 'plainte', 'client', 'concurrent', 'rgpd', 'croisee')),
  -- '*' = tout le groupe ; sinon une seule ligne.
  ligne_code text not null default '*',
  expire_le timestamptz, -- seulement pour la suppression croisée de 90 jours
  ajoute_le timestamptz not null default now(),
  unique (type, valeur, ligne_code)
);

-- ─── Exploitation : chaque exécution de flux laisse une trace ──────────────
create table hub.runs (
  id uuid primary key default gen_random_uuid(),
  flux text not null,
  ligne_code text references hub.lignes(code),
  debut_le timestamptz not null default now(),
  fin_le timestamptz,
  statut text not null default 'en_cours' check (statut in ('en_cours', 'ok', 'erreur', 'interrompu')),
  lus int not null default 0,
  ecrits int not null default 0,
  erreurs int not null default 0,
  detail jsonb not null default '{}'
);
create index on hub.runs (flux, debut_le desc);

-- Journal de ce qui arrive à un compte : la chronologie de la fiche compte.
create table hub.evenements (
  id bigint generated always as identity primary key,
  siren char(9) references hub.entreprises(siren) on delete cascade,
  contact_id uuid references hub.contacts(id) on delete cascade,
  ligne_code text references hub.lignes(code),
  type text not null,
  donnees jsonb not null default '{}',
  acteur text not null, -- 'F1'…'F8' ou l'id d'un utilisateur
  cree_le timestamptz not null default now()
);
create index on hub.evenements (siren, cree_le desc);

-- ─── Fonctions ──────────────────────────────────────────────────────────────

-- Un contact est-il bloqué pour cette ligne ? Lit toute la suppression, quelle
-- que soit la ligne de l'appelant (security definer) : c'est la suppression de groupe.
create function hub.est_supprime(p_email citext, p_siren char(9), p_ligne text)
returns boolean language sql stable security definer set search_path = hub as $$
  select exists (
    select 1 from hub.suppression s
    where (s.ligne_code = '*' or s.ligne_code = p_ligne)
      and (s.expire_le is null or s.expire_le > now())
      and ((s.type = 'email' and s.valeur = p_email)
        or (s.type = 'domaine' and s.valeur = split_part(p_email::text, '@', 2))
        or (s.type = 'siren' and s.valeur = p_siren))
  )
$$;
