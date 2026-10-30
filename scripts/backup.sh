#!/bin/sh
# Sauvegarde logique quotidienne de la base BH (cron 02:50), 14 jours conservés.
set -eu
DEST=/opt/backups/bh
mkdir -p "$DEST"
F="$DEST/bh-$(date +%F).dump"
docker compose -f /opt/bh/docker-compose.yml exec -T db pg_dump -U bh -d bh -Fc > "$F.tmp"
mv "$F.tmp" "$F"
find "$DEST" -name 'bh-*.dump' -mtime +14 -delete
