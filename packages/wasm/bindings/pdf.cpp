// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/pdfinput/pdf-input.cpp
// Embind API of the PDF import: the non-GUI part of PdfInput::open() and add_builder_page()
// (the dialog is in TypeScript). PDF documents go to JavaScript as handles; the import returns
// the SVG text of the document that SvgBuilder built (see shim/pdfinput). The page preview and
// the Cairo import are in pdf-cairo.cpp.
#include <map>
#include <memory>
#include <string>
#include <vector>
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <ErrorCodes.h>
#include <GfxFont.h>
#include <GlobalParams.h>
#include <PDFDoc.h>
#include <Page.h>
#include <Stream.h>
#include "document.h"
#include "extension/internal/pdfinput/pdf-parser.h"
#include "extension/internal/pdfinput/poppler-utils.h"
#include "extension/internal/pdfinput/svg-builder.h"
#include "libnrtype/font-factory.h"
#include "xml/node.h"

using emscripten::val;
using Inkscape::Extension::Internal::SvgBuilder;

void pdf_cairo_close(int handle); // pdf-cairo.cpp

namespace {

struct OpenPdf
{
    std::vector<char> data; // MemStream reads from here
    std::shared_ptr<PDFDoc> doc;
    FontList fonts;
};
std::map<int, OpenPdf> docs;
int next_handle = 1;

/**
 * Open PDF data; the handle (> 0), or minus the poppler error code (errEncrypted, errDamaged,
 * ...).
 */
int pdf_open(val const &bytes)
{
    if (!globalParams) {
        globalParams = std::make_unique<GlobalParams>();
    }
    OpenPdf pdf;
    pdf.data = emscripten::convertJSArrayToNumberVector<char>(bytes);
    pdf.doc = std::make_shared<PDFDoc>(
        std::make_unique<MemStream>(pdf.data.data(), 0, Goffset(pdf.data.size()), Object::null()));
    if (!pdf.doc->isOk()) {
        int error = pdf.doc->getErrorCode();
        return -(error ? error : errOpenFile);
    }
    int handle = next_handle++;
    docs[handle] = std::move(pdf);
    return handle;
}

void pdf_close(int handle)
{
    docs.erase(handle);
    pdf_cairo_close(handle);
}

} // namespace

/** The document of a handle (for pdf-cairo.cpp); null if it is not open. */
std::shared_ptr<PDFDoc> pdf_document(int handle)
{
    auto it = docs.find(handle);
    return it == docs.end() ? nullptr : it->second.doc;
}

