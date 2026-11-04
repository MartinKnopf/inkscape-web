// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/libnrtype/Layout-TNG-Scanline-Makers.cpp, src/object/sp-text.cpp, src/object/sp-flowregion.cpp, src/object/sp-tspan.cpp, src/libnrtype/Layout-TNG-Output.cpp, src/libnrtype/Layout-TNG-OutIter.cpp
// Embind API for the livarot part of text layout: the wrap shapes of flowed text
// (shape-inside, shape-subtract, flowRegion), the upstream ShapeScanlineMaker that finds the
// space for each line in them, and the livarot Path of a textPath. src/index.ts wraps it.
#include <memory>
#include <vector>

#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <2geom/affine.h>
#include <2geom/pathvector.h>
#include <2geom/svg-path-parser.h>

#include "libnrtype/Layout-TNG-Scanline-Maker.h"
#include "livarot/Path.h"
#include "livarot/Shape.h"
#include "path/path-boolop.h"

using Inkscape::Text::Layout;

namespace {

Geom::Affine affine(emscripten::val const &m)
{
    auto v = emscripten::convertJSArrayToNumberVector<double>(m);
    return v.size() == 6 ? Geom::Affine(v[0], v[1], v[2], v[3], v[4], v[5]) : Geom::Affine();
}

// A livarot Shape (a wrap shape of flowed text).
class TextShape
{
public:
    std::shared_ptr<Shape> shape = std::make_shared<Shape>();

    bool hasEdges() const { return shape->hasEdges(); }

    // [left, top, right, bottom] (Shape::CalcBBox).
    emscripten::val bbox() const
    {
        shape->CalcBBox(true);
        auto out = emscripten::val::array();
        out.call<void>("push", shape->leftX);
        out.call<void>("push", shape->topY);
        out.call<void>("push", shape->rightX);
        out.call<void>("push", shape->bottomY);
        return out;
    }

    // Boolean operation (bool_op_union = 0, bool_op_inters = 1, bool_op_diff = 2) of two shapes, as
    // a new shape. An empty b is copied (upstream checks hasEdges() before Booleen()).
    static TextShape *booleen(TextShape const &a, TextShape const &b, int op)
    {
        auto result = new TextShape();
        if (!b.shape->hasEdges() && op != bool_op_inters) {
            result->shape->Copy(a.shape.get());
        } else if (!a.shape->hasEdges() && op == bool_op_union) {
            result->shape->Copy(b.shape.get());
        } else {
            result->shape->Booleen(a.shape.get(), b.shape.get(), static_cast<BooleanOp>(op));
        }
        return result;
    }

    // A copy of a shape (Shape::Copy).
    static TextShape *copy(TextShape const &a)
    {
        auto result = new TextShape();
        result->shape->Copy(a.shape.get());
        return result;
    }

    // Upstream SPText::makeInclusionShape(): a shape-inside shape. padding < 0: none.
    static TextShape *inclusion(std::string const &d, emscripten::val const &transform, double padding)
    {
        auto pathvector = Geom::parse_svg_path(d.c_str());
        flatten(pathvector, fill_nonZero);

        auto temp_path = std::make_unique<Path>();
        temp_path->LoadPathVector(pathvector, affine(transform), true);

        auto const make_nice_shape = [](std::unique_ptr<Path> const &contour) -> std::shared_ptr<Shape> {
            auto temp = std::make_unique<Shape>();
            contour->ConvertWithBackData(1.0);
            contour->Fill(temp.get(), 0);
            auto result = std::make_shared<Shape>();
            result->ConvertToShape(temp.get());
            return result;
        };

        auto result = new TextShape();
        if (padding >= 0) {
            auto outline = std::make_unique<Path>();
            temp_path->Outline(outline.get(), padding, join_round, butt_straight, 20.0);
            auto inclusion_shape = make_nice_shape(temp_path);
            auto thickened_border = make_nice_shape(outline);
            result->shape->Booleen(inclusion_shape.get(), thickened_border.get(), bool_op_diff);
        } else {
            result->shape = make_nice_shape(temp_path);
        }
        return result;
    }

