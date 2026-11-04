// SPDX-License-Identifier: GPL-2.0-or-later
// Inkscape::XML::Document of the PDF import shim (see xml/node.h).
#pragma once
#include <map>
#include <string>
#include "xml/node.h"

namespace Inkscape {
namespace XML {

class Document : public Node
{
public:
    Document()
        : Node(NodeType::DOCUMENT_NODE, "xml", this)
    {}
    Node *createElement(char const *name) { return new Node(NodeType::ELEMENT_NODE, name, this); }
    Node *createTextNode(char const *content)
    {
        auto node = new Node(NodeType::TEXT_NODE, "string", this);
        node->setContent(content);
        return node;
    }
    /** The last number of the ids of each element name (see Node::addChild). */
    std::map<std::string, unsigned> id_counters;
};

} // namespace XML
} // namespace Inkscape
