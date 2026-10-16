import { S } from './api.js';
import * as auth from './auth.js';
import { CLIENT_ID, DEVICE_NAME, REDIRECT_URI } from './config.js';
import { activeRoot, focus, focusByKey, focusFirst, getFocused, isLayerOpen, move, popLayer, pushLayer, setBase } from './nav.js';
import {
  P, activateAudio, bus, cycleRepeat, explain, initSdk, next, play, position, prev, refresh,
  seekBy, startPolling, toggleLike, togglePlay, toggleShuffle, transfer,
} from './player.js';
import { $, artistsText, colorOf, esc, fmtTime, icon, pickImage, store, toast } from './util.js';
import { deviceIcon, lists, loadMore, searchKey, views } from './views.js';

const ctx = { me: null };
const stack = [];
let renderSeq = 0;
let lastInput = Date.now();
let started = false;

// ---- Roteador ----------------------------------------------------------

function go(name, params = {}, { root = false } = {}) {
  const cur = stack.at(-1);
  if (cur) cur.focusKey = getFocused()?.dataset.key;
  if (root) {
    stack.length = 0;
    stack.push({ name: 'home', params: {} });
    if (name !== 'home') stack.push({ name, params });
  } else {
    stack.push({ name, params });
  }
  render();
}

async function render({ restore = false } = {}) {
  const entry = stack.at(-1);
  const seq = ++renderSeq;
  const el = $('#content');
  const section = stack[1]?.name || 'home';
  document.querySelectorAll('.nav-item[data-view]').forEach((n) => n.classList.toggle('active', n.dataset.view === section));
  el.innerHTML = '<div class="view"><div class="loading"><div class="spinner"></div></div></div>';
  try {
    await views[entry.name](el, { params: entry.params, me: ctx.me, isStale: () => seq !== renderSeq });
  } catch (e) {
    if (seq !== renderSeq) return;
    el.innerHTML = `<div class="view"><div class="empty-state">
      <p>${esc(explain(e))}</p>
      <div class="btn" data-focus data-autofocus data-action="retry">${icon('refresh')}<span>Tentar de novo</span></div>
    </div></div>`;
  }
  if (seq !== renderSeq) return;
  highlightPlaying();
  if (isLayerOpen()) return;
  if (!(restore && entry.focusKey && focusByKey(entry.focusKey, el))) focusFirst(el);
}

function back() {
  if (!$('#dialog').hidden) return closeDialog();
  if (!$('#np').hidden) return closeNowPlaying();
  if (stack.length > 1) {
    stack.pop();
    render({ restore: true });
    return;
  }
  confirmDialog('Sair do Spotify TV?', 'Sair', () => {
    window.close();
    setTimeout(() => toast('Use o botão Home do controle para sair.'), 400);
  });
}

function nav(view) {
  if (!started) return;
  if (!$('#dialog').hidden) closeDialog();
  if (!$('#np').hidden) closeNowPlaying();
  go(view, {}, { root: true });
}

// ---- Diálogo -----------------------------------------------------------

let dialogCb = null;

function confirmDialog(text, okLabel, cb) {
  $('#dialog-text').textContent = text;
  $('#dialog-ok').textContent = okLabel;
  dialogCb = cb;
  $('#dialog').hidden = false;
  pushLayer($('#dialog'));
}

function closeDialog() {
  $('#dialog').hidden = true;
  popLayer($('#dialog'));
  dialogCb = null;
}

// ---- Tocando agora -----------------------------------------------------

function openNowPlaying() {
  if (!started || !$('#np').hidden) return;
  $('#np').hidden = false;
  pushLayer($('#np'));
  focus($('#np-toggle'), { smooth: false });
  renderPlayer();
}

function closeNowPlaying() {
  $('#np').hidden = true;
  popLayer($('#np'));
}

function setImg(img, url) {
  if (img.dataset.src === url) return;
  img.dataset.src = url;
  if (url) img.src = url; else img.removeAttribute('src');
  img.classList.toggle('blank', !url);
}

