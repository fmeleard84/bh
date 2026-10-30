-- BH — cloisonnement par ligne (RLS).
--
-- L'application se connecte avec le rôle bh_app et pose l'utilisateur courant
-- dans app.user_id au début de chaque transaction. Le worker se connecte en
-- propriétaire (pas de RLS) : c'est l'équivalent de la clé service.
--
-- Un responsable de ligne ne voit que les sociétés ciblées par ses lignes.
-- La suppression est lisible par tous (un envoi doit pouvoir la vérifier),
-- et chacun peut y ajouter : un « stop » ne doit jamais être bloqué par un droit.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'bh_app') then
    create role bh_app login;
  end if;
end $$;

grant usage on schema hub to bh_app;
grant select, insert, update on all tables in schema hub to bh_app;
grant usage on all sequences in schema hub to bh_app;
grant execute on all functions in schema hub to bh_app;
revoke update on hub.utilisateurs from bh_app;
revoke insert, update on hub.runs from bh_app;

create function hub.utilisateur_courant() returns uuid language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create function hub.lignes_visibles() returns setof text
language sql stable security definer set search_path = hub as $$
  select l.code from hub.lignes l
  where exists (select 1 from hub.utilisateurs u where u.id = hub.utilisateur_courant() and u.super_admin and u.actif)
     or exists (select 1 from hub.acces_lignes a where a.ligne_code = l.code and a.utilisateur_id = hub.utilisateur_courant())
$$;

create function hub.siren_visible(p_siren char(9)) returns boolean
language sql stable security definer set search_path = hub as $$
  select exists (select 1 from hub.ciblages c where c.siren = p_siren and c.ligne_code in (select hub.lignes_visibles()))
$$;

alter table hub.lignes enable row level security;
create policy lignes_lecture on hub.lignes for select using (code in (select hub.lignes_visibles()));
create policy lignes_ecriture on hub.lignes for update using (
  code in (select a.ligne_code from hub.acces_lignes a where a.utilisateur_id = hub.utilisateur_courant() and a.role = 'responsable')
  or exists (select 1 from hub.utilisateurs u where u.id = hub.utilisateur_courant() and u.super_admin)
);

alter table hub.acces_lignes enable row level security;
create policy acces_lecture on hub.acces_lignes for select using (ligne_code in (select hub.lignes_visibles()));

alter table hub.utilisateurs enable row level security;
create policy utilisateurs_lecture on hub.utilisateurs for select using (true);

-- Tables rattachées à une ligne.
alter table hub.ciblages enable row level security;
create policy p on hub.ciblages using (ligne_code in (select hub.lignes_visibles()));
alter table hub.scores enable row level security;
create policy p on hub.scores using (ligne_code in (select hub.lignes_visibles()));
alter table hub.sequences enable row level security;
create policy p on hub.sequences using (ligne_code in (select hub.lignes_visibles()));
alter table hub.echanges enable row level security;
create policy p on hub.echanges using (ligne_code in (select hub.lignes_visibles()));
alter table hub.runs enable row level security;
create policy p on hub.runs for select using (ligne_code is null or ligne_code in (select hub.lignes_visibles()));

-- Tables rattachées à une société : visibles si la société est ciblée par une ligne visible.
alter table hub.entreprises enable row level security;
create policy p on hub.entreprises using (hub.siren_visible(siren));
alter table hub.contacts enable row level security;
create policy p on hub.contacts using (hub.siren_visible(siren));
alter table hub.signaux enable row level security;
create policy p on hub.signaux using (hub.siren_visible(siren));
alter table hub.evenements enable row level security;
create policy p on hub.evenements using (siren is null or hub.siren_visible(siren));

alter table hub.suppression enable row level security;
create policy lecture on hub.suppression for select using (true);
create policy ajout on hub.suppression for insert with check (true);
