'use strict';

const GRANULARITIES = ['block', 'paragraph', 'line', 'token'];
const PLURAL = { block: 'blocks', paragraph: 'paragraphs', line: 'lines', token: 'tokens' };

let brushRadius = 16; // px; adjustable via the brush-size slider

const state = {
  fileName: null,
  doc: null,
  pageIndex: 0,
  visible: { block: false, paragraph: false, line: true, token: true },
  showDiscarded: true,
  discarded: new Set(),   // ids: "pageIndex:gran:arrayIndex"
  undoStack: [],          // array of arrays of ids
  selected: new Set(),
};

// ---------- DOM refs ----------

const el = {
  openBtn: document.getElementById('openBtn'),
  fileInput: document.getElementById('fileInput'),
  fileName: document.getElementById('fileName'),
  pageNavGroup: document.getElementById('pageNavGroup'),
  prevPageBtn: document.getElementById('prevPageBtn'),
  nextPageBtn: document.getElementById('nextPageBtn'),
  pageSelect: document.getElementById('pageSelect'),
  granularityGroup: document.getElementById('granularityGroup'),
  showBlock: document.getElementById('showBlock'),
  showParagraph: document.getElementById('showParagraph'),
  showLine: document.getElementById('showLine'),
  showToken: document.getElementById('showToken'),
  showDiscarded: document.getElementById('showDiscarded'),
  exportGroup: document.getElementById('exportGroup'),
  statsLabel: document.getElementById('statsLabel'),
  exportBtn: document.getElementById('exportBtn'),
  emptyState: document.getElementById('emptyState'),
  pageWrap: document.getElementById('pageWrap'),
  pageImg: document.getElementById('pageImg'),
  pageSvg: document.getElementById('pageSvg'),
  brushCursor: document.getElementById('brushCursor'),
  brushSizeControl: document.getElementById('brushSizeControl'),
  brushSizeSlider: document.getElementById('brushSizeSlider'),
  brushSizeLabel: document.getElementById('brushSizeLabel'),
  restoreAllBtn: document.getElementById('restoreAllBtn'),
  discardedList: document.getElementById('discardedList'),
  toast: document.getElementById('toast'),
};

const CHECKBOX_BY_GRAN = {
  block: el.showBlock, paragraph: el.showParagraph, line: el.showLine, token: el.showToken,
};

// ---------- utilities ----------

function getNodeText(doc, node) {
  const segments = node.layout && node.layout.textAnchor && node.layout.textAnchor.textSegments;
  if (!segments || !segments.length) return '';
  return segments.map((seg) => {
    const start = seg.startIndex !== undefined ? parseInt(seg.startIndex, 10) : 0;
    const end = seg.endIndex !== undefined ? parseInt(seg.endIndex, 10) : start;
    return doc.text.substring(start, end);
  }).join('');
}

function nodeBBox(node) {
  const verts = node.layout && node.layout.boundingPoly && node.layout.boundingPoly.normalizedVertices;
  if (!verts || !verts.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const v of verts) {
    const x = v.x || 0, y = v.y || 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function makeId(pageIndex, gran, idx) {
  return `${pageIndex}:${gran}:${idx}`;
}

function parseId(id) {
  const [pageIndex, gran, idx] = id.split(':');
  return { pageIndex: parseInt(pageIndex, 10), gran, idx: parseInt(idx, 10) };
}

function showToast(msg, isError) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  el.toast.classList.toggle('error', !!isError);
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { el.toast.hidden = true; }, 3000);
}

// ---------- file loading ----------

el.openBtn.addEventListener('click', () => el.fileInput.click());
el.fileInput.addEventListener('change', () => {
  if (el.fileInput.files.length) loadFile(el.fileInput.files[0]);
  el.fileInput.value = '';
});

el.emptyState.addEventListener('click', () => el.fileInput.click());
el.emptyState.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    el.fileInput.click();
  }
});

