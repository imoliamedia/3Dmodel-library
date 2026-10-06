import { detectLang, setLang, getLang, t } from './i18n.js';
import {
  getAllModels, getFile, getThumb, updateModel, deleteModel, storageInfo, requestPersist,
} from './db.js';
import { importFiles, filesFromDrop } from './import.js';
import { ThumbQueue, THUMB_VERSION } from './thumbs.js';
import { Viewer } from './viewer.js';
import { exportBackup, importBackup, lastBackup } from './backup.js';

const $ = (id) => document.getElementById(id);
const DAY = 86_400_000;

const state = {
  models: [],
  filter: 'all',
  tag: '',
  search: '',
  sort: 'added',
  thumbUrls: new Map(),
  viewerIds: [],
  viewerIndex: 0,
  cleanup: false,
};

let viewer = null; // created lazily: WebGL is only needed once a model is opened
let observer = null;

/* ---------- helpers ---------- */

const stemOf = (name) => name.replace(/\.[^.]+$/, '');
const displayTitle = (m) => m.title || stemOf(m.name);
const formatBytes = (n) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
};
const formatDims = (d) => (d ? `${d.w.toFixed(1)} × ${d.d.toFixed(1)} × ${d.h.toFixed(1)} mm` : '-');
const parseTags = (s) => [...new Set(s.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean))];
const byId = (id) => state.models.find((m) => m.id === id);

let toastTimer;
function toast(msg, ms = 3500) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

