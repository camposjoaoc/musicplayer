import { S } from './api.js';
import * as auth from './auth.js';
import { CLIENT_ID, DEVICE_NAME, REDIRECT_URI } from './config.js';
import { activeRoot, focus, focusByKey, focusFirst, getFocused, isLayerOpen, move, popLayer, pushLayer, setBase } from './nav.js';
import {
  P, activateAudio, bus, cycleRepeat, explain, initSdk, next, play, position, prev, refresh,
  seekBy, startPolling, toggleLike, togglePlay, toggleShuffle, transfer,
} from './player.js';
import { $, artistsText, colorOf, esc, fmtTime, hydrateIcons, icon, pickImage, store, toast } from './util.js';
import { activeIndex, getLyrics, renderLines } from './lyrics.js';
import { deviceIcon, lists, loadMore, searchKey, skeleton, views } from './views.js';

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
  el.innerHTML = skeleton(entry.name);
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
  markLoadedImages(el);
  highlightPlaying();
  if (isLayerOpen()) return;
  if (!(restore && entry.focusKey && focusByKey(entry.focusKey, el))) focusFirst(el);
}

function back() {
  if (!$('#dialog').hidden) return closeDialog();
  if (lyricsOpen()) return closeLyrics();
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
  if (lyricsOpen()) closeLyrics();
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
  updateClock();
  renderPlayer();
  loadQueue();
}

function closeNowPlaying() {
  if (lyricsOpen()) closeLyrics();
  $('#np').hidden = true;
  popLayer($('#np'));
}

// ---- Letra -------------------------------------------------------------

let lyrics = null;
let lyricsUri = null;
let lyricsActive = -2;
let lyricsOffset = 0;
const lyricsOpen = () => !$('#np-lyrics').hidden;

function openLyrics() {
  if (!P.state?.track) { toast('Nada tocando.'); return; }
  openNowPlaying();
  if (lyricsOpen()) return;
  $('#np').classList.add('lyrics-open');
  $('#np-lyrics').hidden = false;
  pushLayer($('#np-lyrics'));
  loadLyrics();
}

function closeLyrics() {
  $('#np').classList.remove('lyrics-open');
  $('#np-lyrics').hidden = true;
  popLayer($('#np-lyrics'));
}

async function loadLyrics() {
  const t = P.state?.track;
  const box = $('#lyr-lines');
  lyricsUri = t?.uri || null;
  lyrics = null;
  lyricsActive = -2;
  lyricsOffset = 0;
  box.style.transform = '';
  box.classList.remove('is-plain');
  $('#lyr-title').textContent = t?.name || '';
  $('#lyr-artist').textContent = t ? artistsText(t.artists) : '';
  setImg($('#lyr-art'), pickImage(t?.album?.images, 300));
  if (!t) { box.innerHTML = '<p class="lyr-msg">Nada tocando.</p>'; return; }
  box.innerHTML = '<p class="lyr-msg">Procurando a letra…</p>';
  try {
    const l = await getLyrics(t);
    if (lyricsUri !== t.uri) return;
    if (!l) box.innerHTML = '<p class="lyr-msg">Letra não encontrada para esta música.</p>';
    else if (l.instrumental) box.innerHTML = '<p class="lyr-msg">♪ Música instrumental</p>';
    else {
      lyrics = l;
      box.innerHTML = renderLines(l);
      box.classList.toggle('is-plain', !l.synced);
      $('#lyr-hint').textContent = l.synced
        ? 'OK pausa · ◀ ▶ 10s · Voltar fecha a letra'
        : 'Letra sem sincronia: ▲ ▼ rolam · OK pausa · Voltar fecha a letra';
      lyricsTick(true);
    }
  } catch {
    if (lyricsUri === t.uri) box.innerHTML = '<p class="lyr-msg">Não foi possível carregar a letra agora.</p>';
  }
}

