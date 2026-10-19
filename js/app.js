import { S } from './api.js';
import * as auth from './auth.js';
import { CLIENT_ID, DEVICE_NAME, REDIRECT_URI } from './config.js';
import { activeRoot, focus, focusByKey, focusFirst, getFocused, isLayerOpen, move, popLayer, pushLayer, setBase } from './nav.js';
import {
  P, activateAudio, addToQueue, bus, changeVolume, cycleRepeat, explain, initSdk, next, play, position, prev, refresh,
  seekBy, startPolling, toggleLike, togglePlay, toggleShuffle, transfer,
} from './player.js';
import { $, artistsText, colorOf, esc, fmtTime, hydrateIcons, icon, pickImage, store, toast } from './util.js';
import { activeIndex, getLyrics, renderLines } from './lyrics.js';
import { allPlaylists, deviceIcon, lists, loadMore, searchKey, setSaveState, setTopRange, skeleton, views } from './views.js';

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
  if (menuOpen()) return closeMenu();
  if (lyricsOpen()) return closeLyrics();
  if (!$('#np').hidden) return closeNowPlaying();
  if (stack.length > 1) {
    stack.pop();
    render({ restore: true });
    return;
  }
  confirmDialog('Sair do MusicPlayer?', 'Sair', () => {
    window.close();
    setTimeout(() => toast('Use o botão Home do controle para sair.'), 400);
  });
}

