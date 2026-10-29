// SPDX-License-Identifier: GPL-2.0-or-later
// Embind API of upstream libavoid (src/3rdparty/adaptagrams/libavoid) for the
// connectors: the calls that src/conn-avoid-ref.cpp and src/object/sp-conn-end-pair.cpp
// make on Avoid::Router, Avoid::ShapeRef and Avoid::ConnRef. Shapes and connectors
// are named by integer ids; src/index.ts wraps the class with types.
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <algorithm>
#include <map>
#include <memory>
#include <vector>
#include "libavoid/libavoid.h"

namespace {

Avoid::Polygon to_polygon(emscripten::val const &points)
{
    auto xy = emscripten::vecFromJSArray<double>(points);
    Avoid::Polygon poly(static_cast<int>(xy.size() / 2));
    for (std::size_t i = 0; i + 1 < xy.size(); i += 2) {
        poly.ps[i / 2] = Avoid::Point(xy[i], xy[i + 1]);
    }
    return poly;
}

} // namespace

/**
 * One Avoid::Router (upstream: SPDocument::_router) with its shapes and connectors.
 * After processTransaction(), takeChanged() lists the connectors whose route changed
 * (upstream: the ConnRef callbacks that redraw the connector paths).
 */
class AvoidRouter
{
public:
    AvoidRouter()
        : _router(std::make_unique<Avoid::Router>(Avoid::PolyLineRouting | Avoid::OrthogonalRouting))
    {
        // Penalise libavoid for choosing paths with needless extra segments.
        // This results in much better looking orthogonal connector paths.
        _router->setRoutingPenalty(Avoid::segmentPenalty);
    }

    ~AvoidRouter()
    {
        // The router deletes its shapes and connectors.
        _router.reset();
    }

    void addShape(int id, emscripten::val const &xy)
    {
        deleteShape(id);
        auto poly = to_polygon(xy);
        _shapes[id] = new Avoid::ShapeRef(_router.get(), poly, id);
    }

    void moveShape(int id, emscripten::val const &xy)
    {
        if (auto it = _shapes.find(id); it != _shapes.end()) {
            auto poly = to_polygon(xy);
            _router->moveShape(it->second, poly);
        }
    }

    void deleteShape(int id)
    {
        if (auto it = _shapes.find(id); it != _shapes.end()) {
            _router->deleteShape(it->second);
            _shapes.erase(it);
        }
    }

    void addConnector(int id, bool orthogonal)
    {
        deleteConnector(id);
        auto conn = new Avoid::ConnRef(_router.get(), id);
        conn->setRoutingType(orthogonal ? Avoid::ConnType_Orthogonal : Avoid::ConnType_PolyLine);
        auto &cb = _callbacks[id];
        cb = std::make_unique<Callback>(Callback{this, id});
        conn->setCallback(&AvoidRouter::onRerouted, cb.get());
        _conns[id] = conn;
    }

    void setRoutingType(int id, bool orthogonal)
    {
        if (auto c = conn(id)) {
            c->setRoutingType(orthogonal ? Avoid::ConnType_Orthogonal : Avoid::ConnType_PolyLine);
        }
    }

    void setEndpoints(int id, double x0, double y0, double x1, double y1)
    {
        if (auto c = conn(id)) {
            c->setEndpoints(Avoid::Point(x0, y0), Avoid::Point(x1, y1));
        }
    }

    void makePathInvalid(int id)
    {
        if (auto c = conn(id)) {
            c->makePathInvalid();
        }
    }

    bool isInitialised(int id)
    {
        auto c = conn(id);
        return c && c->isInitialised();
    }

    void deleteConnector(int id)
    {
        if (auto it = _conns.find(id); it != _conns.end()) {
            _router->deleteConnector(it->second);
            _conns.erase(it);
        }
        _callbacks.erase(id);
        _changed.erase(std::remove(_changed.begin(), _changed.end(), id), _changed.end());
    }

    bool processTransaction() { return _router->processTransaction(); }

    /** The ids of the connectors rerouted since the last call. */
    emscripten::val takeChanged()
    {
        auto out = emscripten::val::array();
        for (int id : _changed) {
            out.call<void>("push", id);
        }
        _changed.clear();
        return out;
    }

    /**
     * The display route (upstream SPConnEndPair::createCurve): {points: [x, y, ...], types}. With a
     * curvature, the route of curvedPolyline() whose types are 'M', 'L' and 'C' per point.
     */
    emscripten::val route(int id, double curvature)
    {
        auto out = emscripten::val::object();
        auto points = emscripten::val::array();
        std::string types;
        if (auto c = conn(id)) {
            bool straight = curvature < 1e-3;
            Avoid::PolyLine r = c->displayRoute();
            if (!straight) {
                r = r.curvedPolyline(curvature);
            }
            c->calcRouteDist();
            for (std::size_t i = 0; i < r.ps.size(); ++i) {
                points.call<void>("push", r.ps[i].x);
                points.call<void>("push", r.ps[i].y);
                types += straight || i >= r.ts.size() ? 'L' : r.ts[i];
            }
        }
        out.set("points", points);
        out.set("types", types);
        return out;
    }

private:
    struct Callback
    {
        AvoidRouter *router;
        int id;
    };

    static void onRerouted(void *ptr)
    {
        auto cb = static_cast<Callback *>(ptr);
        cb->router->_changed.push_back(cb->id);
    }

    Avoid::ConnRef *conn(int id)
    {
        auto it = _conns.find(id);
        return it == _conns.end() ? nullptr : it->second;
    }

    std::unique_ptr<Avoid::Router> _router;
    std::map<int, Avoid::ShapeRef *> _shapes;
    std::map<int, Avoid::ConnRef *> _conns;
    std::map<int, std::unique_ptr<Callback>> _callbacks;
    std::vector<int> _changed;
};

EMSCRIPTEN_BINDINGS(avoid)
{
    emscripten::class_<AvoidRouter>("AvoidRouter")
        .constructor<>()
        .function("addShape", &AvoidRouter::addShape)
        .function("moveShape", &AvoidRouter::moveShape)
        .function("deleteShape", &AvoidRouter::deleteShape)
        .function("addConnector", &AvoidRouter::addConnector)
        .function("setRoutingType", &AvoidRouter::setRoutingType)
        .function("setEndpoints", &AvoidRouter::setEndpoints)
        .function("makePathInvalid", &AvoidRouter::makePathInvalid)
        .function("isInitialised", &AvoidRouter::isInitialised)
        .function("deleteConnector", &AvoidRouter::deleteConnector)
        .function("processTransaction", &AvoidRouter::processTransaction)
        .function("takeChanged", &AvoidRouter::takeChanged)
        .function("route", &AvoidRouter::route);
}
