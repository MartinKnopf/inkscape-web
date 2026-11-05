// SPDX-License-Identifier: GPL-2.0-or-later
// Upstream: src/3rdparty/libuemf/include/libuemf/uemf.h
// The libuemf calls of the EMF and WMF import and output, and the libuemf constants that the
// output uses (same names as uemf.h and uwmf.h). uemf-module.wasm of @inkscape-web/wasm (libuemf
// compiled to WASM, see packages/wasm/bindings/uemf.cpp) implements UemfBackend.
//
// The editor has no dependency on the WASM module: the app sets the loader, and the module is
// loaded on the first EMF or WMF open or save. Records, EMFTRACK, EMFHANDLES and other buffers
// are pointers into the WASM memory (numbers); 0 is NULL.

/** A pointer into the WASM memory. */
export type Ptr = number;

export interface U_COLORREF {
  Red: number;
  Green: number;
  Blue: number;
  Reserved: number;
}
export interface U_POINTL {
  x: number;
  y: number;
}
export type U_POINT = U_POINTL;
export interface U_SIZEL {
  cx: number;
  cy: number;
}
export interface U_RECTL {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface U_XFORM {
  eM11: number;
  eM12: number;
  eM21: number;
  eM22: number;
  eDx: number;
  eDy: number;
}
export interface U_LOGBRUSH {
  lbStyle: number;
  lbColor: U_COLORREF;
  lbHatch: number;
}
export interface U_TRIVERTEX {
  x: number;
  y: number;
  Red: number;
  Green: number;
  Blue: number;
  Alpha: number;
}
export interface U_BITMAPINFOHEADER {
  biSize: number;
  biWidth: number;
  biHeight: number;
  biPlanes: number;
  biBitCount: number;
  biCompression: number;
  biSizeImage: number;
  biXPelsPerMeter: number;
  biYPelsPerMeter: number;
  biClrUsed: number;
  biClrImportant: number;
}

/** A record and the handle of the object that it creates. */
export interface HandleRecord {
  rec: Ptr;
  ih: number;
}

/** The functions of uemf-module.wasm. Output parameters of libuemf are returned in objects. */
export interface UemfBackend {
  // Import (upstream Emf::open and Wmf::open): the SVG text, "" on error.
  emfImport(data: Uint8Array): string;
  wmfImport(data: Uint8Array): string;

  // Memory and files
  copy_in(bytes: Uint8Array): Ptr;
  read_file(path: string): Uint8Array | null;
  free(p: Ptr): void;

  // EMF file
  emf_start(name: string, initsize: number, chunksize: number): { status: number; et: Ptr };
  emf_finish(et: Ptr, eht: Ptr): number;
  emf_free(et: Ptr): number;
  emf_append(rec: Ptr, et: Ptr, freerec: number): number;
  htable_create(initsize: number, chunksize: number): Ptr;
  htable_free(eht: Ptr): number;
  drawing_size_100th(
    x100thmm: number,
    y100thmm: number,
    dpmm: number,
  ): { rclBounds: U_RECTL; rclFrame: U_RECTL };
  device_size(xmm: number, ymm: number, dpmm: number): { szlDev: U_SIZEL; szlMm: U_SIZEL };

  // Text (uemf_utf.h, symbol-convert.h)
  U_Utf8ToUtf16le(src: string): Ptr;
  wchar16len(src: Ptr): number;
  U_Utf16leEdit(src: Ptr, find: number, replace: number): number;
  TableGen(symb: boolean, wing: boolean, zdng: boolean, pua: boolean): void;
  UnicodeToNon(text: Ptr): { ccount: number; newfont: number };
  FontName(code: number): string;
  CanUTN(): number;
  SingleUnicodeToNon(text: number): number;

