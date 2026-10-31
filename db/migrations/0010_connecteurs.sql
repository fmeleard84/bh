-- BH — F9 Veille, lot 1 : connecteurs Apify et consommation (docs/veille.md §4).
--
-- Registre des robots, sur le modèle de Mamie Futée : on change de robot sans redéployer,
-- les suivants par priorité servent de secours, l'état du dernier test est gardé.
-- LinkedIn : seuls les robots sans cookie ni compte sont autorisés (contrôlé aussi par le code).

create table hub.connecteurs (
  id uuid primary key default gen_random_uuid(),
  plateforme text not null check (plateforme in ('linkedin', 'google_maps', 'web')),
  usage text not null,
  robot text not null,
  principal boolean not null default false,
  priorite int not null default 10,
  actif boolean not null default true,
  config jsonb not null default '{}',
  sans_cookie boolean not null,
  cout_unitaire_cents numeric,
  note text,
  dernier_test_le timestamptz,
  dernier_test_statut text check (dernier_test_statut in ('ok', 'erreur')),
  dernier_test_erreur text,
  dernier_test_detail jsonb,
  unique (plateforme, usage, robot),
  check (plateforme <> 'linkedin' or sans_cookie)
);

create table hub.consommation (
  jour date not null default current_date,
  service text not null,
  unites int not null default 0,
  cout_cents numeric not null default 0,
  primary key (jour, service)
);

-- Lecture pour l'application (Pilotage), écriture par le worker et les scripts seulement.
revoke insert, update on hub.connecteurs, hub.consommation from bh_app;
grant select on hub.connecteurs, hub.consommation to bh_app;

-- Robots candidats (docs/veille.md §4), à départager par scripts/connecteurs.ts tester.
-- « config » : modèle d'entrée ; {{url}} est remplacé par l'adresse visée.
insert into hub.connecteurs (plateforme, usage, robot, principal, priorite, sans_cookie, config, note) values
  ('linkedin', 'profile_posts', 'harvestapi~linkedin-profile-posts', true, 1, true,
   '{"targetUrls": ["{{url}}"], "maxPosts": 10}', 'candidat'),
  ('linkedin', 'profile_posts', 'apimaestro~linkedin-profile-posts', false, 2, true,
   '{"username": "{{url}}", "limit": 10}', 'candidat'),
  ('linkedin', 'company_posts', 'harvestapi~linkedin-company-posts', true, 1, true,
   '{"targetUrls": ["{{url}}"], "maxPosts": 10}', 'candidat'),
  ('google_maps', 'places', 'compass~crawler-google-places', true, 1, true,
   '{"searchStringsArray": ["{{url}}"], "maxCrawledPlacesPerSearch": 1, "language": "fr"}', 'candidat');