function nav(view) {
  if (!started) return;
  if (!$('#dialog').hidden) closeDialog();
  if (menuOpen()) closeMenu();
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

// ---- Menu de ações ------------------------------------------------------
// Painel lateral com opções (fila, playlist, curtir, ir para…). Cada item é {icon, label, run}.

let menuItems = [];
const menuOpen = () => !$('#menu').hidden;

function openMenu({ eyebrow = '', title, sub = '', items }) {
  if (menuOpen()) closeMenu();
  menuItems = items;
  $('#menu-eyebrow').textContent = eyebrow;
  $('#menu-title').textContent = title || '';
  $('#menu-sub').textContent = sub;
  $('#menu-items').innerHTML = items.map((it, i) =>
    `<div class="menu-item" data-focus data-key="mi-${i}" data-action="menu-item" data-i="${i}">${icon(it.icon)}<span>${esc(it.label)}</span></div>`).join('');
  $('#menu-items').scrollTop = 0;
  $('#menu').hidden = false;
  pushLayer($('#menu'));
}

function closeMenu() {
  $('#menu').hidden = true;
  popLayer($('#menu'));
  menuItems = [];
}

// Fecha menu e player antes de navegar para outra tela
function goFrom(type, id) {
  if (menuOpen()) closeMenu();
  if (!$('#np').hidden) closeNowPlaying();
  go(type, { id });
}

async function openTrackMenu(d, { fromPlayer = false } = {}) {
  const kind = d.type || 'track';
  const isCurrent = d.uri === P.state?.track?.uri;
  let saved = null;
  try { saved = !!(await S.libContains([d.uri]))?.[0]; } catch {}
  const items = [];
  if (!fromPlayer && kind !== 'chapter') items.push({ icon: 'queue', label: 'Tocar em seguida', run: () => addToQueue(d.uri) });
  if (kind === 'track') items.push({ icon: 'addTo', label: 'Adicionar a uma playlist', run: () => openPlaylistPicker(d) });
  if (saved !== null && kind !== 'chapter') {
    const [on, off] = kind === 'episode' ? ['Remover dos salvos', 'Salvar episódio'] : ['Remover das curtidas', 'Curtir'];
    items.push({
      icon: saved ? 'heart' : 'heartOutline', label: saved ? on : off,
      run: async () => {
        if (isCurrent && kind === 'track') return toggleLike();
        await (saved ? S.libRemove([d.uri]) : S.libSave([d.uri]));
        toast(saved ? 'Removido' : 'Salvo');
      },
    });
  }
  if (d.album) items.push({ icon: 'album', label: 'Ir para o álbum', run: () => goFrom('album', d.album) });
  if (d.artist) items.push({ icon: 'person', label: 'Ir para o artista', run: () => goFrom('artist', d.artist) });
  if (d.show) items.push({ icon: 'podcast', label: 'Ir para o podcast', run: () => goFrom('show', d.show) });
  if (d.audiobook) items.push({ icon: 'book', label: 'Ir para o audiolivro', run: () => goFrom('audiobook', d.audiobook) });
  openMenu({ eyebrow: { episode: 'Episódio', chapter: 'Capítulo' }[kind] || 'Música', title: d.name, sub: d.sub, items });
}

let editablePlaylists = null;
async function openPlaylistPicker(d) {
  editablePlaylists ||= (await allPlaylists()).filter((p) => p.owner?.id === ctx.me?.id || p.collaborative);
  const date = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  openMenu({
    eyebrow: 'Adicionar a uma playlist', title: d.name, sub: d.sub,
    items: [
      {
        icon: 'plus', label: 'Nova playlist',
        run: async () => {
          const p = await S.createPlaylist(`Criada na TV · ${date}`, 'Criada pelo MusicPlayer');
          await S.addToPlaylist(p.id, [d.uri]);
          editablePlaylists = null;
          toast(`Adicionada à nova playlist “${p.name}”`);
        },
      },
      ...editablePlaylists.map((p) => ({
        icon: 'addTo', label: p.name,
        run: async () => { await S.addToPlaylist(p.id, [d.uri]); toast(`Adicionada a “${p.name}”`); },
      })),
    ],
  });
}

// Dados do menu para o que está tocando agora
function currentMenuData() {
  const t = P.state?.track;
  if (!t) return null;
  const id = (uri) => uri?.split(':')[2];
  // Em episódios e capítulos, o "álbum" normalizado é o podcast/audiolivro
  const type = t.type === 'episode' || t.type === 'chapter' ? t.type : 'track';
  return {
    uri: t.uri, name: t.name, sub: artistsText(t.artists), type,
    album: type === 'track' ? id(t.album?.uri) : undefined,
    artist: type === 'track' ? id(t.artists?.[0]?.uri) : undefined,
    show: type === 'episode' ? id(t.album?.uri) : undefined,
    audiobook: type === 'chapter' ? id(t.album?.uri) : undefined,
  };
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
  tick(true);
}

function closeNowPlaying() {
  if (lyricsOpen()) closeLyrics();
  $('#np').hidden = true;
  popLayer($('#np'));
}

// ---- Letra -------------------------------------------------------------
// Modo da tela "Tocando agora": a letra ocupa o lugar da fila, na altura da capa.

let lyrics = null;
let lyricsUri = null;
let lyricsActive = -2;
let lyricsTimer;
const lyricsOpen = () => !$('#np-lyrics').hidden;

function toggleLyrics() {
  if (lyricsOpen()) return closeLyrics();
  if (!P.state?.track) { toast('Nada tocando.'); return; }
  openNowPlaying();
  $('#np').classList.add('lyrics-open');
  $('#np-lyrics').hidden = false;
  $('#np-lyrics-btn').classList.add('on');
  clearInterval(lyricsTimer);
  lyricsTimer = setInterval(lyricsTick, 200);
  loadLyrics();
}

function closeLyrics() {
  clearInterval(lyricsTimer);
  $('#np').classList.remove('lyrics-open');
  $('#np-lyrics').hidden = true;
  $('#np-lyrics-btn').classList.remove('on');
}

async function loadLyrics() {
  const t = P.state?.track;
  const box = $('#lyr-lines');
  lyricsUri = t?.uri || null;
  lyrics = null;
  lyricsActive = -2;
  box.style.transform = '';
  box.classList.remove('is-plain');
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
      lyricsTick(true);
    }
  } catch {
    if (lyricsUri === t.uri) box.innerHTML = '<p class="lyr-msg">Não foi possível carregar a letra agora.</p>';
  }
}