  // Objects
  textcomment_set(string: string): Ptr;
  selectobject_set(ihObject: number, eht: Ptr): Ptr;
  deleteobject_set(ihObject: number, eht: Ptr): Ptr;
  createbrushindirect_set(eht: Ptr, lb: U_LOGBRUSH): HandleRecord;
  createdibpatternbrushpt_set(eht: Ptr, iUsage: number, Bmi: Ptr, cbPx: number, Px: Ptr): HandleRecord;
  extlogpen_set(
    elpPenStyle: number,
    elpWidth: number,
    elpBrushStyle: number,
    elpColor: U_COLORREF,
    elpHatch: number,
    elpStyleEntry: number[],
  ): Ptr;
  extcreatepen_set(eht: Ptr, Bmi: Ptr, cbPx: number, Px: Ptr, elp: Ptr): HandleRecord;
  /** A malloc() U_LOGFONT. */
  logfont_set(
    lfHeight: number,
    lfWidth: number,
    lfEscapement: number,
    lfOrientation: number,
    lfWeight: number,
    lfItalic: number,
    lfUnderline: number,
    lfStrikeOut: number,
    lfCharSet: number,
    lfOutPrecision: number,
    lfClipPrecision: number,
    lfQuality: number,
    lfPitchAndFamily: number,
    lfFaceName: Ptr,
  ): Ptr;
  extcreatefontindirectw_set(eht: Ptr, elf: Ptr, elfw: Ptr): HandleRecord;
  RGBA_to_DIB(
    rgba_px: Uint8Array,
    w: number,
    h: number,
    stride: number,
    colortype: number,
    use_ct: number,
    invert: number,
  ): { status: number; px: Ptr; cbPx: number; ct: Ptr; numCt: number };
  swapRBinRGBA(px: Ptr, pixels: number): void;
  bitmapinfoheader_set(
    biWidth: number,
    biHeight: number,
    biPlanes: number,
    biBitCount: number,
    biCompression: number,
    biSizeImage: number,
    biXPelsPerMeter: number,
    biYPelsPerMeter: number,
    biClrUsed: number,
    biClrImportant: number,
  ): U_BITMAPINFOHEADER;
  bitmapinfo_set(BmiHeader: U_BITMAPINFOHEADER, BmiColors: Ptr): Ptr;
  emrtext_set(
    ptlReference: U_POINTL,
    NumString: number,
    cbChar: number,
    string: Ptr,
    fOptions: number,
    rcl: U_RECTL,
    Dx: number[],
  ): Ptr;

