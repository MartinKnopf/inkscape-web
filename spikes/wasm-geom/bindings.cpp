// JS API for the spike: boolean ops on SVG path data, via upstream path-boolop.cpp.
#include <emscripten/bind.h>
#include <2geom/svg-path-parser.h>
#include <2geom/svg-path-writer.h>
#include "path/path-boolop.h"

std::string boolop(std::string const &a, std::string const &b, int op, int fra, int frb) {
    auto pa = Geom::parse_svg_path(a.c_str());
    auto pb = Geom::parse_svg_path(b.c_str());
    auto r = sp_pathvector_boolop(pa, pb, (BooleanOp)op, (FillRule)fra, (FillRule)frb);
    return Geom::write_svg_path(r);
}

// Tiny call, to measure JS <-> WASM call overhead.
double nearest(double px, double py, std::string const &d) {
    auto pv = Geom::parse_svg_path(d.c_str());
    auto t = pv.nearestTime(Geom::Point(px, py));
    return t ? t->asFlatTime() : -1;
}

// Parse and write again with fixed precision and no shorthands (for comparisons).
std::string normalize(std::string const &d) {
    return Geom::write_svg_path(Geom::parse_svg_path(d.c_str()), 5, false, false);
}

EMSCRIPTEN_BINDINGS(spike) {
    emscripten::function("normalize", &normalize);
    emscripten::function("boolop", &boolop);
    emscripten::function("nearest", &nearest);
}