let colorFor = '';
function updateColor(t) {
  const url = pickImage(t?.album?.images, 64);
  if (url === colorFor) return;
  colorFor = url;
  colorOf(url).then((rgb) => {
    if (colorFor !== url) return;
    document.documentElement.style.setProperty('--np-rgb', (rgb || [40, 40, 48]).join(','));
  });
}

function renderPlayer() {
  const s = P.state;
  const t = s?.track;
  $('#mini').classList.toggle('empty', !t);
  $('#mini-title').textContent = t?.name || 'Nada tocando';
  $('#mini-artist').textContent = t ? artistsText(t.artists) : 'Escolha uma música para começar';
  $('#np-title').textContent = t?.name || 'Nada tocando';
  $('#np-artist').textContent = t ? artistsText(t.artists) : '';
  $('#np-album').textContent = t?.album?.name || '';
  setImg($('#mini-art'), pickImage(t?.album?.images, 64));
  setImg($('#np-art'), pickImage(t?.album?.images, 640));

  const playIcon = icon(s?.isPlaying ? 'pause' : 'play');
  $('#mini-toggle').innerHTML = playIcon;
  $('#np-toggle').innerHTML = playIcon;
  $('#np-shuffle').classList.toggle('on', !!s?.shuffle);
  $('#np-repeat').classList.toggle('on', !!s && s.repeat !== 'off');
  $('#np-repeat').innerHTML = icon(s?.repeat === 'track' ? 'repeatOne' : 'repeat');

  const dev = s?.device;
  const devName = dev ? (dev.id === P.deviceId ? 'Esta TV' : dev.name) : '';
  $('#mini-device').innerHTML = dev ? `${icon(deviceIcon(dev.type))}<span>${esc(devName)}</span>` : '';
  $('#np-device').innerHTML = dev ? `${icon(deviceIcon(dev.type))}<span>Tocando em ${esc(devName)}</span>` : '';

  updateColor(t);
  highlightPlaying();
  tick();
}

function renderLike() {
  const b = $('#np-like');
  b.innerHTML = icon(P.liked ? 'heart' : 'heartOutline');
  b.classList.toggle('on', !!P.liked);
  b.classList.toggle('disabled', P.liked === null);
}

function highlightPlaying() {
  const uri = P.state?.track?.uri;
  const playing = !!P.state?.isPlaying;
  document.querySelectorAll('#content .track').forEach((el) => {
    const on = el.dataset.uri === uri;
    el.classList.toggle('is-playing', on);
    el.classList.toggle('paused', on && !playing);
  });
}

function tick() {
  const dur = P.state?.track?.duration || 0;
  const pos = position();
  const frac = dur ? Math.min(1, pos / dur) : 0;
  $('#mini-bar').style.transform = `scaleX(${frac})`;
  $('#np-bar').style.transform = `scaleX(${frac})`;
  $('#mini-pos').textContent = $('#np-pos').textContent = fmtTime(pos);
  $('#mini-dur').textContent = $('#np-dur').textContent = fmtTime(dur);
}

// ---- Ações (OK do controle = click) ------------------------------------

async function startPlayback({ contextUri, offsetUri, list, index, uri, shuffle, total }) {
  const uris = list ? lists.get(list) : null;
  try {
    if (contextUri) {
      try {
        const random = shuffle && total > 1 && !contextUri.includes(':artist:');
        await play({
          contextUri, offsetUri,
          offsetIndex: random ? Math.floor(Math.random() * total) : undefined,
          shuffle: shuffle || undefined,
        });
        return true;
      } catch (e) {
        if (!uris?.length) throw e; // sem lista para tentar de outro jeito
      }
    }
    if (uris?.length) {
      const i = Number.isInteger(index) ? index : shuffle ? Math.floor(Math.random() * uris.length) : 0;
      const start = Math.max(0, i - 20);
      await play({ uris: uris.slice(start, start + 100), offsetIndex: i - start, shuffle: shuffle || undefined });
    } else if (uri) {
      await play({ uris: [uri] });
    }
    return true;
  } catch (e) {
    toast(explain(e));
    return false;
  }
}

