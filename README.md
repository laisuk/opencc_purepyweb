# Opencc PurePy Web

**Chinese text and document conversion in your browser, powered
by [opencc_purepy](https://github.com/laisuk/opencc_purepy) and [Pyodide](https://pyodide.org/) (WebAssembly).**

A static, client-side demo of the pure-Python OpenCC conversion engine. No server-side conversion backend is required.

## 🌐 Live Demo

**[Open the Opencc PurePy Web demo](https://laisuk.github.io/opencc_purepyweb/)**

> The link becomes available once GitHub Pages is enabled and the site is deployed.

Click **Initialize Pyodide** to load the Python runtime and conversion engine. Initialization is manual; opening the
page does not automatically download Pyodide assets.

### Interactive demo features

- **Chinese conversion** — 24 OpenCC configurations for Simplified, Traditional, and regional variants.
- **Custom dictionaries** — Multiple dictionary slots, Append/Override modes, validation, Apply, and Reset.
- **Document conversion** — Convert DOCX, XLSX, PPTX, ODT, ODS, ODP, and EPUB files locally through the PurePy Office
  helper.
- **Text files and encodings** — Open TXT/Markdown files with automatic CJK encoding detection or manual encoding
  selection.
- **Additional tools** — Unicode compatibility normalization, DeTofu, punctuation conversion, and GB mojibake repair.
- **Editor and interface** — Dual editors, character counts, conversion timing, file downloads, and System/Light/Dark
  themes.
- **Diagnostics** — Smoke tests and a large-text regression test.

**Your text, documents, and custom dictionary entries are processed locally in your browser, not uploaded to a
conversion server.** Pyodide, editor assets, and (if needed) the Python package are fetched from external hosts.

**No Python installation or conversion backend is required to use the hosted demo.** An internet connection is needed to
load external runtime assets.

## How it works

The browser loads Pyodide, which runs the `opencc_purepy` Python package through WebAssembly. Document conversion uses
`opencc_purepy.office_helper.convert_office_doc` with an in-memory filesystem. The demo does **not** depend on
`opencc-fmmseg-wasm` or `OpenccWasm`.

## Run locally

From the repository root:

```powershell
python -m http.server 8000 --directory docs
```

Open <http://localhost:8000/> and click **Initialize Pyodide**.

Pyodide and CodeMirror require access to their hosted assets. If CodeMirror cannot load, the editors fall back to native
textareas. The CJK encoding detector is bundled locally; its source header contains upstream licensing notes.

## Python wheel and deployment

The demo targets **opencc_purepy 1.5.2**. For reproducible deployment, place the official wheel at:

```text
docs/wheels/opencc_purepy-1.5.2-py3-none-any.whl
```

The demo prefers this local wheel. If it is absent, it attempts to install `opencc-purepy==1.5.2` from PyPI. Use the
unmodified release wheel, not a wheel from an older version.

GitHub Pages serves the static `docs/` site. The included Pages workflow is manually triggered (`workflow_dispatch`);
enable Pages and run the deployment when ready.

## Custom dictionary implementation

The page creates a private `DictionaryMaxlength.from_json()` instance, applies entries with `with_custom_dicts()`,
creates a replacement `OpenCC` converter using the current configuration, and swaps it in only after successful
validation. Reset restores the default converter while retaining draft dictionary cards.

## Testing notes

The Pyodide 0.27.7 demo has successfully loaded the local `opencc_purepy` 1.5.2 wheel and converted an EPUB containing
73 text fragments in a desktop browser. The earlier minimal demo also completed a 1.2-million-character Chrome test.
These results do not establish compatibility across every browser, mobile device, or document format; test your own
files and deployment environment.
