-- BH — lot 4.
--
-- 1. Les classes d'activité et leurs définitions vivent dans la fiche de ligne, pas dans le code
--    (cahier §2 : « une ligne ne change aucune brique »). Le Qualificateur reçoit l'union des
--    classes de toutes les lignes, ce qui permet le re-routage d'une ligne à l'autre.
-- 2. L'enrichissement (F2 → F5, qui consomme des crédits de recherche) a son propre interrupteur,
--    distinct de l'envoi (lignes.active).
-- 3. Rapports hebdomadaires (F8).

alter table hub.lignes add column classes jsonb not null default '{}';
alter table hub.lignes add column enrichissement_actif boolean not null default false;

update hub.lignes set enrichissement_actif = true where code = 'ttgg_agents';

update hub.lignes set classes = '{
  "agent": "agent commercial ou agence commerciale qui VEND, à la commission, les vins de plusieurs producteurs/domaines/marques à des professionnels (cavistes, restaurants, CHR, épiceries fines) ; ne possède pas le stock, le producteur facture et expédie le plus souvent",
  "courtier": "courtier en vins, surtout vrac ou entre producteurs et négociants ; intermédiaire de transactions",
  "importateur": "achète à l''étranger et revend en France, ou exporte ; possède le stock",
  "distributeur": "grossiste ou distributeur qui achète, stocke et revend",
  "caviste": "boutique ou commerce de vins au détail, y compris en ligne",
  "producteur": "domaine, château, vigneron, cave coopérative, qui produit son vin"
}' where code = 'ttgg_agents';

update hub.lignes set classes = '{
  "transitaire": "organise le transport international de marchandises pour le compte de clients (commissionnaire de transport, freight forwarder)",
  "declarant": "réalise les formalités et déclarations en douane pour ses clients (représentant en douane enregistré, RDE)",
  "commissionnaire": "commissionnaire en douane agréé, cumulant transport et dédouanement",
  "transporteur_pur": "transporteur routier, maritime ou aérien qui ne fait que transporter, sans organisation ni douane"
}' where code = 'velosiq_transit';

update hub.lignes set classes = '{
  "e_commerce": "PME qui vend en ligne un catalogue de produits à des particuliers (boutique en ligne)",
  "b2b_catalogue": "PME qui présente en ligne un catalogue de produits ou de références pour des professionnels"
}' where code = 'isoligne_pme';

create table hub.rapports (
  id uuid primary key default gen_random_uuid(),
  semaine text not null,            -- semaine ISO, ex. 2026-W44
  ligne_code text not null references hub.lignes(code) on delete cascade,
  chiffres jsonb not null,
  resume text not null,
  alertes jsonb not null default '[]',
  cree_le timestamptz not null default now(),
  unique (semaine, ligne_code)
);
alter table hub.rapports enable row level security;
create policy p on hub.rapports for select using (ligne_code in (select hub.lignes_visibles()));