  // EMF records
  U_EMRHEADER_set(
    rclBounds: U_RECTL,
    rclFrame: U_RECTL,
    nDesc: number,
    Description: Ptr,
    szlDevice: U_SIZEL,
    szlMillimeters: U_SIZEL,
    bOpenGL: number,
  ): Ptr;
  U_EMRPOLYGON_set(rclBounds: U_RECTL, points: U_POINTL[]): Ptr;
  U_EMRPOLYBEZIERTO_set(rclBounds: U_RECTL, points: U_POINTL[]): Ptr;
  U_EMREOF_set(et: Ptr): Ptr;
  U_EMRGRADIENTFILL_set(rclBounds: U_RECTL, TriVert: U_TRIVERTEX[], ulMode: number, GradObj: number[]): Ptr;
  U_EMRSTRETCHDIBITS_set(
    rclBounds: U_RECTL,
    Dest: U_POINTL,
    cDest: U_POINTL,
    Src: U_POINTL,
    cSrc: U_POINTL,
    iUsageSrc: number,
    dwRop: number,
    Bmi: Ptr,
    cbPx: number,
    Px: Ptr,
  ): Ptr;
  U_EMREXTTEXTOUTW_set(
    rclBounds: U_RECTL,
    iGraphicsMode: number,
    exScale: number,
    eyScale: number,
    emrtext: Ptr,
  ): Ptr;
  U_EMRMODIFYWORLDTRANSFORM_set(xform: U_XFORM, iMode: number): Ptr;
  U_EMRSETMAPMODE_set(iMode: number): Ptr;
  U_EMRSETBKMODE_set(iMode: number): Ptr;
  U_EMRSETPOLYFILLMODE_set(iMode: number): Ptr;
  U_EMRSETTEXTALIGN_set(iMode: number): Ptr;
  U_EMRSETROP2_set(iMode: number): Ptr;
  U_EMRSETSTRETCHBLTMODE_set(iMode: number): Ptr;
  U_EMRSETMITERLIMIT_set(eMiterLimit: number): Ptr;
  U_EMRSELECTCLIPPATH_set(iMode: number): Ptr;
  U_EMRRESTOREDC_set(iRelative: number): Ptr;
  U_EMRSETTEXTCOLOR_set(crColor: U_COLORREF): Ptr;
  U_EMRSETBKCOLOR_set(crColor: U_COLORREF): Ptr;
  U_EMRMOVETOEX_set(ptl: U_POINTL): Ptr;
  U_EMRLINETO_set(ptl: U_POINTL): Ptr;
  U_EMRRECTANGLE_set(rclBox: U_RECTL): Ptr;
  U_EMRELLIPSE_set(rclBox: U_RECTL): Ptr;
  U_EMRFILLPATH_set(rclBox: U_RECTL): Ptr;
  U_EMRSTROKEPATH_set(rclBox: U_RECTL): Ptr;
  U_EMRSTROKEANDFILLPATH_set(rclBox: U_RECTL): Ptr;
  U_EMRSAVEDC_set(): Ptr;
  U_EMRBEGINPATH_set(): Ptr;
  U_EMRENDPATH_set(): Ptr;
  U_EMRCLOSEFIGURE_set(): Ptr;
}

let backend: UemfBackend | null = null;
let loader: (() => Promise<UemfBackend>) | null = null;

/** Set the loader of the module (the app: import('@inkscape-web/wasm/uemf')). */
export function setUemfBackendLoader(load: (() => Promise<UemfBackend>) | null): void {
  loader = load;
}

/** Load the module if it is not loaded yet; null if there is no loader or it fails. */
export async function ensureUemfBackend(): Promise<UemfBackend | null> {
  if (backend) return backend;
  if (!loader) return null;
  try {
    backend = await loader();
  } catch (e) {
    console.error(e);
    return null;
  }
  return backend;
}

// ---- uemf.h constants and macros ----

export const U_REC_FREE = 1;
export const U_RCL_DEF: U_RECTL = { left: 0, top: 0, right: -1, bottom: -1 };

/** U_RGB(r, g, b) (colorref3_set: the values are truncated to bytes). */
export function U_RGB(r: number, g: number, b: number): U_COLORREF {
  return { Red: r & 0xff, Green: g & 0xff, Blue: b & 0xff, Reserved: 0 };
}
/** U_RGBA(r, g, b, a) (colorref4_set). */
export function U_RGBA(r: number, g: number, b: number, a: number): U_COLORREF {
  return { Red: r & 0xff, Green: g & 0xff, Blue: b & 0xff, Reserved: a & 0xff };
}
export const U_RGBAGetR = (c: U_COLORREF) => c.Red;
export const U_RGBAGetG = (c: U_COLORREF) => c.Green;
export const U_RGBAGetB = (c: U_COLORREF) => c.Blue;
export const pointl_set = (x: number, y: number): U_POINTL => ({ x, y });
export const rectl_set = (ul: U_POINTL, lr: U_POINTL): U_RECTL => ({
  left: ul.x,
  top: ul.y,
  right: lr.x,
  bottom: lr.y,
});
export const logbrush_set = (lbStyle: number, lbColor: U_COLORREF, lbHatch: number): U_LOGBRUSH => ({
  lbStyle,
  lbColor,
  lbHatch,
});

export const U_ALTERNATE = 1;
export const U_WINDING = 2;
export const U_BCBM_COLOR32 = 32;
export const U_BI_RGB = 0;
export const U_BS_SOLID = 0;
export const U_BS_HATCHED = 2;
export const U_BS_DIBPATTERN = 5;
export const U_CLIP_DEFAULT_PRECIS = 0;
export const U_COLORONCOLOR = 3;
export const U_DEFAULT_CHARSET = 1;
export const U_DEFAULT_PITCH = 0;
export const U_DEFAULT_QUALITY = 0;
export const U_DEVICE_DEFAULT_FONT = 0x8000000e;
export const U_DIB_RGB_COLORS = 0;
export const U_ETO_NONE = 0;
export const U_ETO_RTLREADING = 0x80;
export const U_FF_DONTCARE = 0;
export const U_FW_THIN = 100;
export const U_FW_EXTRALIGHT = 200;
export const U_FW_LIGHT = 300;
export const U_FW_NORMAL = 400;
export const U_FW_MEDIUM = 500;
export const U_FW_SEMIBOLD = 600;
export const U_FW_BOLD = 700;
export const U_FW_EXTRABOLD = 800;
export const U_FW_HEAVY = 900;
export const U_GM_COMPATIBLE = 1;
export const U_GRADIENT_FILL_RECT_H = 0;
export const U_GRADIENT_FILL_RECT_V = 1;
export const U_HS_HORIZONTAL = 0;
export const U_HS_CROSS = 4;
export const U_HS_DIAGCROSS = 5;
export const U_HS_SOLIDCLR = 6;
export const U_HS_DITHEREDBKCLR = 11;
export const U_MM_TEXT = 1;
export const U_MWT_LEFTMULTIPLY = 2;
export const U_NULL_BRUSH = 0x80000005;
export const U_NULL_PEN = 0x80000008;
export const U_TRANSPARENT = 1;
export const U_OPAQUE = 2;
export const U_OUT_DEFAULT_PRECIS = 0;
export const U_PS_SOLID = 0;
export const U_PS_USERSTYLE = 7;
export const U_PS_ENDCAP_ROUND = 0;
export const U_PS_ENDCAP_SQUARE = 0x100;
export const U_PS_ENDCAP_FLAT = 0x200;
export const U_PS_JOIN_ROUND = 0;
export const U_PS_JOIN_BEVEL = 0x1000;
export const U_PS_JOIN_MITER = 0x2000;
export const U_PS_GEOMETRIC = 0x10000;
export const U_R2_COPYPEN = 13;
export const U_RGN_COPY = 5;
export const U_SRCCOPY = 0x00cc0020;
export const U_TA_LEFT = 0;
export const U_TA_RIGHT = 2;
export const U_TA_BASELINE = 0x18;
export const U_TA_RTLREADING = 0x100;

/** symbol-convert.h enum cvt_to_font. */
export enum cvt_to_font {
  CVTNON,
  CVTSYM,
  CVTZDG,
  CVTWDG,
}

// ---- WMF (uwmf.h; bindings/uwmf.cpp) ----
// WMFTRACK, WMFHANDLES, U_PAIRF and U_FONT are pointers. The WMF output also uses the shared
// functions above (free, read_file, U_Utf8ToUtf16le, UnicodeToNon, RGBA_to_DIB ...).

export interface U_POINT16 {
  x: number;
  y: number;
}
export interface U_RECT16 {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
/** U_PEN (libuemf keeps the width in Widthw[0]). */
export interface U_PEN {
  Style: number;
  Width: number;
  Color: U_COLORREF;
}
export interface U_WLOGBRUSH {
  Style: number;
  Color: U_COLORREF;
  Hatch: number;
}

// Declaration merging: the WMF functions of uemf-module.wasm.
export interface UemfBackend {
  // WMF file
  wmf_start(name: string, initsize: number, chunksize: number): { status: number; wt: Ptr };
  wmf_finish(wt: Ptr): number;
  uwmf_free(wt: Ptr): number;
  wmf_append(rec: Ptr, wt: Ptr, freerec: number): number;
  wmf_header_append(rec: Ptr, wt: Ptr, freerec: number): number;
  wmf_htable_create(initsize: number, chunksize: number): Ptr;
  wmf_htable_free(wht: Ptr): number;
  /** A malloc() U_PAIRF. */
  U_PAIRF_set(x: number, y: number): Ptr;