    // One shape of upstream SPText::getExclusionShape() (shape-subtract). margin < 0: none.
    static TextShape *exclusion(std::string const &d, emscripten::val const &transform, double margin)
    {
        auto temp = std::make_unique<Path>();
        temp->LoadPathVector(Geom::parse_svg_path(d.c_str()), affine(transform), true);
        auto path = std::make_unique<Path>();
        if (margin >= 0) {
            temp->OutsideOutline(path.get(), -margin, join_round, butt_straight, 20.0);
        } else {
            path = std::move(temp);
        }
        path->Convert(0.25); // Convert to polyline
        Shape livarot_shape;
        path->Fill(&livarot_shape, 0);
        auto result = new TextShape();
        result->shape->ConvertToShape(&livarot_shape);
        return result;
    }

    // Upstream extract_shape() of sp-flowregion.cpp (flowRegion and flowRegionExclude).
    static TextShape *region(std::string const &d, emscripten::val const &transform, bool evenodd)
    {
        Path temp;
        temp.LoadPathVector(Geom::parse_svg_path(d.c_str()), affine(transform), true);
        temp.Convert(0.25);
        Shape n_shp;
        temp.Fill(&n_shp, 0);
        auto result = new TextShape();
        result->shape->ConvertToShape(&n_shp, evenodd ? fill_oddEven : fill_nonZero);
        return result;
    }

    // The rectangle of 'inline-size' (upstream SPText::_buildLayoutInit()).
    static TextShape *rect(double x0, double y0, double x1, double y1)
    {
        Shape shape;
        int v0 = shape.AddPoint(Geom::Point(x0, y0));
        int v1 = shape.AddPoint(Geom::Point(x1, y0));
        int v2 = shape.AddPoint(Geom::Point(x1, y1));
        int v3 = shape.AddPoint(Geom::Point(x0, y1));
        shape.AddEdge(v0, v1);
        shape.AddEdge(v1, v2);
        shape.AddEdge(v2, v3);
        shape.AddEdge(v3, v0);
        auto result = new TextShape();
        result->shape->ConvertToShape(&shape);
        return result;
    }
};

Layout::FontMetrics metrics(double ascent, double descent)
{
    Layout::FontMetrics m;
    m.ascent = ascent;
    m.descent = descent;
    return m;
}

// Upstream Layout::ShapeScanlineMaker on a TextShape (block_progression is a Layout::Direction).
class TextScanlineMaker
{
public:
    TextScanlineMaker(TextShape const &shape, int block_progression)
        : _shape(shape.shape)
        , _maker(_shape.get(), static_cast<Layout::Direction>(block_progression))
    {}

    // The scan runs for a line of the given height: [y, x_start, x_end, ...].
    emscripten::val makeScanline(double ascent, double descent)
    {
        auto out = emscripten::val::array();
        for (auto const &run : _maker.makeScanline(metrics(ascent, descent))) {
            out.call<void>("push", run.y);
            out.call<void>("push", run.x_start);
            out.call<void>("push", run.x_end);
        }
        return out;
    }
    void completeLine() { _maker.completeLine(); }
    double yCoordinate() { return _maker.yCoordinate(); }
    void setNewYCoordinate(double y) { _maker.setNewYCoordinate(y); }
    bool canExtendCurrentScanline(double ascent, double descent)
    {
        return _maker.canExtendCurrentScanline(metrics(ascent, descent));
    }
    void setLineHeight(double ascent, double descent) { _maker.setLineHeight(metrics(ascent, descent)); }

private:
    std::shared_ptr<Shape> _shape; // the maker rasterizes it, keep it alive
    Layout::ShapeScanlineMaker _maker;
};

// The livarot Path of a textPath (upstream refresh_textpath_source()) and the queries of
// Layout::fitToPathAlign(), queryCursorShape(), characterBoundingBox() and
// getNearestCursorPositionTo().
class TextPathPath
{
public:
    TextPathPath(std::string const &d, emscripten::val const &transform)
    {
        auto pv = Geom::parse_svg_path(d.c_str());
        _closed = !pv.empty() && pv[0].closed();
        _empty = pv.empty();
        _path.LoadPathVector(pv, affine(transform), true);
        _path.ConvertWithBackData(0.01);
    }

    bool empty() const { return _empty; }
    bool closed() const { return _closed; }
    double length() { return _path.Length(); }

