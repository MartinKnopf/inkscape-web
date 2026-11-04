// SPDX-License-Identifier: GPL-2.0-or-later
// A small XML tree with the interface of Inkscape::XML::Node that the PDF import (svg-builder.cpp)
// uses. The tree is serialized to SVG text (serialize.cpp) and read by the document model in
// TypeScript. Nodes are owned by their parent; GC::release and GC::anchor do nothing.
#pragma once
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>
#include <2geom/rect.h>

namespace Inkscape {
namespace Util {
using const_char_ptr = char const *;
}
namespace XML {

enum class NodeType { DOCUMENT_NODE, ELEMENT_NODE, TEXT_NODE, COMMENT_NODE, PI_NODE };

class Document;

class Node
{
public:
    Node(NodeType type, std::string name, Document *doc)
        : _type(type)
        , _name(std::move(name))
        , _doc(doc)
    {}
    virtual ~Node();
    Node(Node const &) = delete;
    Node &operator=(Node const &) = delete;

    NodeType type() const { return _type; }
    char const *name() const { return _name.c_str(); }
    int code() const { return 0; }
    Document *document() { return _doc; }

    char const *content() const { return _content.c_str(); }
    void setContent(char const *content) { _content = content ? content : ""; }

    char const *attribute(char const *key) const;
    void setAttribute(char const *key, char const *value);
    void setAttribute(char const *key, std::string const &value) { setAttribute(key, value.c_str()); }
    void setAttribute(std::string const &key, std::string const &value) { setAttribute(key.c_str(), value.c_str()); }
    void setAttributeOrRemoveIfEmpty(char const *key, char const *value)
    {
        setAttribute(key, value && *value ? value : nullptr);
    }
    void setAttributeOrRemoveIfEmpty(char const *key, std::string const &value)
    {
        setAttributeOrRemoveIfEmpty(key, value.c_str());
    }
    void removeAttribute(char const *key) { setAttribute(key, nullptr); }
    double getAttributeDouble(char const *key, double default_value = 0.0) const;
    bool setAttributeCssDouble(char const *key, double val);
    bool setAttributeSvgDouble(char const *key, double val);
    bool setAttributeRect(char const *key, Geom::Rect const &val);
    std::vector<std::pair<std::string, std::string>> const &attributeList() const { return _attributes; }

    Node *parent() { return _parent; }
    Node const *parent() const { return _parent; }
    Node *next() { return _next; }
    Node const *next() const { return _next; }
    Node *prev() { return _prev; }
    Node *firstChild() { return _first; }
    Node const *firstChild() const { return _first; }
    Node *lastChild() { return _last; }
    Node const *lastChild() const { return _last; }
    unsigned childCount() const;
    Node *root();

    /** Insert child after ref (at the start if ref is null). */
    void addChild(Node *child, Node *ref);
    void appendChild(Node *child) { addChild(child, _last); }
    void addChildAtPos(Node *child, unsigned pos);
    /** Unlink child; the caller owns it then. */
    void removeChild(Node *child);
    void changeOrder(Node *child, Node *ref);
    Node *duplicate(Document *doc) const;

private:
    NodeType _type;
    std::string _name;
    std::string _content;
    Document *_doc;
    std::vector<std::pair<std::string, std::string>> _attributes;
    Node *_parent = nullptr;
    Node *_next = nullptr;
    Node *_prev = nullptr;
    Node *_first = nullptr;
    Node *_last = nullptr;
};

/** The XML text of the subtree (svg: is the default namespace). */
std::string serialize(Node const *node);

} // namespace XML

namespace GC {
// Nodes belong to their parent (or to the builder until they are added).
template <typename T>
void release(T *) {}
template <typename T>
void anchor(T *) {}
} // namespace GC
} // namespace Inkscape