['dragenter', 'dragover'].forEach((evt) => {
  window.addEventListener(evt, (e) => {
    e.preventDefault();
    document.body.classList.add('drag-active');
  });
});
['dragleave', 'drop'].forEach((evt) => {
  window.addEventListener(evt, (e) => {
    if (evt === 'dragleave' && e.relatedTarget) return;
    document.body.classList.remove('drag-active');
  });
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) loadFile(file);
});

function loadFile(file) {
  if (state.discarded.size > 0) {
    const ok = confirm('Loading a new file will discard your current edits. Continue?');
    if (!ok) return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try {
      parsed = JSON.parse(reader.result);
    } catch (err) {
      showToast('Invalid JSON file: ' + err.message, true);
      return;
    }
    if (!parsed || !Array.isArray(parsed.pages)) {
      showToast('This does not look like a Document AI OCR JSON file (missing "pages" array).', true);
      return;
    }
    if (typeof parsed.text !== 'string') parsed.text = '';

    state.doc = parsed;
    state.fileName = file.name;
    state.pageIndex = 0;
    state.discarded = new Set();
    state.undoStack = [];
    state.selected = new Set();

    el.fileName.textContent = file.name;
    el.pageNavGroup.hidden = false;
    el.granularityGroup.hidden = false;
    el.exportGroup.hidden = false;
    el.brushSizeControl.hidden = false;
    el.emptyState.hidden = true;
    el.pageWrap.hidden = false;

    buildPageSelect();
    renderDiscardedList();
    renderPage();
    showToast(`Loaded ${file.name} — ${parsed.pages.length} page(s)`);
  };
  reader.onerror = () => showToast('Failed to read file.', true);
  reader.readAsText(file);
}

function buildPageSelect() {
  el.pageSelect.innerHTML = '';
  state.doc.pages.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `Page ${p.pageNumber !== undefined ? p.pageNumber : i + 1} of ${state.doc.pages.length}`;
    el.pageSelect.appendChild(opt);
  });
  el.pageSelect.value = state.pageIndex;
}

// ---------- page navigation ----------

el.prevPageBtn.addEventListener('click', () => goToPage(state.pageIndex - 1));
el.nextPageBtn.addEventListener('click', () => goToPage(state.pageIndex + 1));
el.pageSelect.addEventListener('change', () => goToPage(parseInt(el.pageSelect.value, 10)));

function goToPage(idx) {
  if (!state.doc) return;
  if (idx < 0 || idx >= state.doc.pages.length) return;
  state.pageIndex = idx;
  state.selected = new Set();
  el.pageSelect.value = idx;
  renderPage();
}

// ---------- granularity / discarded toggles ----------

GRANULARITIES.forEach((gran) => {
  CHECKBOX_BY_GRAN[gran].addEventListener('change', () => {
    state.visible[gran] = CHECKBOX_BY_GRAN[gran].checked;
    if (!state.visible[gran]) {
      for (const id of Array.from(state.selected)) {
        if (parseId(id).gran === gran) state.selected.delete(id);
      }
    }
    renderPage();
  });
  state.visible[gran] = CHECKBOX_BY_GRAN[gran].checked;
});

el.showDiscarded.addEventListener('change', () => {
  state.showDiscarded = el.showDiscarded.checked;
  renderPage();
});
state.showDiscarded = el.showDiscarded.checked;

// ---------- rendering ----------