    // [piece, t] of the curvilinear position, or [] if it is not on the path (CurvilignToPosition).
    emscripten::val position(double offset)
    {
        auto out = emscripten::val::array();
        int unused = 0;
        Path::cut_position *pos = _path.CurvilignToPosition(1, &offset, unused);
        if (pos && pos[0].piece >= 0) {
            out.call<void>("push", pos[0].piece);
            out.call<void>("push", pos[0].t);
        }
        g_free(pos);
        return out;
    }

    // The last piece: the fallback position of queryCursorShape().
    int lastPiece() const { return _path.descr_cmd.size() - 1; }

    // [x, y, tangent x, tangent y] (PointAndTangentAt).
    emscripten::val pointAndTangentAt(int piece, double t)
    {
        Geom::Point point, tangent;
        _path.PointAndTangentAt(piece, t, point, tangent);
        auto out = emscripten::val::array();
        out.call<void>("push", point[Geom::X]);
        out.call<void>("push", point[Geom::Y]);
        out.call<void>("push", tangent[Geom::X]);
        out.call<void>("push", tangent[Geom::Y]);
        return out;
    }

    // [x, y] (PointAt).
    emscripten::val pointAt(int piece, double t)
    {
        Geom::Point point;
        _path.PointAt(piece, t, point);
        auto out = emscripten::val::array();
        out.call<void>("push", point[Geom::X]);
        out.call<void>("push", point[Geom::Y]);
        return out;
    }

    // Whether no subpath starts between the pieces (the test of fitToPathAlign()).
    bool onSameSubpath(int start_piece, int end_piece) const
    {
        for (const auto &pt : _path.pts) {
            if (pt.piece <= start_piece) continue;
            if (pt.piece >= end_piece) break;
            if (pt.isMoveTo == polyline_moveto) return false;
        }
        return true;
    }

    // The curvilinear position nearest to (x, y) (PointToCurvilignPosition + PositionToLength).
    double nearestLength(double x, double y)
    {
        Path::cut_position position = _path.PointToCurvilignPosition(Geom::Point(x, y));
        return _path.PositionToLength(position.piece, position.t);
    }

private:
    Path _path;
    bool _closed = false;
    bool _empty = true;
};

} // namespace

EMSCRIPTEN_BINDINGS(text_layout)
{
    emscripten::class_<TextShape>("TextShape")
        .function("hasEdges", &TextShape::hasEdges)
        .function("bbox", &TextShape::bbox)
        .class_function("booleen", &TextShape::booleen, emscripten::allow_raw_pointers())
        .class_function("copy", &TextShape::copy, emscripten::allow_raw_pointers())
        .class_function("inclusion", &TextShape::inclusion, emscripten::allow_raw_pointers())
        .class_function("exclusion", &TextShape::exclusion, emscripten::allow_raw_pointers())
        .class_function("region", &TextShape::region, emscripten::allow_raw_pointers())
        .class_function("rect", &TextShape::rect, emscripten::allow_raw_pointers());
    emscripten::class_<TextScanlineMaker>("TextScanlineMaker")
        .constructor<TextShape const &, int>()
        .function("makeScanline", &TextScanlineMaker::makeScanline)
        .function("completeLine", &TextScanlineMaker::completeLine)
        .function("yCoordinate", &TextScanlineMaker::yCoordinate)
        .function("setNewYCoordinate", &TextScanlineMaker::setNewYCoordinate)
        .function("canExtendCurrentScanline", &TextScanlineMaker::canExtendCurrentScanline)
        .function("setLineHeight", &TextScanlineMaker::setLineHeight);
    emscripten::class_<TextPathPath>("TextPathPath")
        .constructor<std::string const &, emscripten::val const &>()
        .function("empty", &TextPathPath::empty)
        .function("closed", &TextPathPath::closed)
        .function("length", &TextPathPath::length)
        .function("position", &TextPathPath::position)
        .function("lastPiece", &TextPathPath::lastPiece)
        .function("pointAndTangentAt", &TextPathPath::pointAndTangentAt)
        .function("pointAt", &TextPathPath::pointAt)
        .function("onSameSubpath", &TextPathPath::onSameSubpath)
        .function("nearestLength", &TextPathPath::nearestLength);
}