// Sincronizada: destaca a linha atual e a mantém a ~40% da altura.
// Sem sincronia: rola o texto proporcionalmente ao andamento da música.
function lyricsTick(force = false) {
  if (!lyrics || !lyricsOpen()) return;
  const box = $('#lyr-lines');
  const h = $('#lyr-scroll').clientHeight;
  if (lyrics.plain) {
    const dur = P.state?.track?.duration || 0;
    const frac = dur ? Math.min(1, position() / dur) : 0;
    box.style.transform = `translateY(${-Math.round(Math.max(0, box.scrollHeight - h * 0.7) * frac)}px)`;
    return;
  }
  const i = activeIndex(lyrics.synced, position());
  if (i === lyricsActive && !force) return;
  lyricsActive = i;
  const lines = [...box.children];
  lines.forEach((el, k) => {
    el.classList.toggle('active', k === i);
    el.classList.toggle('past', k < i);
  });
  const cur = lines[Math.max(i, 0)];
  if (cur) box.style.transform = `translateY(${Math.round(h * 0.4 - (cur.offsetTop + cur.offsetHeight / 2))}px)`;
}

// Escreve no DOM só quando o valor muda (o estado chega a cada poucos segundos)
const domCache = new Map();
function setHTML(sel, html) {
  if (domCache.get(sel) === html) return;
  domCache.set(sel, html);
  $(sel).innerHTML = html;
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
  $('#np-album').hidden = !t?.album?.name;
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
  setHTML('#mini-toggle', playIcon);
  setHTML('#np-toggle', playIcon);
  $('#np-shuffle').classList.toggle('on', !!s?.shuffle);
  $('#np-repeat').classList.toggle('on', !!s && s.repeat !== 'off');
  setHTML('#np-repeat', icon(s?.repeat === 'track' ? 'repeatOne' : 'repeat'));

  $('#np-lyrics-btn').hidden = !t || t.type === 'episode' || t.type === 'chapter';
  if ($('#np-lyrics-btn').hidden && lyricsOpen()) closeLyrics();

  const dev = s?.device;
  const devName = dev ? (dev.id === P.deviceId ? 'Esta TV' : dev.name) : '';
  const remoteVol = !!dev?.canVolume && dev.id !== P.deviceId;
  $('#np-vol').hidden = !remoteVol;
  if (remoteVol) $('#np-vol-val').textContent = `${dev.volume}%`;
  setHTML('#mini-device', dev ? `${icon(deviceIcon(dev.type))}<span>${esc(devName)}</span>` : '');
  setHTML('#np-device', dev ? `${icon(deviceIcon(dev.type))}<span>${s.isPlaying ? 'Tocando' : 'Pausado'} em ${esc(devName)}</span>` : '');

  updateColor(t);
  // Destacar o que toca percorre todas as faixas/cards da tela: só quando algo mudou
  const hl = `${t?.uri}|${s?.contextUri}|${!!s?.isPlaying}`;
  if (hl !== lastHighlight) highlightPlaying();
  tick(true);
}

function renderLike() {
  const b = $('#np-like');
  b.innerHTML = icon(P.liked ? 'heart' : 'heartOutline');
  b.classList.toggle('on', !!P.liked);
  b.classList.toggle('disabled', P.liked === null);
}

