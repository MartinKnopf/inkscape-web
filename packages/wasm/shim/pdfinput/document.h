// SPDX-License-Identifier: GPL-2.0-or-later
// SPDocument of the PDF import shim: an XML document with the root svg:svg, sodipodi:namedview
// and svg:defs, as SPDocument::createNewDoc(nullptr, true) makes it. Objects are thin views on
// their nodes; the TypeScript document model builds the real objects from the SVG text.
#pragma once
#include <memory>
#include <string>
#include <2geom/rect.h>
#include "colors/document-cms.h"
#include "xml/document.h"
#include "xml/node.h"

class SPDocument;

class SPObject
{
public:
    explicit SPObject(Inkscape::XML::Node *repr)
        : _repr(repr)
    {}
    virtual ~SPObject() = default;
    Inkscape::XML::Node *getRepr() const { return _repr; }
    char const *getId() const { return _repr->attribute("id"); }

private:
    Inkscape::XML::Node *_repr;
};

/** An item: its bounds are not known here (the PDF import then keeps the clip path). */
class SPItem : public SPObject
{
public:
    using SPObject::SPObject;
    Geom::OptRect visualBounds() const { return {}; }
};

using SPDefs = SPObject;

template <typename T>
T *cast(SPObject *obj)
{
    return dynamic_cast<T *>(obj);
}
template <typename T>
bool is(SPObject *obj)
{
    return dynamic_cast<T *>(obj) != nullptr;
}

class SPDocument
{
public:
    SPDocument();
    ~SPDocument();
    static std::unique_ptr<SPDocument> createNewDoc(char const *, bool);

    Inkscape::XML::Document *getReprDoc() { return _xml.get(); }
    Inkscape::XML::Node *getReprRoot() { return _root; }
    SPDefs *getDefs() { return &_defs; }
    /** The object of the element with the id (an SPItem view); null if there is none. */
    SPObject *getObjectById(std::string const &id);
    SPObject *getObjectByRepr(Inkscape::XML::Node *repr);
    void ensureUpToDate() {}
    Inkscape::Colors::DocumentCMS &getDocumentCMS() { return _cms; }

private:
    std::unique_ptr<Inkscape::XML::Document> _xml;
    Inkscape::XML::Node *_root;
    SPObject _defs;
    std::vector<std::unique_ptr<SPObject>> _views;
    Inkscape::Colors::DocumentCMS _cms;
};
