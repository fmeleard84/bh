-- BH — boîtes d'envoi sur alias.
--
-- Une boîte peut être un alias d'un compte Google (francis@tontongg-pro.com sur francis@vaya.rip) :
-- on se connecte (SMTP, IMAP) avec l'identifiant du compte, on écrit avec l'adresse de la boîte.
-- Plusieurs boîtes partagent alors une même boîte de réception : F7 la relève une seule fois.

alter table hub.boites add column identifiant citext; -- compte de connexion ; null : l'adresse de la boîte
