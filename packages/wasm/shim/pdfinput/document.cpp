// SPDX-License-Identifier: GPL-2.0-or-later
// SPDocument, the RDF work metadata and the colors of the PDF import shim.
#include "document.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <iomanip>
#include <sstream>
#include "colors/shim-colors.h"
#include "rdf.h"

namespace {

Inkscape::XML::Node *find_child(Inkscape::XML::Node *parent, char const *name)
{
    for (auto c = parent->firstChild(); c; c = c->next()) {
        if (std::strcmp(c->name(), name) == 0)
            return c;
    }
    return nullptr;
}

Inkscape::XML::Node *find_by_id(Inkscape::XML::Node *node, std::string const &id)
{
    if (auto v = node->attribute("id"); v && id == v)
        return node;
    for (auto c = node->firstChild(); c; c = c->next()) {
        if (auto found = find_by_id(c, id))
            return found;
    }
    return nullptr;
}

} // namespace

SPDocument::SPDocument()
    : _xml(std::make_unique<Inkscape::XML::Document>())
    , _root(_xml->createElement("svg:svg"))
    , _defs(_xml->createElement("svg:defs"))
{
    _root->setAttribute("version", "1.1");
    _xml->appendChild(_root);
    _root->appendChild(_xml->createElement("sodipodi:namedview"));
    _root->appendChild(_defs.getRepr());
}

SPDocument::~SPDocument() = default;

std::unique_ptr<SPDocument> SPDocument::createNewDoc(char const *, bool)
{
    return std::make_unique<SPDocument>();
}

SPObject *SPDocument::getObjectByRepr(Inkscape::XML::Node *repr)
{
    if (!repr)
        return nullptr;
    for (auto &view : _views) {
        if (view->getRepr() == repr)
            return view.get();
    }
    _views.push_back(std::make_unique<SPItem>(repr));
    return _views.back().get();
}

SPObject *SPDocument::getObjectById(std::string const &id)
{
    return getObjectByRepr(find_by_id(_root, id));
}

// ----- rdf.h

rdf_work_entity_t *rdf_find_entity(char const *name)
{
    static rdf_work_entity_t entities[] = {
        {"title", "dc:title"},   {"date", "dc:date"},           {"creator", "dc:creator"},
        {"rights", "dc:rights"}, {"description", "dc:description"}, {"subject", "dc:subject"},
    };
    for (auto &e : entities) {
        if (std::strcmp(e.name, name) == 0)
            return &e;
    }
    return nullptr;
}

unsigned int rdf_set_work_entity(SPDocument *doc, rdf_work_entity_t *entity, char const *text)
{
    if (!entity || !text)
        return 0;
    auto xml = doc->getReprDoc();
    auto root = doc->getReprRoot();
    auto child = [xml](Inkscape::XML::Node *parent, char const *name) {
        auto node = find_child(parent, name);
        if (!node) {
            node = xml->createElement(name);
            parent->appendChild(node);
        }
        return node;
    };
    auto work = child(child(child(root, "svg:metadata"), "rdf:RDF"), "cc:Work");
    auto element = child(work, entity->tag);
    while (element->firstChild())
        element->removeChild(element->firstChild());
    // Upstream RDF types: agents hold their name in cc:Agent/dc:title, bags one rdf:li per item.
    Inkscape::XML::Node *holder = element;
    if (std::strcmp(entity->name, "creator") == 0 || std::strcmp(entity->name, "rights") == 0) {
        holder = child(child(element, "cc:Agent"), "dc:title");
    } else if (std::strcmp(entity->name, "subject") == 0) {
        auto bag = child(element, "rdf:Bag");
        std::string s = text;
        size_t pos = 0;
        while (pos <= s.size()) {
            auto end = s.find(',', pos);
            if (end == std::string::npos)
                end = s.size();
            auto item = s.substr(pos, end - pos);
            item.erase(0, item.find_first_not_of(' '));
            if (!item.empty()) {
                auto li = xml->createElement("rdf:li");
                li->appendChild(xml->createTextNode(item.c_str()));
                bag->appendChild(li);
            }
            pos = end + 1;
        }
        return 1;
    }
    holder->appendChild(xml->createTextNode(text));
    return 1;
}

// ----- colors/shim-colors.h

namespace Inkscape::Colors {

Manager &Manager::get()
{
    static Manager manager;
    return manager;
}

std::shared_ptr<Space::AnySpace> Manager::find(Space::Type type)
{
    return std::make_shared<Space::AnySpace>(type);
}

/** A number as CssPrinter prints it (colors/printer.cpp). */
static std::string css_number(double value)
{
    std::ostringstream oo;
    oo.imbue(std::locale::classic());
    oo.precision(3);
    oo << std::fixed << value;
    auto number = oo.str();
    while (number.find('.') != std::string::npos && (number.back() == '0' || number.back() == '.'))
        number.pop_back();
    return number == "-0" ? "0" : number;
}

std::string Space::AnySpace::toString(std::vector<double> const &values) const
{
    switch (_type) {
        case Type::RGB: {
            // rgba_to_hex(toRGBA(values)) of colors/spaces/rgb.cpp
            auto to8 = [](double v) { return static_cast<unsigned>(std::clamp(v, 0.0, 1.0) * 255.0 + 0.5); };
            std::ostringstream oo;
            oo << '#' << std::hex << std::setfill('0');
            for (int i = 0; i < 3; i++)
                oo << std::setw(2) << to8(i < (int)values.size() ? values[i] : 0.0);
            return oo.str();
        }
        case Type::CMYK: {
            // CssFuncPrinter(4, "device-cmyk") of colors/spaces/cmyk.cpp
            std::string out = "device-cmyk(";
            for (size_t i = 0; i < values.size() && i < 4; i++)
                out += (i ? " " : "") + css_number(values[i]);
            return out + ")";
        }
        default:
            // Gray::toString() of colors/spaces/gray.h prints nothing.
            return "";
    }
}

} // namespace Inkscape::Colors
