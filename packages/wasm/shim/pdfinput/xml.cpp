// SPDX-License-Identifier: GPL-2.0-or-later
// The XML tree and the style functions of the PDF import shim (xml/node.h, xml/repr.h).
#include <algorithm>
#include <cstring>
#include <map>
#include <sstream>
#include "svg/css-ostringstream.h"
#include "svg/stringstream.h"
#include "xml/document.h"
#include "xml/repr.h"

namespace Inkscape::XML {

Node::~Node()
{
    for (Node *child = _first; child;) {
        Node *next = child->_next;
        delete child;
        child = next;
    }
}

char const *Node::attribute(char const *key) const
{
    for (auto &[k, v] : _attributes) {
        if (k == key)
            return v.c_str();
    }
    return nullptr;
}

void Node::setAttribute(char const *key, char const *value)
{
    auto it = std::find_if(_attributes.begin(), _attributes.end(), [key](auto &a) { return a.first == key; });
    if (!value) {
        if (it != _attributes.end())
            _attributes.erase(it);
    } else if (it != _attributes.end()) {
        it->second = value;
    } else {
        _attributes.emplace_back(key, value);
    }
}

double Node::getAttributeDouble(char const *key, double default_value) const
{
    auto v = attribute(key);
    return v ? std::strtod(v, nullptr) : default_value;
}

bool Node::setAttributeCssDouble(char const *key, double val)
{
    CSSOStringStream os;
    os << val;
    setAttribute(key, os.str());
    return true;
}

bool Node::setAttributeSvgDouble(char const *key, double val)
{
    SVGOStringStream os;
    os << val;
    setAttribute(key, os.str());
    return true;
}

bool Node::setAttributeRect(char const *key, Geom::Rect const &val)
{
    SVGOStringStream os;
    os << val.min()[Geom::X] << " " << val.min()[Geom::Y] << " " << val.width() << " " << val.height();
    setAttribute(key, os.str());
    return true;
}

unsigned Node::childCount() const
{
    unsigned n = 0;
    for (auto c = _first; c; c = c->_next)
        n++;
    return n;
}

Node *Node::root()
{
    Node *n = this;
    while (n->_parent && n->_parent->_type != NodeType::DOCUMENT_NODE)
        n = n->_parent;
    return n;
}

/** Give every element of the subtree an id (upstream: SPObject::build names new objects). */
static void ensure_ids(Node *node)
{
    if (node->type() != NodeType::ELEMENT_NODE || !node->document())
        return;
    auto &counters = node->document()->id_counters;
    if (!node->attribute("id")) {
        std::string name = node->name();
        if (auto colon = name.find(':'); colon != std::string::npos)
            name = name.substr(colon + 1);
        node->setAttribute("id", name + std::to_string(++counters[name]));
    }
    for (auto c = node->firstChild(); c; c = c->next())
        ensure_ids(c);
}

/** Whether the node is in the tree of its document. */
static bool in_document(Node const *node)
{
    while (node->parent())
        node = node->parent();
    return node->type() == NodeType::DOCUMENT_NODE;
}

void Node::addChild(Node *child, Node *ref)
{
    child->_parent = this;
    child->_prev = ref;
    child->_next = ref ? ref->_next : _first;
    if (child->_next)
        child->_next->_prev = child;
    else
        _last = child;
    if (ref)
        ref->_next = child;
    else
        _first = child;
    if (in_document(this))
        ensure_ids(child);
}

void Node::addChildAtPos(Node *child, unsigned pos)
{
    Node *ref = nullptr;
    for (Node *c = _first; c && pos > 0; c = c->_next, pos--)
        ref = c;
    addChild(child, ref);
}

void Node::removeChild(Node *child)
{
    if (child->_prev)
        child->_prev->_next = child->_next;
    else
        _first = child->_next;
    if (child->_next)
        child->_next->_prev = child->_prev;
    else
        _last = child->_prev;
    child->_parent = child->_prev = child->_next = nullptr;
}

void Node::changeOrder(Node *child, Node *ref)
{
    removeChild(child);
    addChild(child, ref);
}

Node *Node::duplicate(Document *doc) const
{
    auto copy = new Node(_type, _name, doc);
    copy->_content = _content;
    copy->_attributes = _attributes;
    for (auto c = _first; c; c = c->_next)
        copy->appendChild(c->duplicate(doc));
    return copy;
}

static void escape(std::ostringstream &out, std::string const &s, bool attr)
{
    for (char c : s) {
        switch (c) {
            case '&': out << "&amp;"; break;
            case '<': out << "&lt;"; break;
            case '>': out << "&gt;"; break;
            case '"':
                if (attr) {
                    out << "&quot;";
                    break;
                }
                [[fallthrough]];
            default: out << c;
        }
    }
}

static void write(std::ostringstream &out, Node const *node)
{
    switch (node->type()) {
        case NodeType::TEXT_NODE:
            escape(out, node->content(), false);
            return;
        case NodeType::DOCUMENT_NODE:
            for (auto c = node->firstChild(); c; c = c->next())
                write(out, c);
            return;
        case NodeType::ELEMENT_NODE:
            break;
        default:
            return;
    }
    std::string name = node->name();
    if (name.starts_with("svg:"))
        name = name.substr(4);
    out << '<' << name;
    if (!node->parent() || node->parent()->type() == NodeType::DOCUMENT_NODE) {
        out << " xmlns=\"http://www.w3.org/2000/svg\""
               " xmlns:xlink=\"http://www.w3.org/1999/xlink\""
               " xmlns:inkscape=\"http://www.inkscape.org/namespaces/inkscape\""
               " xmlns:sodipodi=\"http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd\""
               " xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\""
               " xmlns:cc=\"http://creativecommons.org/ns#\""
               " xmlns:dc=\"http://purl.org/dc/elements/1.1/\"";
    }
    for (auto &[k, v] : node->attributeList()) {
        out << ' ' << k << "=\"";
        escape(out, v, true);
        out << '"';
    }
    if (!node->firstChild()) {
        out << "/>";
        return;
    }
    out << '>';
    for (auto c = node->firstChild(); c; c = c->next())
        write(out, c);
    out << "</" << name << '>';
}

std::string serialize(Node const *node)
{
    std::ostringstream out;
    write(out, node);
    return out.str();
}

} // namespace Inkscape::XML