// Destaca a linha que está tocando e a mantém a ~40% da altura
function lyricsTick(force = false) {
  if (!lyrics?.synced || !lyricsOpen()) return;
  const i = activeIndex(lyrics.synced, position());
  if (i === lyricsActive && !force) return;
  lyricsActive = i;
  const lines = [...$('#lyr-lines').children];
  lines.forEach((el, k) => {
    el.classList.toggle('active', k === i);
    el.classList.toggle('past', k < i);
  });
  const cur = lines[Math.max(i, 0)];
  if (!cur) return;
  const h = $('#lyr-scroll').clientHeight;
  $('#lyr-lines').style.transform = `translateY(${Math.round(h * 0.4 - (cur.offsetTop + cur.offsetHeight / 2))}px)`;
}

// Letras sem sincronia: ▲ ▼ rolam
function lyricsScroll(dir) {
  if (!lyrics?.plain) return;
  const h = $('#lyr-scroll').clientHeight;
  const max = Math.max(0, $('#lyr-lines').scrollHeight - h * 0.6);
  lyricsOffset = Math.min(max, Math.max(0, lyricsOffset + dir * h * 0.35));
  $('#lyr-lines').style.transform = `translateY(${-lyricsOffset}px)`;
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
  setImg($('#np-bg-art'), pickImage(t?.album?.images, 300));

  // Troca de faixa: anima a capa e o texto e atualiza a fila
  if ((t?.uri || '') !== lastTrackUri) {
    lastTrackUri = t?.uri || '';
    for (const el of [$('#np-art'), $('.np-text')]) {
      el.classList.remove('swap');
      void el.offsetWidth;
      el.classList.add('swap');
    }
    loadQueue();
    if (lyricsOpen()) loadLyrics();
  }

  const playIcon = icon(s?.isPlaying ? 'pause' : 'play');
  $('#mini-toggle').innerHTML = playIcon;
  $('#np-toggle').innerHTML = playIcon;
  $('#np-shuffle').classList.toggle('on', !!s?.shuffle);
  $('#np-repeat').classList.toggle('on', !!s && s.repeat !== 'off');
  $('#np-repeat').innerHTML = icon(s?.repeat === 'track' ? 'repeatOne' : 'repeat');

  const dev = s?.device;
  const devName = dev ? (dev.id === P.deviceId ? 'Esta TV' : dev.name) : '';
  $('#mini-device').innerHTML = dev ? `${icon(deviceIcon(dev.type))}<span>${esc(devName)}</span>` : '';
  $('#np-device').innerHTML = dev ? `${icon(deviceIcon(dev.type))}<span>${s.isPlaying ? 'Tocando' : 'Pausado'} em ${esc(devName)}</span>` : '';

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
  const ctxUri = P.state?.contextUri || '';
  const playing = !!P.state?.isPlaying;
  const mark = (el, on) => {
    el.classList.toggle('is-playing', on);
    el.classList.toggle('paused', on && !playing);
  };
  document.querySelectorAll('#content .track').forEach((el) => mark(el, !!uri && el.dataset.uri === uri));
  // Cards: playlist/álbum/artista que é o contexto atual, ou a própria faixa
  document.querySelectorAll('#content .card').forEach((el) => {
    const k = el.dataset.key;
    mark(el, !!uri && (k === ctxUri || k === `card:${uri}` || (k === 'liked' && ctxUri.endsWith(':collection'))));
  });
}

// ---- Fila, relógio, imagens --------------------------------------------

let lastTrackUri = null;
let queueSeq = 0;

