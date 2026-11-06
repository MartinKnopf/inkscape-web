// SPDX-License-Identifier: GPL-2.0-or-later
// The extension classes of the EMF and WMF import shim (extension/implementation/
// implementation.h, extension.h, input.h, output.h, print.h, db.h, system.h). In the
// app the extensions are TypeScript (packages/editor/src/extension); here only Emf::open
// and Wmf::open are called. The rest exists so that emf-inout.cpp and wmf-inout.cpp
// compile unchanged.
#pragma once
#include <memory>
#include <string>
#include <2geom/affine.h>
#include <2geom/pathvector.h>
#include <2geom/rect.h>

class SPDocument;
class SPStyle;
class SPItem;
namespace Inkscape {
class DrawingItem;
}

namespace Inkscape::Extension {

class Extension
{
public:
    virtual ~Extension() = default;
    bool get_param_bool(char const *) const { return false; }
    void set_param_bool(char const *, bool) {}
    char const *get_param_string(char const *) const { return ""; }
    void set_param_string(char const *, char const *) {}
};

class Input : public Extension
{};

class Output : public Extension
{
public:
    struct save_failed
    {};
};

class Print : public Extension
{
public:
    SPItem *base = nullptr;
    Inkscape::DrawingItem *root = nullptr;
    unsigned dkey = 0;
    unsigned begin(SPDocument *) { return 1; }
    unsigned finish() { return 0; }
};

namespace Implementation {
class Implementation
{
public:
    virtual ~Implementation() = default;
    virtual bool check(Inkscape::Extension::Extension *) { return true; }
    virtual std::unique_ptr<SPDocument> open(Inkscape::Extension::Input *, char const *, bool) { return nullptr; }
    virtual void save(Inkscape::Extension::Output *, SPDocument *, char const *) {}

    // The print functions that emf-print.h and metafile-print.h override.
    virtual unsigned setup(Inkscape::Extension::Print *) { return 0; }
    virtual unsigned begin(Inkscape::Extension::Print *, SPDocument *) { return 0; }
    virtual unsigned finish(Inkscape::Extension::Print *) { return 0; }
    virtual bool textToPath(Inkscape::Extension::Print *) { return false; }
    virtual unsigned bind(Inkscape::Extension::Print *, Geom::Affine const &, float) { return 0; }
    virtual unsigned release(Inkscape::Extension::Print *) { return 0; }
    virtual unsigned fill(Inkscape::Extension::Print *, Geom::PathVector const &, Geom::Affine const &,
                          SPStyle const *, Geom::OptRect const &, Geom::OptRect const &, Geom::OptRect const &)
    {
        return 0;
    }
    virtual unsigned stroke(Inkscape::Extension::Print *, Geom::PathVector const &, Geom::Affine const &,
                            SPStyle const *, Geom::OptRect const &, Geom::OptRect const &, Geom::OptRect const &)
    {
        return 0;
    }
    virtual unsigned image(Inkscape::Extension::Print *, unsigned char *, unsigned int, unsigned int, unsigned int,
                           Geom::Affine const &, SPStyle const *)
    {
        return 0;
    }
    virtual unsigned text(Inkscape::Extension::Print *, char const *, Geom::Point const &, SPStyle const *)
    {
        return 0;
    }
};
} // namespace Implementation

class DB
{
public:
    Extension *get(char const *) { return nullptr; }
};
inline DB db;

inline Print *get_print(char const *) { return nullptr; }
inline void build_from_mem(char const *, std::unique_ptr<Implementation::Implementation>) {}

} // namespace Inkscape::Extension

#define INKSCAPE_EXTENSION_URI "http://www.inkscape.org/namespace/inkscape/extension"