using Inkscape::XML::Node;

SPCSSAttr *sp_repr_css_attr_new()
{
    return new SPCSSAttr();
}

void sp_repr_css_attr_unref(SPCSSAttr *css)
{
    delete css;
}

void sp_repr_css_attr_add_from_string(SPCSSAttr *css, char const *data)
{
    if (!data)
        return;
    std::string s = data;
    size_t pos = 0;
    while (pos < s.size()) {
        size_t end = s.find(';', pos);
        if (end == std::string::npos)
            end = s.size();
        auto decl = s.substr(pos, end - pos);
        if (auto colon = decl.find(':'); colon != std::string::npos) {
            auto trim = [](std::string v) {
                v.erase(0, v.find_first_not_of(" \t\n"));
                v.erase(v.find_last_not_of(" \t\n") + 1);
                return v;
            };
            auto key = trim(decl.substr(0, colon));
            auto value = trim(decl.substr(colon + 1));
            if (!key.empty())
                css->setAttribute(key.c_str(), value.c_str());
        }
        pos = end + 1;
    }
}

SPCSSAttr *sp_repr_css_attr(Node const *repr, char const *attr)
{
    auto css = sp_repr_css_attr_new();
    sp_repr_css_attr_add_from_string(css, repr->attribute(attr));
    return css;
}

char const *sp_repr_css_property(SPCSSAttr *css, char const *name, char const *defval)
{
    auto v = css->attribute(name);
    return v ? v : defval;
}

void sp_repr_css_set_property(SPCSSAttr *css, char const *name, char const *value)
{
    // Upstream keeps unset properties as empty values; here they are removed.
    css->setAttribute(name, value);
}

void sp_repr_css_set_property_double(SPCSSAttr *css, char const *name, double value)
{
    Inkscape::CSSOStringStream os;
    os << value;
    css->setAttribute(name, os.str());
}

void sp_repr_css_write_string(SPCSSAttr *css, Glib::ustring &str)
{
    str.clear();
    for (auto &[k, v] : css->attributeList()) {
        if (v.empty())
            continue;
        if (!str.empty())
            str += ';';
        str += k + ':' + v;
    }
}

void sp_repr_css_set(Node *repr, SPCSSAttr *css, char const *key)
{
    Glib::ustring str;
    sp_repr_css_write_string(css, str);
    repr->setAttributeOrRemoveIfEmpty(key, str.c_str());
}

void sp_repr_css_merge(SPCSSAttr *dst, SPCSSAttr const *src)
{
    for (auto &[k, v] : src->attributeList())
        dst->setAttribute(k.c_str(), v.c_str());
}

void sp_repr_css_change(Node *repr, SPCSSAttr *css, char const *key)
{
    auto current = sp_repr_css_attr(repr, key);
    sp_repr_css_merge(current, css);
    sp_repr_css_set(repr, current, key);
    sp_repr_css_attr_unref(current);
}
