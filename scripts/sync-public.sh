#!/usr/bin/env bash
# Push a clean snapshot of the current tree to the public GitHub repository.
#   scripts/sync-public.sh git@github.com:OWNER/gource-view.git "Sync: what changed"
set -euo pipefail
REMOTE="${1:?public repo url}"; MSG="${2:-Sync from internal main}"
SRC="$(git rev-parse --show-toplevel)"; TMP="$(mktemp -d)"
git clone --quiet "$REMOTE" "$TMP/pub" 2>/dev/null || git init --quiet -b main "$TMP/pub"
rsync -a --delete --exclude .git --exclude node_modules --exclude dist --exclude checks/out --exclude n0-app.json --exclude .gitea "$SRC/" "$TMP/pub/"
cd "$TMP/pub"
if git grep -n -i -E "moon\.nzero|lunarrails|clovr_pat_|clovrlabs" -- . ':!server/music/*' | grep -v "^scripts/sync-public.sh" ; then echo "refusing to publish: platform references above" >&2; exit 1; fi
git add -A
git -c user.name="${GIT_AUTHOR_NAME:-Gource View}" -c user.email="${GIT_AUTHOR_EMAIL:-noreply@example.com}" commit -q -m "$MSG" || { echo "nothing to sync"; exit 0; }
git remote get-url origin >/dev/null 2>&1 || git remote add origin "$REMOTE"
git push -u origin main
echo "published $(git rev-parse --short HEAD) to $REMOTE"
