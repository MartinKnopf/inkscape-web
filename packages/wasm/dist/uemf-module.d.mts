// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
interface WasmModule {
}

type EmbindString = ArrayBuffer|Uint8Array|Uint8ClampedArray|Int8Array|string;
export type U_COLORREF = {
  Red: number,
  Green: number,
  Blue: number,
  Reserved: number
};

export type U_POINTL = {
  x: number,
  y: number
};

export type U_SIZEL = {
  cx: number,
  cy: number
};

export type U_RECTL = {
  left: number,
  top: number,
  right: number,
  bottom: number
};

export type U_XFORM = {
  eM11: number,
  eM12: number,
  eM21: number,
  eM22: number,
  eDx: number,
  eDy: number
};

export type U_LOGBRUSH = {
  lbStyle: number,
  lbColor: U_COLORREF,
  lbHatch: number
};

export type U_TRIVERTEX = {
  x: number,
  y: number,
  Red: number,
  Green: number,
  Blue: number,
  Alpha: number
};

export type U_BITMAPINFOHEADER = {
  biSize: number,
  biWidth: number,
  biHeight: number,
  biPlanes: number,
  biBitCount: number,
  biCompression: number,
  biSizeImage: number,
  biXPelsPerMeter: number,
  biYPelsPerMeter: number,
  biClrUsed: number,
  biClrImportant: number
};

export type U_POINT16 = {
  x: number,
  y: number
};

export type U_RECT16 = {
  left: number,
  top: number,
  right: number,
  bottom: number
};

export type U_PEN = {
  Style: number,
  Width: number,
  Color: U_COLORREF
};

export type U_WLOGBRUSH = {
  Style: number,
  Color: U_COLORREF,
  Hatch: number
};

