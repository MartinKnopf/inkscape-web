// SPDX-License-Identifier: GPL-2.0-or-later
// SPDocument of the EMF and WMF import: it keeps the SVG text that the import makes
// (createNewDocFromMem). The TypeScript document model builds the real document from it.
// The other members are what Metafile::setViewBoxIfMissing and the print functions use;
// the WASM module does not call them.
#pragma once
#include <memory>
#include <string>
#include <2geom/rect.h>
#include "object/sp-root.h"
#include "util/units.h"

namespace Inkscape::XML {
class Node
{
public:
    void setAttribute(std::string const &, std::string const &) {}
};
} // namespace Inkscape::XML

class SPNamedView
{
public:
    Inkscape::XML::Node *getRepr() { return &_repr; }

private:
    Inkscape::XML::Node _repr;
};

/** The width or height of the document (an Inkscape::Util::Quantity). */
struct SPDocumentLength
{
    Inkscape::Util::Unit const *unit;
    double px;
    double value(Inkscape::Util::Unit const *u) const { return Inkscape::Util::Quantity::convert(px, "px", u->abbr); }
    double value(char const *u) const { return Inkscape::Util::Quantity::convert(px, "px", u); }
};

class SPDocument
{
public:
    explicit SPDocument(std::string svg)
        : svg(std::move(svg))
    {}
    static std::unique_ptr<SPDocument> createNewDocFromMem(std::string const &buffer, bool = false)
    {
        return std::make_unique<SPDocument>(buffer);
    }
    /** The SVG text of the imported metafile. */
    std::string svg;

    void ensureUpToDate() {}
    SPRoot *getRoot() { return &_root; }
    SPNamedView *getNamedView() { return &_namedview; }
    SPDocumentLength getWidth() const { return {&_unit, 0}; }
    SPDocumentLength getHeight() const { return {&_unit, 0}; }
    void setViewBox(Geom::Rect const &) {}

private:
    SPRoot _root;
    SPNamedView _namedview;
    Inkscape::Util::Unit _unit;
};
