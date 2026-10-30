-- Enseignes, nom commercial et sigle du registre : ce sont souvent eux, plus que
-- la raison sociale, qui donnent le nom de domaine du site (F2).
alter table hub.entreprises add column enseignes text[] not null default '{}';