  // Text (uemf_utf.h): malloc() Latin1 strings, 0 on error
  U_Utf8ToLatin1(src: string): Ptr;
  U_Utf16leToLatin1(src: Ptr): Ptr;

  // Objects
  wselectobject_set(ihObject: number, wht: Ptr): Ptr;
  wdeleteobject_set(ihObject: number, wht: Ptr): Ptr;
  wcreatepenindirect_set(wht: Ptr, pen: U_PEN): HandleRecord;
  wcreatebrushindirect_set(wht: Ptr, lb: U_WLOGBRUSH): HandleRecord;
  wcreatedibpatternbrush_srcdib_set(wht: Ptr, iUsage: number, Bmi: Ptr, cbPx: number, Px: Ptr): HandleRecord;
  /** A malloc() U_FONT; FaceName is a Latin1 string (U_Utf8ToLatin1). */
  U_FONT_set(
    Height: number,
    Width: number,
    Escapement: number,
    Orientation: number,
    Weight: number,
    Italic: number,
    Underline: number,
    StrikeOut: number,
    CharSet: number,
    OutPrecision: number,
    ClipPrecision: number,
    Quality: number,
    PitchAndFamily: number,
    FaceName: Ptr,
  ): Ptr;
  wcreatefontindirect_set(wht: Ptr, uf: Ptr): HandleRecord;
  wmiterlimit_set(limit: number): Ptr;

