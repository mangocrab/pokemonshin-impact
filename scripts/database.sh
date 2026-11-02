#!/usr/bin/env bash
set -euo pipefail
if docker container inspect pokemonshin-db >/dev/null 2>&1; then
  docker start pokemonshin-db >/dev/null
else
  mkdir -p /workspace/.pokemonshin/postgres
  docker run -d --name pokemonshin-db -e POSTGRES_USER=resort -e POSTGRES_PASSWORD=local-development-only -e POSTGRES_DB=resort -p 127.0.0.1:5432:5432 --mount type=bind,source=/workspace/.pokemonshin/postgres,target=/var/lib/postgresql/data postgres:17-alpine >/dev/null
fi
for attempt in {1..30}; do
  if docker exec pokemonshin-db pg_isready -U resort -d resort >/dev/null; then exit 0; fi
  sleep 1
done
echo 'PostgreSQL did not become ready' >&2
exit 1
