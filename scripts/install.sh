#!/usr/bin/env bash
set -euo pipefail
cd /workspace/pokemonshin-impact
export npm_config_cache=/tmp/pokemon-npm
export DATABASE_URL="${DATABASE_URL:-postgresql://resort:local-development-only@127.0.0.1:5432/resort}"
npm ci
npm run db:generate
bash scripts/database.sh
npm run db:migrate
npm run build
npm test