async function thumbUrl(id) {
  if (state.thumbUrls.has(id)) return state.thumbUrls.get(id);
  const blob = await getThumb(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  state.thumbUrls.set(id, url);
  return url;
}

function dropThumbUrl(id) {
  const url = state.thumbUrls.get(id);
  if (url) URL.revokeObjectURL(url);
  state.thumbUrls.delete(id);
}

/* ---------- thumbnails queue ---------- */

const queue = new ThumbQueue({
  onProgress(done, total) {
    $('progress').hidden = total === 0;
    $('progress-fill').style.width = total ? `${(done / total) * 100}%` : '0';
    $('progress-text').textContent = t('thumbs.progress', { done, total });
  },
  onDone(updated) {
    const i = state.models.findIndex((m) => m.id === updated.id);
    if (i >= 0) state.models[i] = updated;
    dropThumbUrl(updated.id);
    const old = document.querySelector(`.card[data-id="${updated.id}"]`);
    if (old) old.replaceWith(buildCard(updated));
  },
});

function queueMissingThumbs() {
  // also redo previews made by an older version of the app (old thumbnails stay visible meanwhile)
  queue.add(state.models.filter((m) => (!m.hasThumb && !m.thumbFailed) || m.thumbV !== THUMB_VERSION));
}

async function rebuildThumbs() {
  state.models = state.models.map((m) => ({ ...m, thumbV: 0 }));
  await Promise.all(state.models.map((m) => updateModel(m)));
  $('settings-dialog').close();
  queueMissingThumbs();
}

/* ---------- grid ---------- */

function visibleModels() {
  const q = state.search.trim().toLowerCase();
  let list = state.models.filter((m) => {
    if (state.filter === 'fav' && !m.fav) return false;
    if (state.filter === 'unnamed' && m.title) return false;
    if (state.tag && !m.tags.includes(state.tag)) return false;
    if (q) {
      const hay = `${m.title} ${m.name} ${m.tags.join(' ')} ${m.note}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const sorters = {
    added: (a, b) => b.added - a.added,
    name: (a, b) => displayTitle(a).localeCompare(displayTitle(b), undefined, { numeric: true, sensitivity: 'base' }),
    size: (a, b) => b.size - a.size,
  };
  list = list.sort(sorters[state.sort]);
  return list;
}

function buildCard(m) {
  const card = document.createElement('button');
  card.className = 'card';
  card.type = 'button';
  card.dataset.id = m.id;

  const thumb = document.createElement('div');
  thumb.className = 'thumb';
  if (m.hasThumb) {
    thumbUrl(m.id).then((url) => {
      if (!url) return;
      const img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.src = url;
      thumb.replaceChildren(img);
    });
  } else {
    thumb.textContent = m.thumbFailed ? t('card.thumbfail') : t('card.nothumb');
    if (!m.thumbFailed) observer?.observe(card);
  }

  const ext = document.createElement('span');
  ext.className = 'badge-ext';
  ext.textContent = m.ext.toUpperCase();

  const info = document.createElement('div');
  info.className = 'card-info';
  const title = document.createElement('div');
  title.className = `card-title${m.title ? '' : ' unnamed'}`;
  title.textContent = displayTitle(m);
  const sub = document.createElement('div');
  sub.className = 'card-sub';
  sub.textContent = [m.dims ? `${Math.round(m.dims.h)} mm` : '', formatBytes(m.size), ...m.tags.slice(0, 2)].filter(Boolean).join(' · ');
  info.append(title, sub);

  card.append(thumb, ext);
  if (m.fav) {
    const star = document.createElement('span');
    star.className = 'badge-fav';
    star.textContent = '★';
    card.append(star);
  }
  card.append(info);
  card.addEventListener('click', () => openViewer(m.id, visibleModels().map((x) => x.id), false));
  return card;
}

function renderTagFilter() {
  const counts = new Map();
  state.models.forEach((m) => m.tags.forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1)));
  const sel = $('tag-filter');
  sel.replaceChildren(new Option(t('filter.alltags'), ''));
  [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([tag, n]) => sel.add(new Option(`${tag} (${n})`, tag)));
  if (state.tag && !counts.has(state.tag)) state.tag = '';
  sel.value = state.tag;
  sel.hidden = counts.size === 0;

  const list = $('tag-list');
  list.replaceChildren(...[...counts.keys()].map((tag) => Object.assign(document.createElement('option'), { value: tag })));
}

function render() {
  const list = visibleModels();
  const grid = $('grid');
  const empty = state.models.length === 0;
  $('empty').hidden = !empty;
  $('no-results').hidden = empty || list.length > 0;
  document.querySelector('.toolbar').hidden = empty;
  grid.replaceChildren(...list.map(buildCard));
  renderTagFilter();
}

/* ---------- importing ---------- */

async function handleFiles(files) {
  if (!files.length) return;
  $('add-dialog').close();
  const res = await importFiles(files, state.models, (done, total) => {
    $('progress').hidden = false;
    $('progress-fill').style.width = `${(done / total) * 100}%`;
    $('progress-text').textContent = t('import.progress', { done, total });
  });
  $('progress').hidden = true;
  if (!res.added.length && !res.updated.length && !res.dupes) return toast(t('import.nofiles'));
  state.models.push(...res.added);
  for (const u of res.updated) {
    state.models[state.models.findIndex((m) => m.id === u.id)] = u;
    dropThumbUrl(u.id);
  }
  render();
  toast(t('import.done', { added: res.added.length, dupes: res.dupes, skipped: res.skipped }));
  queueMissingThumbs();
  if (res.added.length) requestPersist();
  if (res.updated.length) toast(t('import.colors', { n: res.updated.length }));
}

/* ---------- viewer ---------- */

const fields = {
  title: () => $('d-title'), tags: () => $('d-tags'), note: () => $('d-note'),
};

const currentMeta = () => byId(state.viewerIds[state.viewerIndex]);

function isDirty(m) {
  return fields.title().value.trim() !== m.title
    || parseTags(fields.tags().value).join(',') !== m.tags.join(',')
    || fields.note().value !== m.note;
}

async function saveCurrent({ quiet = false } = {}) {
  const m = currentMeta();
  if (!m) return;
  const next = {
    ...m,
    title: fields.title().value.trim(),
    tags: parseTags(fields.tags().value),
    note: fields.note().value,
  };
  await updateModel(next);
  state.models[state.models.findIndex((x) => x.id === m.id)] = next;
  render();
  renderSuggestions();
  if (!quiet) toast(t('detail.saved'), 1500);
}

function renderSuggestions() {
  const m = currentMeta();
  const used = new Set(parseTags(fields.tags().value));
  const counts = new Map();
  state.models.forEach((x) => x.tags.forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1)));
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag).filter((tag) => !used.has(tag)).slice(0, 10);
  $('d-tag-suggest').replaceChildren(...top.map((tag) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = `+ ${tag}`;
    b.addEventListener('click', () => {
      const cur = parseTags(fields.tags().value);
      fields.tags().value = [...cur, tag].join(', ');
      renderSuggestions();
    });
    return b;
  }));
  return m;
}

async function loadCurrent() {
  const m = currentMeta();
  if (!m) return closeViewer();
  fields.title().value = m.title;
  fields.title().placeholder = stemOf(m.name);
  fields.tags().value = m.tags.join(', ');
  fields.note().value = m.note;
  $('d-file').textContent = m.name;
  $('d-dims').textContent = formatDims(m.dims);
  $('d-size').textContent = formatBytes(m.size);
  $('d-added').textContent = new Date(m.added).toLocaleDateString(getLang());
  $('d-fav').textContent = m.fav ? t('detail.faved') : t('detail.fav');
  $('d-fav').classList.toggle('on', m.fav);
  $('v-count').textContent = `${state.viewerIndex + 1} / ${state.viewerIds.length}`;
  $('v-prev').hidden = $('v-next').hidden = state.viewerIds.length < 2;
  renderSuggestions();

  const status = $('v-status');
  status.textContent = t('viewer.loading');
  status.hidden = false;
  try {
    const dims = await viewer.show(m);
    if (dims === null) return; // a newer model was requested meanwhile
    status.hidden = true;
    if (!m.dims) {
      const next = { ...currentMeta(), dims };
      await updateModel(next);
      state.models[state.models.findIndex((x) => x.id === m.id)] = next;
      $('d-dims').textContent = formatDims(dims);
    }
  } catch (err) {
    console.warn(err);
    status.textContent = t('viewer.error');
  }
}

async function openViewer(id, ids, cleanup) {
  state.viewerIds = ids;
  state.viewerIndex = Math.max(0, ids.indexOf(id));
  state.cleanup = cleanup;
  if (!viewer) viewer = new Viewer($('viewer-canvas'));
  $('viewer').hidden = false;
  document.body.style.overflow = 'hidden';
  viewer.start();
  history.pushState({ viewer: true }, '');
  $('v-wire').classList.toggle('on', viewer.wireframe);
  await loadCurrent();
}

async function closeViewer({ fromPop = false } = {}) {
  if ($('viewer').hidden) return;
  const m = currentMeta();
  if (m && isDirty(m)) await saveCurrent({ quiet: true });
  $('viewer').hidden = true;
  document.body.style.overflow = '';
  viewer.stop();
  if (!fromPop && history.state?.viewer) history.back();
}

async function step(delta) {
  const n = state.viewerIds.length;
  if (n < 2) return;
  const m = currentMeta();
  if (m && isDirty(m)) await saveCurrent({ quiet: true });
  state.viewerIndex = (state.viewerIndex + delta + n) % n;
  await loadCurrent();
}

async function toggleFav() {
  const m = currentMeta();
  const next = { ...m, fav: !m.fav };
  await updateModel(next);
  state.models[state.models.findIndex((x) => x.id === m.id)] = next;
  $('d-fav').textContent = next.fav ? t('detail.faved') : t('detail.fav');
  $('d-fav').classList.toggle('on', next.fav);
  render();
}

async function deleteCurrent() {
  const m = currentMeta();
  if (!m || !confirm(t('detail.confirmdelete', { name: displayTitle(m) }))) return;
  await deleteModel(m.id);
  dropThumbUrl(m.id);
  state.models = state.models.filter((x) => x.id !== m.id);
  state.viewerIds.splice(state.viewerIndex, 1);
  render();
  if (!state.viewerIds.length) return closeViewer();
  state.viewerIndex = Math.min(state.viewerIndex, state.viewerIds.length - 1);
  await loadCurrent();
}

async function downloadCurrent() {
  const m = currentMeta();
  const blob = await getFile(m.id);
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: m.name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function startCleanup() {
  const ids = state.models.filter((m) => !m.title).sort((a, b) => b.added - a.added).map((m) => m.id);
  if (!ids.length) return toast(t('cleanup.none'));
  openViewer(ids[0], ids, true);
}

/* ---------- settings ---------- */

async function openSettings() {
  $('set-lang').value = getLang();
  $('set-theme').value = localStorage.getItem('ml.theme') || 'auto';
  const lb = lastBackup();
  $('set-last-backup').textContent = lb
    ? t('settings.lastbackup', { date: new Date(lb).toLocaleDateString(getLang()) })
    : t('settings.nobackup');
  const info = await storageInfo();
  $('set-storage').textContent = t('settings.storage.info', {
    used: formatBytes(info.used),
    quota: formatBytes(info.quota),
    persist: info.persisted ? t('settings.storage.persist') : t('settings.storage.nopersist'),
  });
  $('settings-dialog').showModal();
}

function applyTheme(mode) {
  if (mode === 'light' || mode === 'dark') document.documentElement.dataset.theme = mode;
  else delete document.documentElement.dataset.theme;
}

async function doExport(files) {
  toast(t('backup.working'), 60_000);
  try {
    await exportBackup({ files });
    toast(t('backup.done'));
    openSettings();
  } catch (err) {
    console.error(err);
    toast(String(err.message || err));
  }
}

async function doImportBackup(file) {
  try {
    const res = await importBackup(file);
    state.models = await getAllModels();
    render();
    queueMissingThumbs();
    toast(t('backup.importdone', res));
  } catch (err) {
    console.error(err);
    toast(t('backup.importfail'));
  }
}

/* ---------- wiring ---------- */

function wire() {
  $('btn-add').addEventListener('click', () => $('add-dialog').showModal());
  $('btn-add-empty').addEventListener('click', () => $('add-dialog').showModal());
  $('add-close').addEventListener('click', () => $('add-dialog').close());
  $('add-files').addEventListener('click', () => $('file-input').click());
  $('add-folder').addEventListener('click', () => $('folder-input').click());
  for (const id of ['file-input', 'folder-input']) {
    $(id).addEventListener('change', (e) => { handleFiles([...e.target.files]); e.target.value = ''; });
  }

  $('search').addEventListener('input', (e) => { state.search = e.target.value; render(); });
  $('sort').addEventListener('change', (e) => { state.sort = e.target.value; render(); });
  $('tag-filter').addEventListener('change', (e) => { state.tag = e.target.value; render(); });
  $('chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.filter = chip.dataset.filter;
    document.querySelectorAll('#chips .chip').forEach((c) => c.classList.toggle('active', c === chip));
    render();
  });
  $('btn-cleanup').addEventListener('click', startCleanup);

  $('v-close').addEventListener('click', () => closeViewer());
  $('v-prev').addEventListener('click', () => step(-1));
  $('v-next').addEventListener('click', () => step(1));
  $('v-reset').addEventListener('click', () => viewer.resetView());
  $('v-wire').addEventListener('click', (e) => {
    viewer.setWireframe(!viewer.wireframe);
    e.currentTarget.classList.toggle('on', viewer.wireframe);
  });
  $('d-save').addEventListener('click', () => saveCurrent());
  $('d-fav').addEventListener('click', toggleFav);
  $('d-delete').addEventListener('click', deleteCurrent);
  $('d-download').addEventListener('click', downloadCurrent);
  fields.tags().addEventListener('input', renderSuggestions);
  fields.title().addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    await saveCurrent();
    if (state.cleanup) await step(1);
  });

  window.addEventListener('popstate', () => closeViewer({ fromPop: true }));
  window.addEventListener('keydown', (e) => {
    if ($('viewer').hidden) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    if (e.key === 'Escape') closeViewer();
    else if (!typing && e.key === 'ArrowLeft') step(-1);
    else if (!typing && e.key === 'ArrowRight') step(1);
  });

  $('btn-settings').addEventListener('click', openSettings);
  $('settings-close').addEventListener('click', () => $('settings-dialog').close());
  $('set-lang').addEventListener('change', async (e) => { await setLang(e.target.value); render(); openSettings(); });
  $('set-theme').addEventListener('change', (e) => {
    localStorage.setItem('ml.theme', e.target.value);
    applyTheme(e.target.value);
  });
  $('set-rebuild').addEventListener('click', rebuildThumbs);
  $('set-export-full').addEventListener('click', () => doExport(true));
  $('set-export-meta').addEventListener('click', () => doExport(false));
  $('set-import').addEventListener('click', () => $('import-input').click());
  $('import-input').addEventListener('change', (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) doImportBackup(f);
  });

  // drag and drop (files and folders)
  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragDepth++; $('dropzone').hidden = false; } });
  window.addEventListener('dragleave', (e) => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; $('dropzone').hidden = true; } });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    $('dropzone').hidden = true;
    handleFiles(await filesFromDrop(e.dataTransfer));
  });
}

async function init() {
  try { applyTheme(localStorage.getItem('ml.theme') || 'auto'); } catch {}
  await setLang(detectLang());

  observer = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      queue.prioritise(en.target.dataset.id);
      observer.unobserve(en.target);
    }
  }, { rootMargin: '200px' });

  wire();
  state.models = await getAllModels();
  render();
  queueMissingThumbs();

  const oldest = state.models.reduce((min, m) => Math.min(min, m.added), Date.now());
  const reference = lastBackup() || oldest;
  if (state.models.length >= 5 && Date.now() - reference > 30 * DAY) toast(t('backup.reminder'), 6000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker failed', err));
  }
}

init();
