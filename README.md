# DocAI OCR Editor

A single-page HTML tool for reviewing and editing Google Document AI OCR output. No frameworks, no build step — just `index.html`, `styles.css`, and `app.js`.

Served via a local Python HTTP server during development (`python -m http.server`) and hosted on GitHub Pages in production. No `file://` compatibility is needed or targeted.

For a short usage guide (how to load a file, select/discard boxes, export), see [HELP.md](HELP.md). This file covers project/architecture context instead.

## Data format

Input is a folder of JSON files (e.g. `demo-0.json`, `demo-1.json`, ...) produced by Document AI's Document OCR processor. Each JSON file covers a 10-page chunk of a larger PDF and contains:

- `text` — the full document text for the chunk
- `pages[]` — one entry per page, each with:
  - `image.content` — the page image, base64-encoded (no separate image file needed)
  - `image.mimeType`
  - `blocks[]`, `paragraphs[]`, `lines[]`, `tokens[]` — bounding-box hierarchy, each entry with `layout.boundingPoly.normalizedVertices` (0–1 normalized coords) and `layout.textAnchor.textSegments` (start/end offsets into `text`)

A sample file lives at `ocr_results/demo-0.json`.

## Features implemented

- **Load** a JSON file via drag-drop anywhere on the window, the "Open File" button, or by clicking/Enter/Space on the empty-state drop zone (also opens the file picker; the zone is keyboard-accessible via `role="button" tabindex="0"`)
- **Page navigation** within a loaded chunk (prev/next buttons, dropdown, or Left/Right arrow keys)
- **SVG bounding box overlay** on the page image, normalized coords scaled to display size (viewBox `0 0 1 1`)
- **Granularity toggles** — Block / Paragraph / Line / Token visibility, each with a distinct color; Line and Token are on by default
- **Selection**
  - Click a box to select it; Shift/Ctrl/Cmd-click to multi-select
  - Drag anywhere on the page to paint a circular brush cursor across it — any box the brush touches is added to the selection live as you drag (plain drag starts a fresh selection; holding Shift/Ctrl/Cmd keeps the existing selection and adds to it). Brush radius defaults to 16px and is adjustable via the vertical slider fixed to the left edge of the screen (`brushRadius` in `app.js`, `#brushSizeSlider` in `index.html`)
  - `Esc` clears selection
- **Discard / undo**
  - `Delete` discards the current selection (pushes onto an undo stack)
  - `Ctrl+Z` undoes the last discard action
  - Discarded boxes render dashed/grey; a "Discarded" visibility toggle can hide them entirely
  - Clicking a discarded box restores it directly
- **Sidebar**
  - Lists discarded items grouped by page, tagged by granularity, with a text snippet (resolved via `textAnchor` offsets into `doc.text`)
  - Per-item "Restore" button and a "Restore All" button
  - Static shortcuts reference panel
- **Export** — downloads a cleaned JSON (same structure as input) with discarded nodes filtered out of each page's `blocks`/`paragraphs`/`lines`/`tokens` arrays. Filename: `<original-name>.cleaned.json`

## Architecture notes

- All state lives in a single `state` object in `app.js` (`doc`, `pageIndex`, `visible` per granularity, `discarded`, `undoStack`, `selected`).
- Discarded/selected items are tracked by synthetic string IDs: `"<pageIndex>:<granularity>:<arrayIndex>"` (see `makeId`/`parseId`).
- The undo stack stores arrays of IDs (one entry per discard action, which may batch multiple items from a multi-select or brush stroke).
- The brush stroke (`paintAt` in `app.js`) skips already-discarded boxes — it only adds to `state.selected`, never restores. Restoring a discarded box still requires clicking it directly (while not dragging) or using the sidebar's Restore/Restore All buttons.
- Export does a `structuredClone` of the loaded doc, then filters each page's granularity arrays by discarded IDs — it does not mutate the loaded document in place, so re-importing after export isn't needed to keep editing the original.
- No dependencies, no build step. Everything is vanilla JS/CSS/HTML.
- `styles.css` has a global `[hidden] { display: none !important; }` rule. Several elements (`.page-wrap`, `.tb-group`, ...) set their own `display` value, which — per the CSS cascade — silently overrides the browser's built-in `[hidden]` UA rule even at equal specificity, because author styles always beat UA styles. Without this override, toggling an element's `hidden` attribute/property from JS does nothing visually. Keep this in mind if a newly-`hidden` element still shows up.

## Known gaps / possible future work

- No persistence across file loads — loading a new file discards current edits (with a confirm prompt if anything was discarded).
- No multi-chunk (cross-file) workflow; each `demo-N.json` is reviewed independently.
- No zoom/pan on the page image beyond browser default scrolling.
- No text editing of OCR content — only structural discard/restore of boxes.
