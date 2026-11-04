// SPDX-License-Identifier: GPL-2.0-or-later
// The work metadata of rdf.h for the PDF import shim: the entities that the PDF import sets
// (title, description, creator, subject, date), written as upstream writes them into
// svg:metadata/rdf:RDF/cc:Work (see document.cpp).
#pragma once

class SPDocument;

struct rdf_work_entity_t
{
    char const *name;
    char const *tag;
};

rdf_work_entity_t *rdf_find_entity(char const *name);
unsigned int rdf_set_work_entity(SPDocument *doc, rdf_work_entity_t *entity, char const *text);