function renderPage() {
  if (!state.doc) return;
  const page = state.doc.pages[state.pageIndex];
  if (!page) return;

  const img = page.image || {};
  if (img.content && img.mimeType) {
    el.pageImg.src = `data:${img.mimeType};base64,${img.content}`;
  } else {
    el.pageImg.removeAttribute('src');
  }

  el.pageSvg.innerHTML = '';

  GRANULARITIES.forEach((gran) => {
    if (!state.visible[gran]) return;
    const arr = page[PLURAL[gran]] || [];
    arr.forEach((node, idx) => {
      const id = makeId(state.pageIndex, gran, idx);
      const isDiscarded = state.discarded.has(id);
      if (isDiscarded && !state.showDiscarded) return;

      const verts = node.layout && node.layout.boundingPoly && node.layout.boundingPoly.normalizedVertices;
      if (!verts || !verts.length) return;

      const points = verts.map((v) => `${v.x || 0},${v.y || 0}`).join(' ');
      const bbox = nodeBBox(node);

      const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      poly.setAttribute('points', points);
      poly.classList.add('box', `gran-${gran}`);
      poly.dataset.id = id;
      if (bbox) {
        poly.dataset.minx = bbox.minX;
        poly.dataset.miny = bbox.minY;
        poly.dataset.maxx = bbox.maxX;
        poly.dataset.maxy = bbox.maxY;
      }
      if (isDiscarded) {
        poly.classList.add('discarded-box');
      } else if (state.selected.has(id)) {
        poly.classList.add('selected');
      }
      el.pageSvg.appendChild(poly);
    });
  });

  updateStatsLabel();
}

function updateStatsLabel() {
  const page = state.doc.pages[state.pageIndex];
  const counts = GRANULARITIES.map((g) => `${(page[PLURAL[g]] || []).length} ${g}${(page[PLURAL[g]] || []).length === 1 ? '' : 's'}`).join(' · ');
  el.statsLabel.textContent = `${counts}  |  ${state.discarded.size} discarded total  |  ${state.selected.size} selected`;
}

// ---------- selection: click ----------

el.pageSvg.addEventListener('click', (e) => {
  if (dragInfo.didDrag) { dragInfo.didDrag = false; return; }
  const poly = e.target.closest('polygon');
  if (!poly) {
    if (!e.shiftKey && !e.ctrlKey && !e.metaKey) clearSelection();
    return;
  }
  const id = poly.dataset.id;
  if (state.discarded.has(id)) {
    restoreIds([id]);
    showToast('Restored 1 item');
    return;
  }
  const multi = e.shiftKey || e.ctrlKey || e.metaKey;
  if (multi) {
    if (state.selected.has(id)) state.selected.delete(id);
    else state.selected.add(id);
  } else {
    state.selected = new Set([id]);
  }
  refreshSelectionClasses();
});

function clearSelection() {
  if (state.selected.size === 0) return;
  state.selected = new Set();
  refreshSelectionClasses();
}

function refreshSelectionClasses() {
  el.pageSvg.querySelectorAll('polygon.box').forEach((poly) => {
    const id = poly.dataset.id;
    poly.classList.toggle('selected', state.selected.has(id) && !state.discarded.has(id));
  });
  updateStatsLabel();
}

// ---------- brush size ----------

function setBrushRadius(r) {
  brushRadius = r;
  el.brushCursor.style.width = `${r * 2}px`;
  el.brushCursor.style.height = `${r * 2}px`;
  el.brushCursor.style.marginLeft = `${-r}px`;
  el.brushCursor.style.marginTop = `${-r}px`;
  el.brushSizeLabel.textContent = `${r}px`;
}

el.brushSizeSlider.addEventListener('input', () => {
  setBrushRadius(parseInt(el.brushSizeSlider.value, 10));
});
setBrushRadius(parseInt(el.brushSizeSlider.value, 10));

// ---------- brush cursor (hover follow) ----------

el.pageWrap.addEventListener('mouseenter', () => {
  if (state.doc) el.brushCursor.hidden = false;
});
el.pageWrap.addEventListener('mouseleave', () => {
  el.brushCursor.hidden = true;
});
el.pageWrap.addEventListener('mousemove', (e) => {
  if (!state.doc) return;
  const rect = el.pageWrap.getBoundingClientRect();
  el.brushCursor.style.left = `${e.clientX - rect.left}px`;
  el.brushCursor.style.top = `${e.clientY - rect.top}px`;
});

// ---------- selection: brush drag ----------
// Dragging paints a circular brush across the page; any box the brush
// touches gets added to the selection (a plain click still selects just
// one box, handled separately by the 'click' listener above).

