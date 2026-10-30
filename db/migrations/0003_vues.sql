-- BH — vues de travail. security_invoker : la RLS de l'utilisateur s'applique.

-- Comptes prêts à entrer en séquence, du meilleur au moins bon.
create view hub.v_a_contacter with (security_invoker = true) as
select c.ligne_code, c.siren, e.nom as entreprise, e.commune, c.score_total,
       ct.id as contact_id, ct.prenom, ct.nom, ct.email, ct.email_statut, ct.linkedin_url,
       coalesce(ct.telephone_mobile, ct.telephone_fixe, e.telephone) as telephone
from hub.ciblages c
join hub.lignes l on l.code = c.ligne_code
join hub.entreprises e on e.siren = c.siren
join hub.contacts ct on ct.siren = c.siren and ct.role_cible and not ct.opt_out
where c.statut = 'qualifie'
  and c.score_total >= l.seuil_score
  and not hub.est_supprime(ct.email, c.siren, c.ligne_code)
  and not exists (select 1 from hub.sequences s where s.contact_id = ct.id and s.statut in ('planifiee', 'en_cours'))
order by c.score_total desc;

-- Réponses entrantes qui attendent un humain.
create view hub.v_a_traiter with (security_invoker = true) as
select x.id, x.ligne_code, x.canal, x.classe_reponse, x.confiance, x.resume, x.brouillon_reponse,
       x.repondu_le, ct.prenom, ct.nom, e.nom as entreprise, e.siren, l.proprietaire_id
from hub.echanges x
join hub.contacts ct on ct.id = x.contact_id
join hub.entreprises e on e.siren = ct.siren
join hub.lignes l on l.code = x.ligne_code
where x.sens = 'entrant' and x.traite_le is null
  and x.classe_reponse in ('interesse', 'objection', 'mauvaise_personne', 'a_lire')
order by case x.classe_reponse when 'interesse' then 0 when 'a_lire' then 1 else 2 end, x.repondu_le;

-- Entonnoir : nombre de comptes à chaque statut, par ligne.
create view hub.v_entonnoir with (security_invoker = true) as
select ligne_code, statut, count(*)::int as comptes
from hub.ciblages group by ligne_code, statut;
