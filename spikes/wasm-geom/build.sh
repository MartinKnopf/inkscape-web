#!/bin/bash
# Build upstream lib2geom + livarot + path-boolop to WASM. No upstream file is changed.
set -e
cd "$(dirname "$0")"
INK=${INKSCAPE_SRC:-$HOME/dev/inkscape}
G=$INK/src/3rdparty/2geom
P=$PWD/prefix
OUT=build/obj; mkdir -p $OUT dist
FLAGS="-O3 -std=c++20 -DHAVE_GSL -fexceptions -Ishim -I$INK/src -I$G/include -I$P/include -I/opt/homebrew/include -Wno-deprecated-declarations -DBOOST_NUMERIC_INTERVAL_HW_ROUNDING_HPP -include shim/glib.h"
GEOM=$(sed -n '/target_sources(2geom PRIVATE/,/^)/p' $G/src/2geom/CMakeLists.txt | grep -oE '[a-z0-9_/-]+\.cpp')
SRCS=""
for f in $GEOM svg-path-parser.cpp; do SRCS="$SRCS $G/src/2geom/$f"; done
SRCS="$SRCS $(ls $INK/src/livarot/*.cpp) $INK/src/path/path-boolop.cpp $INK/src/svg/stringstream.cpp $INK/src/svg/strip-trailing-zeros.cpp"
export FLAGS
for s in $SRCS; do
  o=$OUT/$(echo $s | sed "s|$INK/||; s|/|_|g").o
  [ $o -nt $s ] || echo "$s $o"
done | xargs -P 14 -n 2 sh -c 'em++ $FLAGS -c "$0" -o "$1"'
OBJS=$(for s in $SRCS; do echo $OUT/$(echo $s | sed "s|$INK/||; s|/|_|g").o; done)
em++ $FLAGS -lembind bindings.cpp $OBJS $P/lib/libgsl.a $P/lib/libgslcblas.a $P/lib/libdouble-conversion.a \
  -fexceptions -sMODULARIZE -sEXPORT_ES6 -sALLOW_MEMORY_GROWTH -sENVIRONMENT=web,node \
  --emit-tsd geom.d.ts -o dist/geom.mjs
ls -la dist
