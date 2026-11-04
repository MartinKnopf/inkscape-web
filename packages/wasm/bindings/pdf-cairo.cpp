// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/extension/internal/pdfinput/pdf-input.cpp, poppler/glib/poppler-page.cc
// Embind API of the page preview of PdfImportDialog and of the Cairo import of PdfInput::open().
// Upstream renders through poppler-glib; here poppler's CairoOutputDev does it directly, as
// poppler_page_render_full() does. Compiled with poppler's Cairo classes renamed (see build.sh).
#include <cmath>
#include <map>
#include <memory>
#include <string>
#include <vector>
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <cairo-svg.h>
#include <cairo.h>
#include <CairoOutputDev.h>
#include <PDFDoc.h>
#include <Page.h>

using emscripten::val;

std::shared_ptr<PDFDoc> pdf_document(int handle); // pdf.cpp

namespace {

/** The Cairo output devices of the open documents (upstream: the one of the PopplerDocument). */
std::map<int, std::unique_ptr<CairoOutputDev>> output_devs;

CairoOutputDev *output_dev(int handle, PDFDoc *doc)
{
    auto &dev = output_devs[handle];
    if (!dev) {
        dev = std::make_unique<CairoOutputDev>();
        dev->startDoc(doc);
    }
    return dev.get();
}

/** Upstream poppler_page_render_full(): the page at 72 dpi into cr. */
void render_page(int handle, PDFDoc *doc, Page *page, cairo_t *cr, bool printing)
{
    auto dev = output_dev(handle, doc);
    dev->setCairo(cr);
    dev->setPrinting(printing);
    cairo_save(cr);
    page->displaySlice(dev, 72.0, 72.0, 0, false, true, -1, -1, -1, -1, printing);
    cairo_restore(cr);
    dev->setCairo(nullptr);
}

/**
 * The preview of a page, fitted into preview_width x preview_height (upstream
 * PdfImportDialog::_setPreviewPage): {width, height, data} with RGBA rows; null on failure.
 */
val pdf_render_page(int handle, int page_num, int preview_width, int preview_height)
{
    auto doc = pdf_document(handle);
    if (!doc)
        return val::null();
    auto page = doc->getCatalog()->getPage(page_num);
    if (!page)
        return val::null();

    // Get page size by accounting for rotation
    double width, height;
    int rotate = page->getRotate();
    if (rotate == 90 || rotate == 270) {
        height = page->getCropWidth();
        width = page->getCropHeight();
    } else {
        width = page->getCropWidth();
        height = page->getCropHeight();
    }
    // Calculate the needed scaling for the page
    double scale_x = (double)preview_width / width;
    double scale_y = (double)preview_height / height;
    double scale_factor = (scale_x > scale_y) ? scale_y : scale_x;
    int thumb_width = (int)ceil(width * scale_factor);
    int thumb_height = (int)ceil(height * scale_factor);

    auto surface = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, thumb_width, thumb_height);
    cairo_t *cr = cairo_create(surface);
    cairo_set_source_rgba(cr, 1.0, 1.0, 1.0, 1.0); // Set fill color to white
    cairo_paint(cr);                               // Clear it
    cairo_scale(cr, scale_factor, scale_factor);   // Use Cairo for resizing the image
    render_page(handle, doc.get(), page, cr, false);
    cairo_destroy(cr);

    // Premultiplied native ARGB32 to RGBA (the page is opaque).
    cairo_surface_flush(surface);
    auto data = cairo_image_surface_get_data(surface);
    int stride = cairo_image_surface_get_stride(surface);
    std::vector<unsigned char> rgba(size_t(thumb_width) * thumb_height * 4);
    for (int y = 0; y < thumb_height; y++) {
        auto row = reinterpret_cast<uint32_t const *>(data + y * stride);
        for (int x = 0; x < thumb_width; x++) {
            uint32_t p = row[x];
            auto o = &rgba[(size_t(y) * thumb_width + x) * 4];
            o[0] = p >> 16;
            o[1] = p >> 8;
            o[2] = p;
            o[3] = p >> 24;
        }
    }
    cairo_surface_destroy(surface);
    auto result = val::object();
    result.set("width", thumb_width);
    result.set("height", thumb_height);
    result.set("data", val(emscripten::typed_memory_view(rgba.size(), rgba.data())).call<val>("slice"));
    return result;
}

cairo_status_t write_string(void *closure, unsigned char const *data, unsigned int length)
{
    static_cast<std::string *>(closure)->append(reinterpret_cast<char const *>(data), length);
    return CAIRO_STATUS_SUCCESS;
}

/** The Cairo import of PdfInput::open(): the page as cairo draws it into an SVG surface. */
std::string pdf_cairo_import(int handle, int page_num)
{
    auto doc = pdf_document(handle);
    if (!doc)
        return "";
    auto page = doc->getCatalog()->getPage(page_num);
    if (!page)
        return "";
    // poppler_page_get_size(): the crop box, rotated.
    double width = page->getCropWidth();
    double height = page->getCropHeight();
    if (page->getRotate() == 90 || page->getRotate() == 270)
        std::swap(width, height);

    std::string output;
    cairo_surface_t *surface = cairo_svg_surface_create_for_stream(write_string, &output, width, height);

    // Reset back to PT for cairo 1.17.6 and above which sets to UNIT_USER
    cairo_svg_surface_set_document_unit(surface, CAIRO_SVG_UNIT_PT);

    // This magical function results in more fine-grain fallbacks. In particular, a mesh
    // gradient won't necessarily result in the whole PDF being rasterized. Of course, SVG
    // 1.2 never made it as a standard, but hey, we'll take what we can get. This trick was
    // found by examining the 'pdftocairo' code.
    cairo_svg_surface_restrict_to_version(surface, CAIRO_SVG_VERSION_1_2);

    cairo_t *cr = cairo_create(surface);
    render_page(handle, doc.get(), page, cr, true);
    cairo_show_page(cr);
    cairo_destroy(cr);
    cairo_surface_destroy(surface);
    return output;
}

} // namespace

void pdf_cairo_close(int handle)
{
    output_devs.erase(handle);
}

EMSCRIPTEN_BINDINGS(pdf_cairo)
{
    emscripten::function("pdfRenderPage", &pdf_render_page);
    emscripten::function("pdfCairoImport", &pdf_cairo_import);
}