const dragInfo = { active: false, startX: 0, startY: 0, wrapRect: null, didDrag: false, additive: false };

el.pageSvg.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  dragInfo.active = true;
  dragInfo.didDrag = false;
  dragInfo.wrapRect = el.pageWrap.getBoundingClientRect();
  dragInfo.startX = e.clientX;
  dragInfo.startY = e.clientY;
  dragInfo.additive = e.shiftKey || e.ctrlKey || e.metaKey;
});

window.addEventListener('mousemove', (e) => {
  if (!dragInfo.active) return;
  const dx = e.clientX - dragInfo.startX;
  const dy = e.clientY - dragInfo.startY;
  if (!dragInfo.didDrag) {
    if (Math.hypot(dx, dy) < 4) return;
    dragInfo.didDrag = true;
    if (!dragInfo.additive) state.selected = new Set();
    el.brushCursor.classList.add('brushing');
  }
  paintAt(e.clientX, e.clientY);
});

window.addEventListener('mouseup', () => {
  if (!dragInfo.active) return;
  dragInfo.active = false;
  el.brushCursor.classList.remove('brushing');

  if (!dragInfo.didDrag) return;
  refreshSelectionClasses();

  // If the drag ended outside pageSvg, no 'click' event will fire there to
  // consume didDrag, so clear it on the next tick to avoid swallowing a
  // later, unrelated click.
  setTimeout(() => { dragInfo.didDrag = false; }, 0);
});

function paintAt(clientX, clientY) {
  const rect = dragInfo.wrapRect;
  const cx = clientX - rect.left;
  const cy = clientY - rect.top;
  let changed = false;

  el.pageSvg.querySelectorAll('polygon.box').forEach((poly) => {
    if (poly.classList.contains('discarded-box')) return;
    const id = poly.dataset.id;
    if (state.selected.has(id)) return;

    const minx = parseFloat(poly.dataset.minx) * rect.width;
    const miny = parseFloat(poly.dataset.miny) * rect.height;
    const maxx = parseFloat(poly.dataset.maxx) * rect.width;
    const maxy = parseFloat(poly.dataset.maxy) * rect.height;
    const nearestX = Math.max(minx, Math.min(cx, maxx));
    const nearestY = Math.max(miny, Math.min(cy, maxy));
    const dist = Math.hypot(cx - nearestX, cy - nearestY);

    if (dist <= brushRadius) {
      state.selected.add(id);
      poly.classList.add('selected');
      changed = true;
    }
  });

  if (changed) updateStatsLabel();
}

// ---------- discard / undo / restore ----------

function discardSelected() {
  if (state.selected.size === 0) return;
  const ids = Array.from(state.selected);
  ids.forEach((id) => state.discarded.add(id));
  state.undoStack.push(ids);
  state.selected = new Set();
  renderPage();
  renderDiscardedList();
  showToast(`Discarded ${ids.length} item${ids.length === 1 ? '' : 's'}`);
}

function undoLastDiscard() {
  if (state.undoStack.length === 0) return;
  const ids = state.undoStack.pop();
  ids.forEach((id) => state.discarded.delete(id));
  renderPage();
  renderDiscardedList();
  showToast(`Undid discard of ${ids.length} item${ids.length === 1 ? '' : 's'}`);
}

function restoreIds(ids) {
  ids.forEach((id) => state.discarded.delete(id));
  state.undoStack = state.undoStack
    .map((action) => action.filter((id) => !ids.includes(id)))
    .filter((action) => action.length > 0);
  renderPage();
  renderDiscardedList();
}

function restoreAll() {
  if (state.discarded.size === 0) return;
  const count = state.discarded.size;
  state.discarded = new Set();
  state.undoStack = [];
  renderPage();
  renderDiscardedList();
  showToast(`Restored ${count} item${count === 1 ? '' : 's'}`);
}

el.restoreAllBtn.addEventListener('click', restoreAll);