interface EmbindModule {
  emfImport(_0: EmbindString): string;
  wmfImport(_0: EmbindString): string;
  addFont(_0: EmbindString, _1: EmbindString, _2: EmbindString, _3: EmbindString, _4: number, _5: number): void;
  copy_in(_0: EmbindString): number;
  read_file(_0: EmbindString): any;
  free(_0: number): void;
  emf_start(_0: EmbindString, _1: number, _2: number): any;
  emf_finish(_0: number, _1: number): number;
  emf_free(_0: number): number;
  emf_append(_0: number, _1: number, _2: number): number;
  htable_create(_0: number, _1: number): number;
  htable_free(_0: number): number;
  drawing_size_100th(_0: number, _1: number, _2: number): any;
  device_size(_0: number, _1: number, _2: number): any;
  U_Utf8ToUtf16le(_0: EmbindString): number;
  wchar16len(_0: number): number;
  U_Utf16leEdit(_0: number, _1: number, _2: number): number;
  TableGen(_0: boolean, _1: boolean, _2: boolean, _3: boolean): void;
  UnicodeToNon(_0: number): any;
  FontName(_0: number): string;
  CanUTN(): number;
  SingleUnicodeToNon(_0: number): number;
  textcomment_set(_0: EmbindString): number;
  selectobject_set(_0: number, _1: number): number;
  deleteobject_set(_0: number, _1: number): number;
  createbrushindirect_set(_0: number, _1: U_LOGBRUSH): any;
  createdibpatternbrushpt_set(_0: number, _1: number, _2: number, _3: number, _4: number): any;
  extlogpen_set(_0: number, _1: number, _2: number, _3: U_COLORREF, _4: number, _5: any): number;
  extcreatepen_set(_0: number, _1: number, _2: number, _3: number, _4: number): any;
  logfont_set(_0: number, _1: number, _2: number, _3: number, _4: number, _5: number, _6: number, _7: number, _8: number, _9: number, _10: number, _11: number, _12: number, _13: number): number;
  extcreatefontindirectw_set(_0: number, _1: number, _2: number): any;
  RGBA_to_DIB(_0: EmbindString, _1: number, _2: number, _3: number, _4: number, _5: number, _6: number): any;
  swapRBinRGBA(_0: number, _1: number): void;
  bitmapinfoheader_set(_0: number, _1: number, _2: number, _3: number, _4: number, _5: number, _6: number, _7: number, _8: number, _9: number): U_BITMAPINFOHEADER;
  bitmapinfo_set(_0: U_BITMAPINFOHEADER, _1: number): number;
  emrtext_set(_0: U_POINTL, _1: number, _2: number, _3: number, _4: number, _5: U_RECTL, _6: any): number;
  U_EMRHEADER_set(_0: U_RECTL, _1: U_RECTL, _2: number, _3: number, _4: U_SIZEL, _5: U_SIZEL, _6: number): number;
  U_EMRPOLYGON_set(_0: U_RECTL, _1: any): number;
  U_EMRPOLYBEZIERTO_set(_0: U_RECTL, _1: any): number;
  U_EMREOF_set(_0: number): number;
  U_EMRGRADIENTFILL_set(_0: U_RECTL, _1: any, _2: number, _3: any): number;
  U_EMRSTRETCHDIBITS_set(_0: U_RECTL, _1: U_POINTL, _2: U_POINTL, _3: U_POINTL, _4: U_POINTL, _5: number, _6: number, _7: number, _8: number, _9: number): number;
  U_EMREXTTEXTOUTW_set(_0: U_RECTL, _1: number, _2: number, _3: number, _4: number): number;
  U_EMRMODIFYWORLDTRANSFORM_set(_0: U_XFORM, _1: number): number;
  U_EMRSETMAPMODE_set(_0: number): number;
  U_EMRSETBKMODE_set(_0: number): number;
  U_EMRSETPOLYFILLMODE_set(_0: number): number;
  U_EMRSETTEXTALIGN_set(_0: number): number;
  U_EMRSETROP2_set(_0: number): number;
  U_EMRSETSTRETCHBLTMODE_set(_0: number): number;
  U_EMRSETMITERLIMIT_set(_0: number): number;
  U_EMRSELECTCLIPPATH_set(_0: number): number;
  U_EMRRESTOREDC_set(_0: number): number;
  U_EMRSETTEXTCOLOR_set(_0: U_COLORREF): number;
  U_EMRSETBKCOLOR_set(_0: U_COLORREF): number;
  U_EMRMOVETOEX_set(_0: U_POINTL): number;
  U_EMRLINETO_set(_0: U_POINTL): number;
  U_EMRRECTANGLE_set(_0: U_RECTL): number;
  U_EMRELLIPSE_set(_0: U_RECTL): number;
  U_EMRFILLPATH_set(_0: U_RECTL): number;
  U_EMRSTROKEPATH_set(_0: U_RECTL): number;
  U_EMRSTROKEANDFILLPATH_set(_0: U_RECTL): number;
  U_EMRSAVEDC_set(): number;
  U_EMRBEGINPATH_set(): number;
  U_EMRENDPATH_set(): number;
  U_EMRCLOSEFIGURE_set(): number;
  wmf_start(_0: EmbindString, _1: number, _2: number): any;
  wmf_finish(_0: number): number;
  uwmf_free(_0: number): number;
  wmf_append(_0: number, _1: number, _2: number): number;
  wmf_header_append(_0: number, _1: number, _2: number): number;
  wmf_htable_create(_0: number, _1: number): number;
  wmf_htable_free(_0: number): number;
  U_PAIRF_set(_0: number, _1: number): number;
  U_Utf8ToLatin1(_0: EmbindString): number;
  U_Utf16leToLatin1(_0: number): number;
  wselectobject_set(_0: number, _1: number): number;
  wdeleteobject_set(_0: number, _1: number): number;
  wcreatepenindirect_set(_0: number, _1: U_PEN): any;
  wcreatebrushindirect_set(_0: number, _1: U_WLOGBRUSH): any;
  wcreatedibpatternbrush_srcdib_set(_0: number, _1: number, _2: number, _3: number, _4: number): any;
  U_FONT_set(_0: number, _1: number, _2: number, _3: number, _4: number, _5: number, _6: number, _7: number, _8: number, _9: number, _10: number, _11: number, _12: number, _13: number): number;
  wcreatefontindirect_set(_0: number, _1: number): any;
  wmiterlimit_set(_0: number): number;
  U_WMRHEADER_set(_0: number, _1: number): number;
  U_WMRPOLYGON_set(_0: any): number;
  U_WMRPOLYLINE_set(_0: any): number;
  U_WMRPOLYPOLYGON_set(_0: any, _1: any): number;
  U_WMRSTRETCHDIB_set(_0: U_POINT16, _1: U_POINT16, _2: U_POINT16, _3: U_POINT16, _4: number, _5: number, _6: number, _7: number, _8: number): number;
  U_WMREXTTEXTOUT_set(_0: U_POINT16, _1: number, _2: number, _3: number, _4: any, _5: U_RECT16): number;
  U_WMRSETWINDOWEXT_set(_0: U_POINT16): number;
  U_WMRSETWINDOWORG_set(_0: U_POINT16): number;
  U_WMRMOVETO_set(_0: U_POINT16): number;
  U_WMRLINETO_set(_0: U_POINT16): number;
  U_WMRSETMAPMODE_set(_0: number): number;
  U_WMRSETBKMODE_set(_0: number): number;
  U_WMRSETPOLYFILLMODE_set(_0: number): number;
  U_WMRSETTEXTALIGN_set(_0: number): number;
  U_WMRSETROP2_set(_0: number): number;
  U_WMRSETSTRETCHBLTMODE_set(_0: number): number;
  U_WMRSETTEXTCOLOR_set(_0: U_COLORREF): number;
  U_WMRSETBKCOLOR_set(_0: U_COLORREF): number;
  U_WMRRECTANGLE_set(_0: U_RECT16): number;
  U_WMRELLIPSE_set(_0: U_RECT16): number;
  U_WMREOF_set(): number;
}

export type MainModule = WasmModule & EmbindModule;
export default function MainModuleFactory (options?: unknown): Promise<MainModule>;
