#!/bin/bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Build upstream lib2geom + livarot + path operations + libavoid to WebAssembly.
# Upstream: src/3rdparty/2geom, src/3rdparty/adaptagrams/libavoid/, src/livarot/, src/path/path-boolop.cpp, src/helper/geom-nodesatellite.cpp, src/live_effects/spiro.cpp, src/live_effects/spiro-converters.cpp, src/svg/stringstream.cpp, src/svg/strip-trailing-zeros.cpp, src/helper/geom-pathstroke.cpp, src/helper/geom.cpp, src/util/treeify.cpp
# Upstream sources are compiled unchanged; shim/ replaces the few glib calls and the preferences.
#
# Needs: emcc (version in ./emscripten-version), Boost headers, curl.
# Env:   INKSCAPE_SRC  upstream checkout (default: ../inkscape next to the repo)
#        BOOST_INCLUDE folder that contains boost/ (default: Homebrew or /usr/include)
set -euo pipefail
cd "$(dirname "$0")"
HERE=$PWD
INK=$(cd "${INKSCAPE_SRC:-$HERE/../../../inkscape}" && pwd)
G=$INK/src/3rdparty/2geom
B=$HERE/build
P=$B/prefix
JOBS=$(getconf _NPROCESSORS_ONLN)

[ -f "$G/CMakeLists.txt" ] || { echo "lib2geom not found in $G (git submodule update --init src/3rdparty/2geom)"; exit 1; }
WANT=$(cat emscripten-version)
HAVE=$(emcc --version | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
[ "$WANT" = "$HAVE" ] || echo "warning: emcc $HAVE, expected $WANT"

# --- Boost headers (only header-only parts are used) ---
if [ -z "${BOOST_INCLUDE:-}" ]; then
    if command -v brew >/dev/null && [ -d "$(brew --prefix boost 2>/dev/null)/include/boost" ]; then
        BOOST_INCLUDE=$(brew --prefix boost)/include
    else
        BOOST_INCLUDE=/usr/include
    fi
fi
[ -d "$BOOST_INCLUDE/boost" ] || { echo "Boost headers not found in $BOOST_INCLUDE"; exit 1; }
# Link only boost/ into a private folder: adding a system include dir would mix in host headers.
mkdir -p "$B/boost-include" && ln -sfn "$BOOST_INCLUDE/boost" "$B/boost-include/boost"

# --- Third-party C libraries, pinned and checksummed ---
# Configure scripts run their test programs with Node: keep them out of our ESM package scope.
echo '{ "type": "commonjs" }' > "$B/package.json"
fetch() { # url sha256 dir
    [ -d "$B/vendor/$3" ] && return
    mkdir -p "$B/vendor" && curl -sSL "$1" -o "$B/vendor/$3.tar.gz"
    echo "$2  $B/vendor/$3.tar.gz" | shasum -a 256 -c - >/dev/null
    mkdir "$B/vendor/$3" && tar xzf "$B/vendor/$3.tar.gz" -C "$B/vendor/$3" --strip-components 1
}
fetch https://ftp.gnu.org/gnu/gsl/gsl-2.8.tar.gz \
    6a99eeed15632c6354895b1dd542ed5a855c0f15d9ad1326c6fe2b2c9e423190 gsl
fetch https://github.com/google/double-conversion/archive/refs/tags/v3.4.0.tar.gz \
    42fd4d980ea86426e457b24bdfa835a6f5ad9517ddb01cdb42b99ab9c8dd5dc9 double-conversion

if [ ! -f "$P/lib/libdouble-conversion.a" ]; then
    mkdir -p "$B/double-conversion" && (cd "$B/double-conversion" &&
        emcmake cmake "$B/vendor/double-conversion" -DCMAKE_INSTALL_PREFIX="$P" -DCMAKE_BUILD_TYPE=Release >/dev/null &&
        emmake make -j"$JOBS" install >/dev/null)
fi
if [ ! -f "$P/lib/libgsl.a" ]; then
    mkdir -p "$B/gsl" && (cd "$B/gsl" &&
        emconfigure "$B/vendor/gsl/configure" --prefix="$P" --disable-shared CFLAGS=-O2 >/dev/null 2>&1 &&
        emmake make -j"$JOBS" >/dev/null 2>&1 && emmake make install >/dev/null 2>&1)
fi

# --- Upstream sources ---
# lib2geom: same file list as its CMakeLists.txt (+ the pre-generated SVG path parser).
GEOM=$(sed -n '/target_sources(2geom PRIVATE/,/^)/p' "$G/src/2geom/CMakeLists.txt" | grep -oE '[a-z0-9_/-]+\.cpp')
SRCS=""
for f in $GEOM svg-path-parser.cpp; do SRCS="$SRCS $G/src/2geom/$f"; done
SRCS="$SRCS $(ls "$INK"/src/livarot/*.cpp)"
# libavoid (connector routing): same file list as its CMakeLists.txt.
A=$INK/src/3rdparty/adaptagrams
for f in $(sed -n '/target_sources(avoid_LIB PRIVATE/,/^)/p' "$A/libavoid/CMakeLists.txt" | grep -oE '[a-z0-9_]+\.cpp'); do
    SRCS="$SRCS $A/libavoid/$f"
done
SRCS="$SRCS $INK/src/path/path-boolop.cpp $INK/src/svg/stringstream.cpp $INK/src/svg/strip-trailing-zeros.cpp"
# split_non_intersecting_paths() for Path > Break Apart.
SRCS="$SRCS $INK/src/helper/geom-pathstroke.cpp $INK/src/helper/geom.cpp $INK/src/util/treeify.cpp"
# Replaces src/util/numeric/precision.cpp (it reads the preferences).
SRCS="$SRCS $HERE/shim/precision.cpp"
# Arc length helpers of the Corners (Fillet/Chamfer) LPE.
SRCS="$SRCS $INK/src/helper/geom-nodesatellite.cpp"
# Spiro splines (Spiro LPE and the Spiro mode of the drawing tools).
SRCS="$SRCS $INK/src/live_effects/spiro.cpp $INK/src/live_effects/spiro-converters.cpp"

# WASM has no FP rounding-mode control, so Boost.Interval gets its default (no-op)
# rounding: we skip its hw_rounding.hpp (only used by 2geom/geometric-intersection.cpp).
export FLAGS="-O3 -std=c++20 -fexceptions -DHAVE_GSL -DBOOST_NUMERIC_INTERVAL_HW_ROUNDING_HPP \
    -include $HERE/shim/glib.h -I$HERE/shim -I$INK/src -I$G/include -I$A -I$P/include -I$B/boost-include \
    -Wno-deprecated-declarations"
OBJ=$B/obj && mkdir -p "$OBJ"
obj() { echo "$OBJ/$(echo "${1#"$INK"/}" | tr / _).o"; }
for s in $SRCS; do
    o=$(obj "$s")
    [ "$o" -nt "$s" ] || echo "$s $o"
done | xargs -P "$JOBS" -n 2 sh -c 'em++ $FLAGS -c "$0" -o "$1"'

OBJS=""
for s in $SRCS; do OBJS="$OBJS $(obj "$s")"; done
mkdir -p dist
# shellcheck disable=SC2086
em++ $FLAGS -lembind bindings/geom.cpp bindings/lpe.cpp bindings/avoid.cpp $OBJS "$P/lib/libgsl.a" "$P/lib/libgslcblas.a" "$P/lib/libdouble-conversion.a" \
    -sMODULARIZE -sEXPORT_ES6 -sALLOW_MEMORY_GROWTH -sENVIRONMENT=web,worker,node \
    --emit-tsd geom-module.d.mts -o dist/geom-module.mjs
git -C "$INK" rev-parse HEAD > dist/upstream-commit
scripts/inputs-hash.sh > dist/inputs-hash
# License files of everything linked into the module (see THIRD-PARTY.md).
mkdir -p dist/licenses
cp "$INK/COPYING" dist/licenses/inkscape-COPYING
cp "$INK"/LICENSES/GPL-2.0.txt "$INK"/LICENSES/GPL-3.0.txt dist/licenses/
cp "$G/COPYING-LGPL-2.1" "$G/COPYING-MPL-1.1" dist/licenses/
cp "$A/libavoid/LICENSE.LGPL" dist/licenses/libavoid-LICENSE.LGPL
cp "$B/vendor/gsl/COPYING" dist/licenses/gsl-COPYING
cp "$B/vendor/double-conversion/LICENSE" dist/licenses/double-conversion-LICENSE
echo "wasm: $(du -h dist/geom-module.wasm | cut -f1) ($(gzip -9c dist/geom-module.wasm | wc -c | tr -d ' ') bytes gzip)"