// ---------- keyboard shortcuts ----------

window.addEventListener('keydown', (e) => {
  if (!state.doc) return;
  const tag = document.activeElement && document.activeElement.tagName;
  const inField = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';

  if (e.key === 'Delete' && !inField) {
    e.preventDefault();
    discardSelected();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !inField) {
    e.preventDefault();
    undoLastDiscard();
  } else if (e.key === 'Escape' && !inField) {
    clearSelection();
  } else if (e.key === 'ArrowLeft' && !inField) {
    e.preventDefault();
    goToPage(state.pageIndex - 1);
  } else if (e.key === 'ArrowRight' && !inField) {
    e.preventDefault();
    goToPage(state.pageIndex + 1);
  }
});

// ---------- sidebar: discarded list ----------

function renderDiscardedList() {
  el.restoreAllBtn.disabled = state.discarded.size === 0;

  if (state.discarded.size === 0) {
    el.discardedList.innerHTML = '<p class="empty-hint">Nothing discarded yet.</p>';
    return;
  }

  const byPage = new Map();
  for (const id of state.discarded) {
    const { pageIndex } = parseId(id);
    if (!byPage.has(pageIndex)) byPage.set(pageIndex, []);
    byPage.get(pageIndex).push(id);
  }

  const order = { block: 0, paragraph: 1, line: 2, token: 3 };
  const frag = document.createDocumentFragment();

  Array.from(byPage.keys()).sort((a, b) => a - b).forEach((pageIndex) => {
    const label = document.createElement('div');
    label.className = 'page-group-label';
    const pageNum = state.doc.pages[pageIndex] && state.doc.pages[pageIndex].pageNumber !== undefined
      ? state.doc.pages[pageIndex].pageNumber : pageIndex + 1;
    label.textContent = `Page ${pageNum}`;
    frag.appendChild(label);

    const ids = byPage.get(pageIndex).sort((a, b) => {
      const pa = parseId(a), pb = parseId(b);
      if (order[pa.gran] !== order[pb.gran]) return order[pa.gran] - order[pb.gran];
      return pa.idx - pb.idx;
    });

    ids.forEach((id) => {
      const { gran, idx } = parseId(id);
      const node = state.doc.pages[pageIndex][PLURAL[gran]][idx];
      const text = getNodeText(state.doc, node).trim() || '(no text)';

      const row = document.createElement('div');
      row.className = 'discarded-item';

      const tag = document.createElement('span');
      tag.className = `tag tag-${gran}`;
      tag.textContent = gran;

      const snippet = document.createElement('span');
      snippet.className = 'snippet';
      snippet.textContent = text;
      snippet.title = text;

      const restoreBtn = document.createElement('button');
      restoreBtn.className = 'restore-btn';
      restoreBtn.textContent = 'Restore';
      restoreBtn.addEventListener('click', () => {
        restoreIds([id]);
        showToast('Restored 1 item');
      });

      row.appendChild(tag);
      row.appendChild(snippet);
      row.appendChild(restoreBtn);
      frag.appendChild(row);
    });
  });

  el.discardedList.innerHTML = '';
  el.discardedList.appendChild(frag);
}

// ---------- export ----------

el.exportBtn.addEventListener('click', exportCleanedJson);

function exportCleanedJson() {
  if (!state.doc) return;
  const cleaned = structuredClone(state.doc);

  cleaned.pages.forEach((page, pageIndex) => {
    GRANULARITIES.forEach((gran) => {
      const key = PLURAL[gran];
      if (!Array.isArray(page[key])) return;
      page[key] = page[key].filter((_, idx) => !state.discarded.has(makeId(pageIndex, gran, idx)));
    });
  });

  const blob = new Blob([JSON.stringify(cleaned)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const base = (state.fileName || 'document.json').replace(/\.json$/i, '');
  const a = document.createElement('a');
  a.href = url;
  a.download = `${base}.cleaned.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast(`Exported ${base}.cleaned.json`);
}
