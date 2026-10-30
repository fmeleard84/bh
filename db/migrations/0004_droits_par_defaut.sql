-- Les vues de 0003 sont arrivées après les droits de 0002 : bh_app ne pouvait pas les lire.
-- Droits par défaut pour que toute table, vue ou fonction future du schéma en hérite.
grant select on all tables in schema hub to bh_app;
alter default privileges in schema hub grant select, insert, update on tables to bh_app;
alter default privileges in schema hub grant usage on sequences to bh_app;
alter default privileges in schema hub grant execute on functions to bh_app;
