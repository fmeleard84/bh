-- BH — paramètres d'entrée des robots vérifiés sur leur schéma (2026-10-31) :
-- apimaestro attend l'identifiant du profil, pas l'URL ; harvestapi : 5 publications, sans republications.
update hub.connecteurs set config = '{"username": "{{slug}}", "limit": 5}'
 where robot = 'apimaestro~linkedin-profile-posts';
update hub.connecteurs set config = '{"targetUrls": ["{{url}}"], "maxPosts": 5, "includeReposts": false}'
 where robot in ('harvestapi~linkedin-profile-posts', 'harvestapi~linkedin-company-posts');
update hub.connecteurs set config = '{"searchStringsArray": ["{{url}}"], "maxCrawledPlacesPerSearch": 1, "language": "fr", "locationQuery": "France"}'
 where robot = 'compass~crawler-google-places';