  // WMF records
  U_WMRHEADER_set(size: Ptr, dpi: number): Ptr;
  U_WMRPOLYGON_set(points: U_POINT16[]): Ptr;
  U_WMRPOLYLINE_set(points: U_POINT16[]): Ptr;
  U_WMRPOLYPOLYGON_set(aPolyCounts: number[], points: U_POINT16[]): Ptr;
  U_WMRSTRETCHDIB_set(
    Dest: U_POINT16,
    cDest: U_POINT16,
    Src: U_POINT16,
    cSrc: U_POINT16,
    cUsage: number,
    dwRop3: number,
    Bmi: Ptr,
    cbPx: number,
    Px: Ptr,
  ): Ptr;
  U_WMREXTTEXTOUT_set(
    Dst: U_POINT16,
    Length: number,
    Opts: number,
    string: Ptr,
    dx: number[],
    rect: U_RECT16,
  ): Ptr;
  U_WMRSETWINDOWEXT_set(extent: U_POINT16): Ptr;
  U_WMRSETWINDOWORG_set(coord: U_POINT16): Ptr;
  U_WMRMOVETO_set(coord: U_POINT16): Ptr;
  U_WMRLINETO_set(coord: U_POINT16): Ptr;
  U_WMRSETMAPMODE_set(Mode: number): Ptr;
  U_WMRSETBKMODE_set(Mode: number): Ptr;
  U_WMRSETPOLYFILLMODE_set(Mode: number): Ptr;
  U_WMRSETTEXTALIGN_set(Mode: number): Ptr;
  U_WMRSETROP2_set(Mode: number): Ptr;
  U_WMRSETSTRETCHBLTMODE_set(Mode: number): Ptr;
  U_WMRSETTEXTCOLOR_set(Color: U_COLORREF): Ptr;
  U_WMRSETBKCOLOR_set(Color: U_COLORREF): Ptr;
  U_WMRRECTANGLE_set(rect: U_RECT16): Ptr;
  U_WMRELLIPSE_set(rect: U_RECT16): Ptr;
  U_WMREOF_set(): Ptr;
}

export const U_RCL16_DEF: U_RECT16 = { left: 0, top: 0, right: -1, bottom: -1 };
/** point16_set (the values are truncated to int16_t). */
export const point16_set = (x: number, y: number): U_POINT16 => ({ x: (x << 16) >> 16, y: (y << 16) >> 16 });
export const U_RECT16_set = (ul: U_POINT16, lr: U_POINT16): U_RECT16 => ({
  left: ul.x,
  top: ul.y,
  right: lr.x,
  bottom: lr.y,
});
/** U_PEN_set (the values are truncated to uint16_t). */
export const U_PEN_set = (Style: number, Width: number, Color: U_COLORREF): U_PEN => ({
  Style: Style & 0xffff,
  Width: Width & 0xffff,
  Color,
});
export const U_WLOGBRUSH_set = (Style: number, Color: U_COLORREF, Hatch: number): U_WLOGBRUSH => ({
  Style: Style & 0xffff,
  Color,
  Hatch: Hatch & 0xffff,
});

export const U_BS_NULL = 1;
export const U_MM_ANISOTROPIC = 8;
export const U_PS_DASH = 1;
export const U_PS_DOT = 2;
export const U_PS_DASHDOT = 3;
export const U_PS_DASHDOTDOT = 4;
export const U_PS_NULL = 5;
