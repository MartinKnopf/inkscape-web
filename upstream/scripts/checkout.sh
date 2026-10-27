#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Shallow checkout of upstream Inkscape at the commit in upstream/sync.json,
# with the submodules that the builds need. Used by CI and the Vercel build.
# For local work, use a full clone instead (upstream:diff needs the history).
#
# Usage: upstream/scripts/checkout.sh   (target: $INKSCAPE_SRC or ../inkscape)
# Does nothing if the target exists.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
target="${INKSCAPE_SRC:-$root/../inkscape}"
commit="$(node -p "require('$root/upstream/sync.json').commit")"
repository="$(node -p "require('$root/upstream/sync.json').repository")"

if [[ -e "$target" ]]; then
  echo "upstream: $target exists, not changed"
  exit 0
fi

git init -q "$target"
git -C "$target" fetch -q --depth 1 "$repository" "$commit"
git -C "$target" -c advice.detachedHead=false checkout -q FETCH_HEAD
git -C "$target" submodule update -q --init --depth 1 src/3rdparty/2geom po
echo "upstream: $commit → $target"
