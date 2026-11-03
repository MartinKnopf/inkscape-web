# Skipped upstream features

Features that the browser platform cannot reproduce. Each entry needs a
technical reason. See the candidates in `PLAN.md` section 7.

| Feature | Upstream | Reason | Decided |
|---|---|---|---|
| EPS and PostScript input (`eps_input`, `ps_input`) | `share/extensions/eps_input.inx`, `ps_input.inx` | Needs the external program `ps2pdf` (Ghostscript). The browser cannot run external programs. | 2026-11-03 |
| XFIG input (`fig_input`) | `share/extensions/fig_input.inx` | Needs the external program `fig2dev`. | 2026-11-03 |
| GIMP XCF output (`gimp_xcf`) | `share/extensions/gimp_xcf.inx` | Needs the external program `gimp`. | 2026-11-03 |
| Scribus PDF output (`scribus_export_pdf`) | `share/extensions/scribus_export_pdf.inx` | Needs the external program `scribus`. | 2026-11-03 |
| LaTeX and Typst formulas (`pdflatex`, `typst_formula`) | `share/extensions/pdflatex.inx`, `typst_formula.inx` | Need the external programs `pdflatex` and `typst`. | 2026-11-03 |
| Optimized PNG output (`raster_output_png` with optipng) | `share/extensions/raster_output_png.inx` | Needs the external program `optipng`. | 2026-11-03 |
| Extensions that call the `inkscape` command line (`guillotine`, `layer2png`, `jessyink_export`, `webslicer_export`) | `share/extensions/guillotine.py`, ... | They start a second Inkscape process (`inkex.command.inkscape`) to export images. The browser cannot start processes. | 2026-11-03 |
| Plotter output (`plotter`) | `share/extensions/plotter.inx` | Writes to a serial port through `pyserial`; Pyodide has no serial port access. | 2026-11-03 |
| Extension Manager (`org.inkscape.extension.manager`) | `share/extensions/other/inkman` | Installs Python packages into the user profile with pip; the browser has no such profile. Upstream installs it as a separate component. | 2026-11-03 |
| Windows vector printing (`print_win32_vector`) | `share/extensions/print_win32_vector.inx` | Windows only; upstream installs it only on Windows. | 2026-11-03 |