let lastHighlight = '';
function highlightPlaying() {
  lastHighlight = `${P.state?.track?.uri}|${P.state?.contextUri}|${!!P.state?.isPlaying}`;
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

// Atualiza barras e tempos (a cada 500 ms). Pausado, nada muda: não toca no DOM.
function tick(force = false) {
  if (!force && !P.state?.isPlaying) return;
  const dur = P.state?.track?.duration || 0;
  const pos = position();
  const frac = dur ? Math.min(1, pos / dur) : 0;
  $('#mini-bar').style.transform = `scaleX(${frac})`;
  $('#mini-pos').textContent = fmtTime(pos);
  $('#mini-dur').textContent = fmtTime(dur);
  if ($('#np').hidden) return;
  $('#np-bar').style.transform = `scaleX(${frac})`;
  $('#np-pos').textContent = fmtTime(pos);
  $('#np-dur').textContent = fmtTime(dur);
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
  lyrics: () => toggleLyrics(),
  'track-menu': (d) => openTrackMenu(d),
  'np-more': () => { const d = currentMenuData(); if (d) openTrackMenu(d, { fromPlayer: true }); },
  'menu-item': async (d) => {
    const it = menuItems[Number(d.i)];
    if (!it) return;
    closeMenu();
    try { await it.run(); } catch (e) { toast(explain(e)); }
  },
  'lib-toggle': async (d, el) => {
    const on = !!el.dataset.on;
    try {
      await (on ? S.libRemove([d.uri]) : S.libSave([d.uri]));
      setSaveState(el, !on);
    } catch (e) { toast(explain(e)); }
  },
  'top-range': (d) => setTopRange(d.range).then(() => { markLoadedImages($('#content')); highlightPlaying(); }),
  'vol-down': () => changeVolume(-10),
  'vol-up': () => changeVolume(10),
  'np-back': () => back(),
  // Nome do artista/álbum no player leva à página (em podcasts, à página do programa)
  'np-goto': (d) => {
    const m = currentMenuData();
    if (!m) return;
    const id = d.target === 'artist' ? m.artist : m.album;
    if (id) goFrom(d.target, id);
    else if (m.show) goFrom('show', m.show);
    else if (m.audiobook) goFrom('audiobook', m.audiobook);
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
  Promise.resolve(actions[el.dataset.action]?.(el.dataset, el)).catch((err) => toast(explain(err)));
});

// Mouse x controle remoto. O navegador da TV mostra um cursor parado na tela: quando a
// página rola com as setas, itens passam por baixo dele e o "mouseover" roubava o foco.
// Agora o mouse só vale depois de um movimento real do ponteiro; qualquer tecla volta
// ao modo controle (e esconde o cursor onde o navegador permitir).
let pointerMode = false;
let lastPointer = '';
document.documentElement.classList.add('kbd-mode');

document.addEventListener('mousemove', (e) => {
  // O Chrome também dispara mousemove "sintético" quando a página rola sob o cursor parado:
  // mesma posição, então é ignorado.
  const xy = `${e.screenX},${e.screenY}`;
  if (xy === lastPointer) return;
  const first = !lastPointer;
  lastPointer = xy;
  if (first) return; // primeira posição conhecida ainda não é movimento
  if (!pointerMode) {
    pointerMode = true;
    document.documentElement.classList.remove('kbd-mode');
  }
  updateEdgeScroll(e.clientX, e.clientY);
}, { passive: true });

// Rolagem pelas bordas: no "modo cursor" do navegador da TV as setas mexem o ponteiro e
// não chegam ao app. Com o ponteiro perto da borda de uma fileira ou da página, ela rola.
let edge = null;
let edgeFrame = 0;

function updateEdgeScroll(x, y) {
  edge = null;
  const target = document.elementFromPoint(x, y);
  const row = target?.closest('[data-nav-row]');
  if (row) {
    const r = row.getBoundingClientRect();
    const zone = Math.min(180, r.width * 0.12);
    if (x > r.right - zone) edge = { box: row, axis: 'scrollLeft', speed: 4 + 18 * (x - (r.right - zone)) / zone };
    else if (x < r.left + zone) edge = { box: row, axis: 'scrollLeft', speed: -(4 + 18 * ((r.left + zone) - x) / zone) };
  }
  if (!edge) {
    const page = target?.closest('.view-scroll');
    if (page) {
      const r = page.getBoundingClientRect();
      const zone = Math.min(150, r.height * 0.15);
      if (y > r.bottom - zone) edge = { box: page, axis: 'scrollTop', speed: 4 + 20 * (y - (r.bottom - zone)) / zone };
      else if (y < r.top + zone) edge = { box: page, axis: 'scrollTop', speed: -(4 + 20 * ((r.top + zone) - y) / zone) };
    }
  }
  if (edge && !edgeFrame) edgeFrame = requestAnimationFrame(edgeStep);
}

function edgeStep() {
  edgeFrame = 0;
  if (!edge || !pointerMode) return;
  const before = edge.box[edge.axis];
  edge.box[edge.axis] = before + edge.speed;
  if (edge.box[edge.axis] === before) { edge = null; return; } // chegou ao fim
  edgeFrame = requestAnimationFrame(edgeStep);
}
document.addEventListener('mouseleave', () => { edge = null; });

document.addEventListener('mouseover', (e) => {
  if (!pointerMode) return;
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
  if (pointerMode) {
    pointerMode = false;
    edge = null;
    document.documentElement.classList.add('kbd-mode');
  }

  const ch = typedChar(e);
  if (ch) { e.preventDefault(); searchKey(ch); return; }

  const k = e.key === ' ' ? 'playpause' : KEYS[e.keyCode];
  if (!k) return;
  e.preventDefault();

  // Segurar a tecla só repete as setas; OK, Voltar e mídia disparariam várias vezes
  if (e.repeat && !['left', 'right', 'up', 'down'].includes(k)) return;

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
    case 'red':
      if (!$('#dialog').hidden || menuOpen()) return;
      if ($('#np').hidden) openNowPlaying(); else closeNowPlaying();
      return;
    case 'green': nav('search'); return;
    case 'yellow': nav('library'); return;
    case 'blue': nav('devices'); return;
  }
});