namespace {

int pdf_page_count(int handle)
{
    auto it = docs.find(handle);
    return it == docs.end() ? 0 : it->second.doc->getCatalog()->getNumPages();
}

FontList &fonts_of(OpenPdf &pdf)
{
    if (!pdf.fonts)
        pdf.fonts = getPdfFonts(pdf.doc);
    return pdf.fonts;
}

/** The fonts of the document for the dialog (upstream PdfImportDialog::_setFonts). */
val pdf_fonts(int handle)
{
    auto result = val::array();
    auto it = docs.find(handle);
    if (it == docs.end())
        return result;
    for (auto &[font, data] : *fonts_of(it->second)) {
        auto f = val::object();
        f.set("id", font->getID()->num);
        f.set("name", data.name);
        f.set("family", data.family);
        f.set("style", data.style);
        f.set("weight", data.weight);
        f.set("stretch", data.stretch);
        f.set("found", data.found);
        f.set("substitute", data.found ? std::string() : data.getSubstitute());
        f.set("cid", font->isCIDFont());
        result.call<void>("push", f);
    }
    return result;
}

/** SvgBuilder::autoFontStrategies(): {font id: FontFallback} for a FontStrategy. */
val pdf_auto_font_strategies(int handle, int strategy)
{
    auto result = val::object();
    auto it = docs.find(handle);
    if (it == docs.end())
        return result;
    for (auto &[id, fallback] : SvgBuilder::autoFontStrategies(FontStrategy(strategy), fonts_of(it->second))) {
        result.set(std::to_string(id), int(fallback));
    }
    return result;
}

/** The local fonts for the font matching ([{family, style, postscriptName}]). */
void pdf_set_local_fonts(val const &list)
{
    std::vector<LocalFont> fonts;
    auto n = list["length"].as<unsigned>();
    for (unsigned i = 0; i < n; i++) {
        auto f = list[i];
        fonts.push_back({f["family"].as<std::string>(), f["style"].as<std::string>(),
                         f["postscriptName"].as<std::string>()});
    }
    set_local_fonts(std::move(fonts));
    for (auto &[handle, pdf] : docs)
        pdf.fonts = nullptr;
}

/** Upstream PdfInput::add_builder_page(). */
void add_builder_page(std::shared_ptr<PDFDoc> pdf_doc, SvgBuilder *builder, int page_num,
                      std::string const &crop_to, double color_delta)
{
    Catalog *catalog = pdf_doc->getCatalog();
    page_num = std::clamp(page_num, 1, catalog->getNumPages());
    Page *page = catalog->getPage(page_num);
    if (!page) {
        return;
    }

    // Apply crop settings
    std::optional<PDFRectangle> clipToBox;
    if (crop_to == "media-box") {
        clipToBox = page->getMediaBox();
    } else if (crop_to == "crop-box") {
        clipToBox = page->getCropBox();
    } else if (crop_to == "trim-box") {
        clipToBox = page->getTrimBox();
    } else if (crop_to == "bleed-box") {
        clipToBox = page->getBleedBox();
    } else if (crop_to == "art-box") {
        clipToBox = page->getArtBox();
    }

    // Create parser  (extension/internal/pdfinput/pdf-parser.h)
    auto pdf_parser = PdfParser(pdf_doc, builder, page, clipToBox);

    // Set up approximation precision for parser. Used for converting Mesh Gradients into tiles.
    if (color_delta <= 0.0) {
        color_delta = 1.0 / 2.0;
    } else {
        color_delta = 1.0 / color_delta;
    }
    pdf_parser.setApproximationPrecision(color_delta, 6);

    // Parse the document structure
    Object obj = page->getContents();
    if (!obj.isNull()) {
        pdf_parser.parse(&obj);
    }

    // Parse the annotations
    if (auto annots = page->getAnnotsObject(); annots.isArray()) {
        auto *annotsArray = annots.getArray();
        auto const size = annotsArray->getLength();
        for (int i = 0; i < size; i++) {
            pdf_parser.build_annots(annotsArray->get(i), page_num);
        }
    }
}

/**
 * The internal import of PdfInput::open(): the pages (1-based) as one SVG document. options:
 * {docname, importPages, embedImages, convertColors, groupBy, clipTo, approximationPrecision,
 * fontStrategies: {font id: FontFallback}}. Returns '' if the handle is not open.
 */
std::string pdf_import(int handle, val const &pages, val const &options)
{
    auto it = docs.find(handle);
    if (it == docs.end())
        return "";
    auto pdf_doc = it->second.doc;

    FontStrategies font_strats;
    auto strategies = options["fontStrategies"];
    auto keys = val::global("Object").call<val>("keys", strategies);
    for (unsigned i = 0; i < keys["length"].as<unsigned>(); i++) {
        auto k = keys[i].as<std::string>();
        font_strats[std::stoi(k)] = FontFallback(strategies[k].as<int>());
    }

    auto doc = SPDocument::createNewDoc(nullptr, true);
    auto docname = options["docname"].as<std::string>();
    auto builder = std::make_unique<SvgBuilder>(doc.get(), docname.data(), pdf_doc->getXRef());
    builder->setFontStrategies(font_strats);
    builder->setPageMode(options["importPages"].as<bool>());
    builder->setEmbedImages(options["embedImages"].as<bool>());
    builder->setConvertColors(options["convertColors"].as<bool>());
    builder->setGroupBy(options["groupBy"].as<std::string>());
    auto crop_to = options["clipTo"].as<std::string>();
    double color_delta = options["approximationPrecision"].as<double>();

    for (unsigned i = 0; i < pages["length"].as<unsigned>(); i++) {
        add_builder_page(pdf_doc, builder.get(), pages[i].as<int>(), crop_to, color_delta);
    }
    builder.reset();
    return Inkscape::XML::serialize(doc->getReprRoot());
}

} // namespace

EMSCRIPTEN_BINDINGS(pdf)
{
    emscripten::function("pdfOpen", &pdf_open);
    emscripten::function("pdfClose", &pdf_close);
    emscripten::function("pdfPageCount", &pdf_page_count);
    emscripten::function("pdfFonts", &pdf_fonts);
    emscripten::function("pdfAutoFontStrategies", &pdf_auto_font_strategies);
    emscripten::function("pdfSetLocalFonts", &pdf_set_local_fonts);
    emscripten::function("pdfImport", &pdf_import);
}
