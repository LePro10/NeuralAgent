#!/bin/sh
# Pull deployment (systemd timer): fetch a newer relay image, restart, keep it only if healthy,
# otherwise roll back to the previous image.
set -eu
cd /opt/neuralagent
IMG=ghcr.io/lepro10/neuralagent-relay
if [ ! -f /etc/neuralagent/ghcr.env ]; then echo "no GHCR token yet, nothing to pull"; exit 0; fi
. /etc/neuralagent/ghcr.env
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null 2>&1
old=$(docker image inspect -f '{{.Id}}' "$IMG:latest" 2>/dev/null || true)
docker pull -q "$IMG:latest" >/dev/null
new=$(docker image inspect -f '{{.Id}}' "$IMG:latest")
[ "$old" = "$new" ] && exit 0
[ -n "$old" ] && docker tag "$old" "$IMG:previous"
docker compose up -d --quiet-pull
i=0
while [ $i -lt 40 ]; do
  s=$(docker inspect -f '{{.State.Health.Status}}' neuralagent-relay 2>/dev/null || echo none)
  if [ "$s" = healthy ]; then echo "deployed $new"; docker image prune -f >/dev/null; exit 0; fi
  i=$((i + 1)); sleep 3
done
echo "new image is not healthy, rolling back"
if [ -n "$old" ]; then docker tag "$IMG:previous" "$IMG:latest"; docker compose up -d; fi
exit 1