// Depois de 1 min parado com música tocando, abre a tela cheia (o Ambilight agradece)
setInterval(() => {
  if (started && P.state?.isPlaying && $('#np').hidden && $('#dialog').hidden && !menuOpen() && Date.now() - lastInput > 60_000) openNowPlaying();
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
      onStatus: (msg) => { $('#pair-status').textContent = msg; },
      onDone: () => { $('#pair-status').textContent = 'Conectado! Abrindo…'; location.replace(location.pathname); },
      onError: (e) => {
        $('#pair-status').textContent = `Falhou${e.status ? ` (${e.status}${e.code ? ` ${e.code}` : ''})` : ''}: ${e.message}. Novo código em 30 s…`;
        $('#login-diag').textContent = `Navegador: ${navigator.userAgent}`;
        $('#login-diag').hidden = false;
        setTimeout(() => location.reload(), 30000);
      },
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
  bus.addEventListener('queue', () => setTimeout(loadQueue, 600));
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

  // Recursos novos (podcasts, playlists, seguir) pedem permissões que o login antigo não tem
  auth.missingScopes().then((missing) => {
    if (!missing.length) return;
    setTimeout(() => confirmDialog(
      'O app ganhou podcasts, fila, playlists e mais. Entre de novo na sua conta para liberar esses recursos.',
      'Entrar de novo', () => auth.logout(),
    ), 1500);
  });
}

window.addEventListener('spotv:logout', () => location.replace(location.pathname));

// No navegador da TV o Voltar do controle costuma ser o "voltar página" do navegador, que
// sairia do app. Uma entrada extra no histórico transforma esse voltar no Voltar do app.
function trapBrowserBack() {
  history.pushState({ spotv: true }, '');
  window.addEventListener('popstate', () => {
    history.pushState({ spotv: true }, '');
    back();
  });
}

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
  trapBrowserBack();
  startApp();
}

boot();
