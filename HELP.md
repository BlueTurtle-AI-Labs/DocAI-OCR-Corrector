# DocAI OCR Editor — Quick Reference

A browser tool for reviewing and cleaning up Google Document AI OCR output. Load a JSON file, remove bad bounding boxes, export the cleaned result.

## Open a file

- Drag and drop a JSON file anywhere on the page, **or**
- Click the drop zone / "Open File" button and pick a file

Each file covers a chunk of pages from a scanned document, with page images and OCR bounding boxes built in — no separate image files needed.

## Navigate pages

- **←** / **→** arrow keys, or the prev/next buttons, or the page dropdown

## Show/hide box types

Use the **Block / Paragraph / Line / Token** checkboxes in the top bar to control which granularity of boxes is drawn on the page. Toggle **Discarded** to hide/show boxes you've already removed.

## Select boxes

- **Click** a box to select just that one
- **Shift/Ctrl + Click** to add/remove a box from the current selection
- **Drag** to paint a circular brush across the page — every box the brush touches gets selected. Plain drag starts a new selection; hold Shift/Ctrl while dragging to add to the existing one
- Adjust the brush size with the vertical slider on the left edge of the screen
- **Esc** clears the selection

## Discard / restore

- **Delete** removes the selected boxes (they're marked, not gone — see "Discarded" below)
- **Ctrl+Z** undoes the last discard
- Click a discarded (dashed) box directly to restore it
- Or use the **Discarded** sidebar on the right: each removed item is listed with a **Restore** button, plus a **Restore All** button at the top

## Export

Click **Export JSON** in the top bar to download a cleaned copy of the file, with all discarded boxes removed and everything else in the original structure. The download is named `<original-filename>.cleaned.json`.

## Notes

- Loading a new file discards any unsaved edits in the current one (you'll get a confirmation prompt if you have pending discards).
- Nothing is uploaded anywhere — the file is read and edited entirely in your browser, and export happens as a local download.