async function loadQueue() {
  if ($('#np').hidden || !P.state?.track) { $('#np-queue').hidden = true; return; }
  const seq = ++queueSeq;
  try {
    const q = await S.queue();
    if (seq !== queueSeq) return;
    const seen = new Set([P.state?.track?.uri]);
    const items = (q?.queue || []).filter((t) => t?.uri && !seen.has(t.uri) && seen.add(t.uri)).slice(0, 5);
    $('#np-queue').hidden = !items.length;
    $('#np-queue-list').innerHTML = items.map((t, i) => {
      const img = pickImage(t.album?.images || t.images, 64);
      return `<div class="q-item" data-focus data-key="q-${i}" data-action="play-queue" data-uri="${esc(t.uri)}">
        ${img ? `<img src="${esc(img)}" alt="">` : '<div class="q-ph"></div>'}
        <div class="q-text"><div class="q-title">${esc(t.name)}</div><div class="q-artist">${esc(artistsText(t.artists) || t.show?.name || '')}</div></div>
      </div>`;
    }).join('');
    lists.set('queue', items.map((t) => t.uri));
  } catch {
    $('#np-queue').hidden = true;
  }
}

function updateClock() {
  $('#np-clock').textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// Imagens entram com fade quando terminam de carregar
document.addEventListener('load', (e) => { if (e.target.tagName === 'IMG') e.target.classList.add('loaded'); }, true);
document.addEventListener('error', (e) => { if (e.target.tagName === 'IMG') e.target.classList.add('loaded', 'broken'); }, true);
function markLoadedImages(root) {
  root.querySelectorAll('img').forEach((img) => { if (img.complete) img.classList.add('loaded'); });
}

// Menu lateral: recolhido em ícones; abre quando o foco entra nele
document.addEventListener('focuschange', (e) => {
  $('#app').classList.toggle('nav-open', !!$('#sidebar')?.contains(e.detail));
});

function tick() {
  const dur = P.state?.track?.duration || 0;
  const pos = position();
  const frac = dur ? Math.min(1, pos / dur) : 0;
  $('#mini-bar').style.transform = `scaleX(${frac})`;
  $('#np-bar').style.transform = `scaleX(${frac})`;
  $('#lyr-bar').style.transform = `scaleX(${frac})`;
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
  open: ({ type, id, name, img, owner }) => go(type, { id, name, img, owner }),
  retry: () => render(),
  'now-playing': () => openNowPlaying(),
  'play-context': async (d) => {
    if (await startPlayback({ contextUri: d.uri, list: d.list, shuffle: d.shuffle === '1', total: Number(d.total) || 0 })) openNowPlaying();
  },
  'play-track': async (d) => {
    if (await startPlayback({ contextUri: d.context, offsetUri: d.uri, list: d.list, index: numberOrUndef(d.index), uri: d.uri })) openNowPlaying();
  },
  resume: async (d) => {
    const s = P.state;
    if (s?.track?.uri === d.uri) {
      if (!s.isPlaying) await togglePlay();
      openNowPlaying();
    } else {
      await actions['play-track'](d);
    }
  },
  'play-queue': async (d) => {
    const uris = lists.get('queue') || [];
    const i = Math.max(0, uris.indexOf(d.uri));
    const ok = await startPlayback(P.state?.contextUri
      ? { contextUri: P.state.contextUri, offsetUri: d.uri, list: 'queue', index: i }
      : { list: 'queue', index: i });
    if (ok) toast('Pulando para a música escolhida');
  },
  lyrics: () => openLyrics(),
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
      if (lyricsOpen()) { lyricsScroll(k === 'up' ? -1 : 1); return; }
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
  if (!$('#np').hidden) updateClock();
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
    $('#user-chip').innerHTML = `<span class="slot">${avatar ? `<img src="${esc(avatar)}" alt="">` : icon('person')}</span><span class="label">${esc(ctx.me.display_name || '')}</span>`;
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
  setInterval(lyricsTick, 200);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

  initSdk();
  startPolling();
  go('home', {}, { root: true });
}

window.addEventListener('spotv:logout', () => location.replace(location.pathname));

// Limpa a chave do YouTube e o cache de clipes de versões anteriores do app
store.del('spotv.ytkey');
store.del('spotv.clips');

async function boot() {
  hydrateIcons();
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
