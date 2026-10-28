#!/bin/sh
# SPDX-License-Identifier: GPL-2.0-or-later
# Fail when the committed dist/ was built from other inputs. dist/ is
# committed so that the web build (Vercel) does not need Emscripten.
# Fix: run `pnpm build:wasm` and commit packages/wasm/dist.
set -eu
cd "$(dirname "$0")/.."
expected=$(scripts/inputs-hash.sh)
actual=$(cat dist/inputs-hash 2>/dev/null || echo none)
if [ "$expected" != "$actual" ]; then
    echo "packages/wasm/dist is out of date: run 'pnpm build:wasm' and commit it." >&2
    exit 1
fi
