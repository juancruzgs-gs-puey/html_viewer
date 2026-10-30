'use strict';

// ---------- Almacenamiento (IndexedDB) ----------

const DB_NAME = 'visor-html';
const STORE = 'files';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      store.createIndex('name', 'name');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
    t.onerror = () => reject(t.error);
  });
}

const getAll = () => tx('readonly', s => s.getAll());
const getOne = id => tx('readonly', s => s.get(id));
const remove = id => tx('readwrite', s => s.delete(id));

async function save(name, html) {
  const existing = (await getAll()).find(f => f.name === name);
  const record = { name, html, date: Date.now() };
  if (existing) record.id = existing.id;
  return tx('readwrite', s => s.put(record));
}

// ---------- Archivos relacionados (imágenes, CSS, JS) ----------

const isHtml = f => /\.html?$/i.test(f.name) || f.type === 'text/html';
const isCss = f => /\.css$/i.test(f.name) || f.type === 'text/css';
const isJs = f => /\.m?js$/i.test(f.name) || /javascript/.test(f.type);

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

// Busca un archivo seleccionado por el nombre final de la ruta ("img/foto.png" -> "foto.png").
function makeLookup(assets) {
  return ref => {
    if (!ref || /^(data:|blob:|https?:|mailto:|tel:|javascript:|#)/i.test(ref.trim())) return null;
    let base = ref.trim().split(/[?#]/)[0].split('/').pop();
    try { base = decodeURIComponent(base); } catch (_) { /* nombre tal cual */ }
    return assets.get(base.toLowerCase()) || null;
  };
}

function rewriteCssUrls(css, lookup) {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, q, ref) => {
    const a = lookup(ref);
    return a ? `url("${a.dataUrl}")` : match;
  });
}

async function prepareAssets(files) {
  const assets = new Map();
  for (const file of files) {
    const entry = { file, dataUrl: await readAsDataUrl(file) };
    if (isCss(file) || isJs(file)) entry.text = await file.text();
    assets.set(file.name.toLowerCase(), entry);
  }
  // El CSS puede apuntar a imágenes o fuentes: se resuelven una vez que todo está cargado.
  const lookup = makeLookup(assets);
  for (const entry of assets.values()) {
    if (isCss(entry.file)) entry.text = rewriteCssUrls(entry.text, lookup);
  }
  return lookup;
}

// Mete dentro del HTML las imágenes, estilos y scripts seleccionados para que se vea igual sin conexión.
function inlineAssets(html, lookup) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  doc.querySelectorAll('link[href]').forEach(link => {
    const a = lookup(link.getAttribute('href'));
    if (!a) return;
    if (/stylesheet/i.test(link.rel) && a.text != null) {
      const style = doc.createElement('style');
      if (link.media) style.media = link.media;
      style.textContent = a.text;
      link.replaceWith(style);
    } else {
      link.setAttribute('href', a.dataUrl);
    }
  });

  doc.querySelectorAll('script[src]').forEach(script => {
    const a = lookup(script.getAttribute('src'));
    if (!a || a.text == null) return;
    script.removeAttribute('src');
    script.textContent = a.text;
  });

  doc.querySelectorAll('[src], [poster], image[href], use[href], image, use').forEach(el => {
    for (const attr of ['src', 'poster', 'href', 'xlink:href']) {
      if (attr.endsWith('href') && !['image', 'use'].includes(el.localName)) continue;
      const a = lookup(el.getAttribute(attr));
      if (a) el.setAttribute(attr, a.dataUrl);
    }
  });

  doc.querySelectorAll('[srcset]').forEach(el => {
    const parts = el.getAttribute('srcset').split(',').map(part => {
      const [url, ...rest] = part.trim().split(/\s+/);
      const a = lookup(url);
      return [a ? a.dataUrl : url, ...rest].join(' ');
    });
    el.setAttribute('srcset', parts.join(', '));
  });

  doc.querySelectorAll('style').forEach(s => { s.textContent = rewriteCssUrls(s.textContent, lookup); });
  doc.querySelectorAll('[style]').forEach(el => {
    el.setAttribute('style', rewriteCssUrls(el.getAttribute('style'), lookup));
  });

  const doctype = /^\s*<!doctype/i.test(html) ? '<!DOCTYPE html>\n' : '';
  return doctype + doc.documentElement.outerHTML;
}

// ---------- Interfaz ----------

const $ = id => document.getElementById(id);
const home = $('home');
const viewer = $('viewer');
const frame = $('frame');

function setStatus(msg) { $('status').textContent = msg || ''; }

async function renderList() {
  const files = (await getAll()).sort((a, b) => b.date - a.date);
  const list = $('recents');
  list.replaceChildren();
  $('empty').hidden = files.length > 0;
  $('count').textContent = files.length ? `${files.length}` : '';
  const fmt = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' });

  for (const f of files) {
    const li = document.createElement('li');

    const open = document.createElement('button');
    open.className = 'open';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = f.name;
    const date = document.createElement('span');
    date.className = 'date';
    date.textContent = fmt.format(f.date);
    open.append(name, date);
    open.onclick = () => show(f.id);

    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = 'Borrar';
    del.onclick = async () => {
      if (!confirm(`¿Borrar "${f.name}" de la lista?`)) return;
      await remove(f.id);
      renderList();
    };

    li.append(open, del);
    list.append(li);
  }
}

async function show(id) {
  const f = await getOne(id);
  if (!f) return;
  frame.srcdoc = f.html;
  home.hidden = true;
  viewer.hidden = false;
  document.title = f.name;
  history.pushState({ viewing: id }, '');
}

function closeViewer() {
  viewer.hidden = true;
  home.hidden = false;
  frame.srcdoc = '';
  document.title = 'Visor HTML';
}

$('back').onclick = () => history.back();
window.addEventListener('popstate', () => { if (!viewer.hidden) closeViewer(); });

$('picker').addEventListener('change', async e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;

  const htmlFiles = files.filter(isHtml);
  if (!htmlFiles.length) {
    alert('No elegiste ningún archivo .html. Vuelve a intentarlo eligiendo un archivo que termine en .html o .htm.');
    return;
  }

  setStatus('Abriendo…');
  try {
    const lookup = await prepareAssets(files.filter(f => !isHtml(f)));
    let firstId = null;
    for (const file of htmlFiles) {
      const html = inlineAssets(await file.text(), lookup);
      const id = await save(file.name, html);
      if (firstId === null) firstId = id;
    }
    await renderList();
    setStatus('');
    show(firstId);
  } catch (err) {
    console.error(err);
    setStatus('No se pudo abrir el archivo: ' + err.message);
  }
});

renderList();

// Pide al sistema que no borre los archivos guardados.
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

// Funcionamiento sin conexión.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