const numberOrUndef = (v) => (v === undefined || v === '' ? undefined : Number(v));

const actions = {
  nav: (d) => nav(d.view),
  open: (d) => go(d.type, { id: d.id }),
  retry: () => render(),
  'now-playing': () => openNowPlaying(),
  'play-context': async (d) => {
    if (await startPlayback({ contextUri: d.uri, list: d.list, shuffle: d.shuffle === '1', total: Number(d.total) || 0 })) openNowPlaying();
  },
  'play-track': async (d) => {
    if (await startPlayback({ contextUri: d.context, offsetUri: d.uri, list: d.list, index: numberOrUndef(d.index), uri: d.uri })) openNowPlaying();
  },
  toggle: () => togglePlay(),
  next: () => next(),
  prev: () => prev(),
  shuffle: () => toggleShuffle(),
  repeat: () => cycleRepeat(),
  like: () => toggleLike(),
  seek: () => togglePlay(),
  transfer: async (d) => { await transfer(d.id); if (stack.at(-1)?.name === 'devices') setTimeout(render, 1500); },
  key: (d) => searchKey(d.char),
  more: () => loadMore(),
  logout: () => confirmDialog('Sair da sua conta Spotify nesta TV?', 'Sair da conta', () => auth.logout()),
  'login-tv': () => auth.loginOnTv(),
  'dialog-ok': () => { const cb = dialogCb; closeDialog(); cb?.(); },
  'dialog-cancel': () => closeDialog(),
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || !activeRoot().contains(el)) return;
  activateAudio();
  if (el.hasAttribute('data-focus')) focus(el, { scroll: false });
  Promise.resolve(actions[el.dataset.action]?.(el.dataset)).catch((err) => toast(explain(err)));
});

// Mouse (teste no computador): passar por cima foca
document.addEventListener('mouseover', (e) => {
  const el = e.target.closest('[data-focus]');
  if (el && activeRoot().contains(el)) focus(el, { scroll: false });
});

// ---- Controle remoto ---------------------------------------------------
// Códigos da documentação do Titan OS (Back = 8 na Philips, 461 em outras marcas)

const KEYS = {
  37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'enter',
  8: 'back', 461: 'back', 27: 'back', 10009: 'back',
  415: 'play', 19: 'pause', 179: 'playpause', 413: 'stop',
  417: 'next', 176: 'next', 412: 'prev', 177: 'prev', 33: 'next', 34: 'prev',
  403: 'red', 404: 'green', 405: 'yellow', 406: 'blue',
};

function typedChar(e) {
  if (!started || isLayerOpen() || stack.at(-1)?.name !== 'search') return null;
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.keyCode >= 48 && e.keyCode <= 57) return String(e.keyCode - 48);
  if (e.key === ' ') return 'space';
  return e.key?.length === 1 ? e.key.toLowerCase() : null;
}

document.addEventListener('keydown', (e) => {
  lastInput = Date.now();
  activateAudio();

  const ch = typedChar(e);
  if (ch) { e.preventDefault(); searchKey(ch); return; }

  const k = e.key === ' ' ? 'playpause' : KEYS[e.keyCode];
  if (!k) return;
  e.preventDefault();

  const f = getFocused();
  switch (k) {
    case 'left':
    case 'right':
      if (f?.hasAttribute('data-seek')) { seekBy(k === 'left' ? -10000 : 10000); return; }
      move(k, { smooth: !e.repeat });
      return;
    case 'up':
    case 'down':
      move(k, { smooth: !e.repeat });
      return;
    case 'enter':
      if (f && activeRoot().contains(f)) f.click();
      else focusFirst();
      return;
    case 'back': back(); return;
    case 'play': if (!P.state?.isPlaying) togglePlay(); return;
    case 'pause':
    case 'stop': if (P.state?.isPlaying) togglePlay(); return;
    case 'playpause': togglePlay(); return;
    case 'next': next(); return;
    case 'prev': prev(); return;
    case 'red': if ($('#np').hidden) openNowPlaying(); else closeNowPlaying(); return;
    case 'green': nav('search'); return;
    case 'yellow': nav('library'); return;
    case 'blue': nav('devices'); return;
  }
});

