#!/bin/sh
# SPDX-License-Identifier: GPL-2.0-or-later
# Print a hash of everything that the WASM build depends on in this repo:
# the build script, bindings, shims, Emscripten version and the upstream
# commit. build.sh writes it to dist/inputs-hash; CI compares it with the
# committed dist/ (see check-dist.sh).
set -eu
cd "$(dirname "$0")/.."
{
    cat build.sh emscripten-version ../../upstream/sync.json
    find bindings shim -type f | LC_ALL=C sort | xargs cat
} | shasum -a 256 | cut -d' ' -f1
