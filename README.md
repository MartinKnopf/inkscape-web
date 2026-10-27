# Inkscape Web

A vector drawing web app that matches [Inkscape](https://inkscape.org) as
closely as the browser allows. It is a TypeScript port that follows upstream
Inkscape `master`. See [docs/PLAN.md](docs/PLAN.md).

## Setup

Needs Node 22+, pnpm, Emscripten (version in `packages/wasm/emscripten-version`),
Boost headers, and an upstream checkout next to this repository:

```sh
git clone https://gitlab.com/inkscape/inkscape.git ../inkscape
git -C ../inkscape checkout $(jq -r .commit upstream/sync.json)
git -C ../inkscape submodule update --init src/3rdparty/2geom share/extensions po
# macOS: brew install emscripten boost

pnpm install
pnpm build:wasm     # upstream lib2geom + livarot → packages/wasm/dist
pnpm build:assets   # upstream share/ + translations → packages/assets/dist
pnpm dev
```

Use `INKSCAPE_SRC` for another upstream location.

## Deployment

Vercel builds `apps/web` (see `apps/web/vercel.json`). The build makes a
shallow upstream checkout with `upstream/scripts/checkout.sh` and builds the
assets. Add the WASM build when the app starts to use it.

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Start the web app |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm typecheck` / `pnpm lint` | TypeScript / Biome |
| `pnpm upstream:diff` | Upstream commits since `upstream/sync.json` that touch ported code |
| `pnpm upstream:inventory --write` | Update the parity dashboard `docs/PARITY.md` |

## Layout

| Folder | Content |
|---|---|
| `packages/geom` | TS port of the lib2geom parts used in hot paths |
| `packages/core` | Headless document core (XML, objects, style, undo, i18n). No DOM. |
| `packages/editor` | Desktop, canvas, display tree, tools, actions. DOM, no React. |
| `packages/wasm` | Upstream C++ compiled to WebAssembly |
| `packages/assets` | Upstream runtime data (icons, palettes, translations, ...) |
| `apps/web` | React UI |
| `upstream` | Sync state and scripts |
| `spikes` | Prototypes from the planning phase (not part of the build) |

## License

Source code: GPL-2.0-or-later, the same as upstream Inkscape. Ported code keeps
the copyright of the Inkscape authors. The built application is GPL-3.0-or-later
because it links GSL, as upstream Inkscape binaries do. Details: [COPYING](COPYING).
