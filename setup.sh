#!/usr/bin/env bash
# ALONE bot helper:  bash setup.sh local   |   bash setup.sh heroku <app-name>
set -euo pipefail
echo "🤖⚡ ALONE // setup"
need() { command -v "$1" >/dev/null 2>&1 || { echo "❌ '$1' is required"; exit 1; }; }
need node; need npm; need git
MODE="${1:-local}"

if [ ! -f .env ]; then cp .env.example .env; echo "📝 Created .env — edit it (MONGODB_URI is required)."; fi

case "$MODE" in
  local)
    npm install
    echo "✅ Done. Edit .env then run: npm start  (the pairing code is printed in the console)"
    ;;
  heroku)
    need heroku
    APP="${2:?usage: bash setup.sh heroku <app-name>}"
    [ -d .git ] || { git init -q && git add -A && git commit -qm "ALONE bot" ; }
    heroku create "$APP" --stack heroku-24 || true
    heroku buildpacks:set heroku/nodejs -a "$APP"
    # push every KEY=VALUE from .env (skips comments/empty values)
    grep -v '^#' .env | grep -E '^[A-Z_]+=.+' | while IFS= read -r line; do
      heroku config:set "$line" -a "$APP" >/dev/null && echo "🔧 ${line%%=*}"
    done
    git push heroku HEAD:main --force || git push heroku HEAD:master --force
    heroku ps:scale worker=1 -a "$APP"
    echo "🚀 Deployed. Get the pairing code with:  heroku logs --tail -a $APP"
    ;;
  *) echo "usage: bash setup.sh local | heroku <app-name>"; exit 1 ;;
esac
