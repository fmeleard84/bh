-- BH — lot 3 : séquences, envoi, réponses, tâches humaines.
--
-- Trois verrous avant tout envoi : variable BH_ENVOI_ACTIF=1, ligne active,
-- boîte active. Les mots de passe des boîtes ne sont jamais en base : la boîte
-- nomme la variable d'environnement qui le porte (secret_ref).

-- ─── Boîtes d'envoi (domaines secondaires, jamais le domaine principal) ────
create table hub.boites (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  nom_affiche text not null,
  ligne_code text not null references hub.lignes(code),
  smtp_host text not null default 'smtp.gmail.com',
  smtp_port int not null default 465,
  imap_host text not null default 'imap.gmail.com',
  imap_port int not null default 993,
  secret_ref text not null, -- nom de la variable d'environnement du mot de passe d'application
  quota_jour int not null default 25 check (quota_jour between 1 and 50),
  signature text not null default '',
  adresse_postale text not null default '',
  active boolean not null default false,
  pause_motif text,
  imap_dernier_uid bigint not null default 0,
  cree_le timestamptz not null default now()
);

-- ─── Messages : un brouillon devient un envoi, une réponse est un entrant ──
alter table hub.echanges
  add column statut_envoi text check (statut_envoi in ('a_valider', 'valide', 'planifie', 'envoye', 'annule', 'echec')),
  add column etape int,
  add column planifie_le timestamptz,
  add column boite_id uuid references hub.boites(id),
  add column message_id text unique,
  add column in_reply_to text,
  add column controle jsonb not null default '{}',
  add column modele text,
  add column valide_par uuid references hub.utilisateurs(id),
  add column valide_le timestamptz,
  add column erreur text;
create index on hub.echanges (statut_envoi, planifie_le) where sens = 'sortant';

-- Un compte en séquence : sur quel gabarit (email nominatif, générique, LinkedIn, appel).
alter table hub.sequences add column gabarit text;

-- ─── Tâches humaines : LinkedIn, appels, courriers (le canal est choisi par F6) ──
create table hub.taches (
  id uuid primary key default gen_random_uuid(),
  ligne_code text not null references hub.lignes(code),
  siren char(9) not null references hub.entreprises(siren) on delete cascade,
  contact_id uuid references hub.contacts(id) on delete cascade,
  sequence_id uuid references hub.sequences(id) on delete cascade,
  type text not null check (type in ('linkedin_invitation', 'linkedin_message', 'appel', 'courrier', 'repondre')),
  echeance timestamptz not null default now(),
  contenu text not null default '',
  fait_le timestamptz,
  fait_par uuid references hub.utilisateurs(id),
  resultat text,
  cree_le timestamptz not null default now()
);
create index on hub.taches (ligne_code, fait_le, echeance);

alter table hub.taches enable row level security;
create policy p on hub.taches using (ligne_code in (select hub.lignes_visibles()));
alter table hub.boites enable row level security;
create policy p on hub.boites for select using (ligne_code in (select hub.lignes_visibles()));

-- Les boîtes ne se créent et ne s'activent que par les scripts d'exploitation.
revoke insert, update on hub.boites from bh_app;

-- Brouillons à valider par le propriétaire de la ligne.
create view hub.v_brouillons with (security_invoker = true) as
select s.id as sequence_id, s.ligne_code, s.canal, s.gabarit, c.siren, e.nom as entreprise, ct.id as contact_id,
       ct.prenom, ct.nom, ct.email, sc.score_total,
       json_agg(json_build_object('id', x.id, 'etape', x.etape, 'objet', x.objet, 'corps', x.corps, 'controle', x.controle)
                order by x.etape) as messages
from hub.sequences s
join hub.contacts ct on ct.id = s.contact_id
join hub.ciblages c on c.siren = ct.siren and c.ligne_code = s.ligne_code
join hub.entreprises e on e.siren = ct.siren
join hub.echanges x on x.sequence_id = s.id and x.statut_envoi = 'a_valider'
left join hub.lignes l on l.code = s.ligne_code
left join hub.scores sc on sc.siren = c.siren and sc.ligne_code = c.ligne_code and sc.version_grille = l.grille_version
where s.statut = 'planifiee'
group by s.id, c.siren, e.nom, ct.id, sc.score_total
order by sc.score_total desc nulls last;
