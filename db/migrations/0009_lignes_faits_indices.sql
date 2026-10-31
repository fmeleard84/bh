-- BH — réglages de lecture propres à chaque ligne.
--
-- 1. faits : types de faits que l'Extracteur relève EN PLUS des types communs, pour cette ligne
--    ({type: définition}). Les types communs ont été écrits pour les agents en vins et le transit ;
--    une ligne comme Isoligne a besoin d'autres faits (références, prix, disponibilité…).
-- 2. scan_technique : contrôles faits par le code, sans IA, sur le HTML lu (données structurées
--    produit, prix lisibles sans JavaScript, FAQ). Ce que le modèle ne peut pas voir dans le texte.
-- 3. indices_metier : mots du métier de la ligne (« mot* » accepte toute fin de mot). Un nom ou une
--    enseigne qui en porte un vaut 10 points d'adéquation ; un compte sans site n'est qualifié par la
--    voie LinkedIn que si l'un d'eux apparaît (nom, enseigne, profil) : « agent commercial » seul ne
--    dit pas de quoi. Vide : ni points ni exigence. (Ces deux règles étaient écrites pour le vin.)

alter table hub.lignes add column faits jsonb not null default '{}';
alter table hub.lignes add column scan_technique boolean not null default false;
alter table hub.lignes add column indices_metier text[] not null default '{}';

update hub.lignes set indices_metier = '{vin,vins,vigne,vignoble,vigneron,vignerons,cave,caves,wine,wines,cru,chateau,domaine,domaines,oeno*,bouteille,spirits,spiritueux,champagne,terroir,boisson,boissons}'
 where code = 'ttgg_agents';

update hub.lignes set indices_metier = '{transit,transitaire,transitaires,douane,douanes,douanier,dedouanement,customs,commissionnaire,commissionnaires,freight,forwarder,forwarding,fret,logistique,logistics,transport,transports,import,export,maritime,aerien,shipping}'
 where code = 'velosiq_transit';

update hub.lignes set scan_technique = true, faits = '{
  "nb_references": "nombre de produits ou de références au catalogue, si un nombre est écrit (valeur_num = le nombre)",
  "prix_affiches": "comment les prix sont présentés : publics sur les fiches produit, sur devis, réservés aux clients connectés",
  "disponibilite": "indication de stock ou de délai de disponibilité des produits (« en stock », « expédié sous 48 h »…)",
  "faq": "existence d''une FAQ ou d''une page de questions fréquentes, et son sujet",
  "avis_clients": "avis ou notes clients affichés sur le site (nombre ou note si écrits)",
  "livraison_retours": "conditions de livraison et de retour annoncées (délais, frais, zones)"
}' where code = 'isoligne_pme';