// Depois de 1 min parado com música tocando, abre a tela cheia (o Ambilight agradece)
setInterval(() => {
  if (started && P.state?.isPlaying && $('#np').hidden && $('#dialog').hidden && Date.now() - lastInput > 60_000) openNowPlaying();
}, 5000);

// ---- Login -------------------------------------------------------------

function renderQr(el, text) {
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  el.innerHTML = `<svg viewBox="-3 -3 ${n + 6} ${n + 6}" shape-rendering="crispEdges">
    <rect x="-3" y="-3" width="${n + 6}" height="${n + 6}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

async function showLogin(error) {
  $('#boot').hidden = true;
  $('#app').hidden = true;
  $('#login').hidden = false;
  setBase($('#login'));
  const reason = error || store.get('spotv.logoutReason');
  store.del('spotv.logoutReason');
  if (reason) { $('#login-error').textContent = reason; $('#login-error').hidden = false; }
  focusFirst();

  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    $('#qr').innerHTML = '<p class="qr-note">O login pelo celular só funciona na versão publicada (HTTPS). Use “Entrar aqui”.</p>';
    $('#pair-status').hidden = true;
    return;
  }
  try {
    const pairing = await auth.startPairing({
      onDone: () => { $('#pair-status').textContent = 'Conectado! Abrindo…'; location.replace(location.pathname); },
      onError: (e) => { $('#pair-status').textContent = `Falhou: ${e.message}. Recarregando…`; setTimeout(() => location.reload(), 3000); },
    });
    renderQr($('#qr'), pairing.url);
  } catch (e) {
    $('#qr').innerHTML = `<p class="qr-note">QR indisponível: ${esc(e.message)}</p>`;
  }
}

function showSetup() {
  $('#boot').hidden = true;
  $('#setup').hidden = false;
  $('#setup-redirect').textContent = REDIRECT_URI;
}

async function startApp() {
  started = true;
  $('#boot').hidden = true;
  $('#login').hidden = true;
  $('#app').hidden = false;
  setBase($('#app'));

  try {
    ctx.me = await S.me();
    const avatar = pickImage(ctx.me.images, 64);
    $('#user-chip').innerHTML = `${avatar ? `<img src="${esc(avatar)}" alt="">` : icon('person')}<span>${esc(ctx.me.display_name || '')}</span>`;
  } catch {}

  bus.addEventListener('state', renderPlayer);
  bus.addEventListener('like', renderLike);
  bus.addEventListener('sdk', () => {
    if (P.sdkStatus === 'ready') toast(`Pronto! A TV aparece como “${DEVICE_NAME}” no Spotify.`);
    else if (P.sdkStatus !== 'loading') toast(`Tocar na TV indisponível: ${P.sdkMessage}. Ainda dá para controlar outros aparelhos.`, 7000);
    if (stack.at(-1)?.name === 'devices') render({ restore: true });
  });
  renderPlayer();
  renderLike();
  setInterval(tick, 500);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

  initSdk();
  startPolling();
  go('home', {}, { root: true });
}

window.addEventListener('spotv:logout', () => location.replace(location.pathname));

async function boot() {
  if (!CLIENT_ID) return showSetup();
  try {
    if (await auth.completeTvLogin()) toast('Conectado!');
  } catch (e) {
    return showLogin(e.message);
  }
  if (!auth.isLoggedIn()) return showLogin();
  startApp();
}

boot();
