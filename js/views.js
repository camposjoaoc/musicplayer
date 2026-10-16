import { S } from './api.js';
import { focus } from './nav.js';
import { P, drmCheck, sdkLabel } from './player.js';
import { artistsText, esc, fmtTime, icon, pickImage, stripHtml } from './util.js';

// Listas de URIs para tocar quando não há um "contexto" Spotify (fallback)
export const lists = new Map();

let moreFn = null;

// ---- Peças -------------------------------------------------------------

function art(images, size, kind = 'note') {
  const url = pickImage(images, size);
  return url ? `<img src="${esc(url)}" loading="lazy" alt="">` : `<div class="art-ph">${icon(kind)}</div>`;
}

const dataAttrs = (data) =>
  Object.entries(data).filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');

function card({ key, images, title, sub, action, data = {}, round = false, kind }) {
  return `<div class="card${round ? ' round' : ''}" data-focus data-key="${esc(key)}" data-action="${action}"${dataAttrs(data)}>
    <div class="card-art">${art(images, 300, kind)}</div>
    <div class="card-title">${esc(title)}</div>
    <div class="card-sub">${esc(sub || '')}</div>
  </div>`;
}

const playlistCard = (p) => card({
  key: p.uri, images: p.images, title: p.name,
  sub: p.owner?.display_name ? `De ${p.owner.display_name}` : 'Playlist',
  action: 'open', data: { type: 'playlist', id: p.id },
});

const albumCard = (a) => card({
  key: a.uri, images: a.images, title: a.name,
  sub: [a.release_date?.slice(0, 4), artistsText(a.artists)].filter(Boolean).join(' · '),
  action: 'open', data: { type: 'album', id: a.id },
});

const artistCard = (a) => card({
  key: a.uri, images: a.images, title: a.name, sub: 'Artista', round: true, kind: 'person',
  action: 'open', data: { type: 'artist', id: a.id },
});

// Contexto de artista não aceita offset; nesse caso toca a partir do álbum.
const contextFor = (t, ctx) => (ctx && !ctx.includes(':artist:') ? ctx : t.album?.uri);

const trackCard = (t, ctx) => card({
  key: `card:${t.uri}`, images: t.album?.images, title: t.name, sub: artistsText(t.artists),
  action: 'play-track', data: { uri: t.uri, context: contextFor(t, ctx) },
});

const likedCard = () => `<div class="card" data-focus data-key="liked" data-action="open" data-type="liked">
    <div class="card-art"><div class="liked-art">${icon('heart')}</div></div>
    <div class="card-title">Músicas curtidas</div>
    <div class="card-sub">Sua biblioteca</div>
  </div>`;

const row = (title, items) => (items.length
  ? `<section class="row"><h2>${esc(title)}</h2><div class="row-track" data-nav-row>${items.join('')}</div></section>`
  : '');

const grid = (title, items) => (items.length
  ? `<section class="section"><h2>${esc(title)}</h2><div class="grid">${items.join('')}</div></section>`
  : '');

function trackList(tracks, { context, list, start = 0, showAlbum = true, showArt = true }) {
  return tracks.map((t, i) => {
    const ctx = typeof context === 'function' ? context(t) : context;
    const n = start + i;
    return `<div class="track" data-focus data-key="t:${esc(t.uri)}:${n}" data-action="play-track"${dataAttrs({ uri: t.uri, context: ctx, list, index: list ? n : undefined })}>
      <div class="track-num"><span>${n + 1}</span><span class="eq"><i></i><i></i><i></i></span></div>
      ${showArt ? `<div class="track-art">${art(t.album?.images, 64)}</div>` : ''}
      <div class="track-main">
        <div class="track-title">${esc(t.name)}</div>
        <div class="track-artist">${t.explicit ? '<span class="explicit">E</span>' : ''}${esc(artistsText(t.artists))}</div>
      </div>
      ${showAlbum ? `<div class="track-album">${esc(t.album?.name || '')}</div>` : ''}
      <div class="track-dur">${fmtTime(t.duration_ms)}</div>
    </div>`;
  }).join('');
}

const moreButton = () => '<div class="btn more" data-focus data-action="more">Carregar mais</div>';

function playButtons({ uri, list, total, shuffle = true }) {
  const d = dataAttrs({ uri, list, total });
  return `<div class="btn primary" data-focus data-autofocus data-key="play" data-action="play-context"${d}>${icon('play')}<span>Tocar</span></div>`
    + (shuffle ? `<div class="btn" data-focus data-key="shuffle" data-action="play-context" data-shuffle="1"${d}>${icon('shuffle')}<span>Aleatório</span></div>` : '');
}

function hero({ images, artHtml, eyebrow, title, desc, meta = [], actions = '', round = false }) {
  return `<header class="hero">
    <div class="hero-art${round ? ' round' : ''}">${artHtml || art(images, 640, round ? 'person' : 'note')}</div>
    <div class="hero-info">
      <div class="eyebrow">${esc(eyebrow)}</div>
      <h1>${esc(title)}</h1>
      ${desc ? `<p class="hero-desc">${esc(desc)}</p>` : ''}
      <div class="hero-meta">${meta.filter(Boolean).map(esc).join(' · ')}</div>
      <div class="hero-actions">${actions}</div>
    </div>
  </header>`;
}

const page = (inner, cls = '') => `<div class="view view-scroll ${cls}">${inner}</div>`;

const value = (r) => (r.status === 'fulfilled' ? r.value : null);

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Boa noite' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

// Playlists novas usam `items`/`item`; as antigas, `tracks`/`track`.
const playlistTracks = (pageObj) =>
  (pageObj?.items || []).map((e) => e?.item || e?.track).filter((t) => t?.uri && !t.is_local);

// ---- Telas -------------------------------------------------------------

async function home(el, { me, isStale }) {
  const r = await Promise.allSettled([S.recent(), S.playlists(), S.topArtists(), S.topTracks(), S.savedAlbums()]);
  if (isStale()) return;
  const seen = new Set();
  const recent = (value(r[0])?.items || [])
    .filter((i) => i.track && !seen.has(i.track.id) && seen.add(i.track.id))
    .map((i) => trackCard(i.track, i.context?.uri));
  const playlists = [likedCard(), ...(value(r[1])?.items || []).filter(Boolean).slice(0, 30).map(playlistCard)];
  const artists = (value(r[2])?.items || []).map(artistCard);
  const tops = (value(r[3])?.items || []).map((t) => trackCard(t));
  const albums = (value(r[4])?.items || []).map((i) => i.album).filter(Boolean).map(albumCard);
  const name = me?.display_name?.split(' ')[0];
  el.innerHTML = page(`
    <h1 class="greeting">${greeting()}${name ? `, ${esc(name)}` : ''}</h1>
    ${row('Tocadas recentemente', recent)}
    ${row('Suas playlists', playlists)}
    ${row('Seus artistas do momento', artists)}
    ${row('Suas mais ouvidas', tops)}
    ${row('Álbuns salvos', albums)}
  `);
}

async function library(el, { isStale }) {
  const allPlaylists = async () => {
    const out = [];
    for (let offset = 0; offset < 200; offset += 50) {
      const p = await S.playlists(offset);
      out.push(...(p.items || []).filter(Boolean));
      if (!p.next) break;
    }
    return out;
  };
  const r = await Promise.allSettled([allPlaylists(), S.savedAlbums(), S.followedArtists()]);
  if (isStale()) return;
  el.innerHTML = page(`
    <h1>Sua biblioteca</h1>
    ${grid('Playlists', [likedCard(), ...(value(r[0]) || []).map(playlistCard)])}
    ${grid('Álbuns', (value(r[1])?.items || []).map((i) => i.album).filter(Boolean).map(albumCard))}
    ${grid('Artistas que você segue', (value(r[2])?.artists?.items || []).map(artistCard))}
  `);
}

async function liked(el, { me, isStale }) {
  const first = await S.savedTracks(0);
  if (isStale()) return;
  const tracks = first.items.map((i) => i.track).filter(Boolean);
  lists.set('liked', tracks.map((t) => t.uri));
  const ctx = me ? `spotify:user:${me.id}:collection` : '';
  let offset = first.items.length;
  let hasMore = !!first.next;
  moreFn = async () => {
    const p = await S.savedTracks(offset);
    const more = p.items.map((i) => i.track).filter(Boolean);
    const html = trackList(more, { context: ctx, list: 'liked', start: lists.get('liked').length });
    lists.get('liked').push(...more.map((t) => t.uri));
    offset += p.items.length;
    hasMore = !!p.next;
    return { html, done: !hasMore };
  };
  el.innerHTML = page(`
    ${hero({
      artHtml: `<div class="liked-art">${icon('heart')}</div>`,
      eyebrow: 'Playlist', title: 'Músicas curtidas', meta: [`${first.total} músicas`],
      actions: playButtons({ uri: ctx, list: 'liked', total: first.total }),
    })}
    <div class="tracks">${trackList(tracks, { context: ctx, list: 'liked' })}${hasMore ? moreButton() : ''}</div>
  `);
}

async function playlist(el, { params, isStale }) {
  const p = await S.playlist(params.id);
  if (isStale()) return;
  const pg = p.items || p.tracks;
  const tracks = playlistTracks(pg);
  const total = pg?.total ?? 0;
  let offset = pg?.items?.length || 0;
  moreFn = async () => {
    const next = await S.playlistItems(p.id, offset);
    const more = playlistTracks(next);
    const html = trackList(more, { context: p.uri, start: offset });
    offset += next.items?.length || 0;
    return { html, done: !next.next };
  };
  const body = tracks.length
    ? `<div class="tracks">${trackList(tracks, { context: p.uri })}${pg?.next ? moreButton() : ''}</div>`
    : `<p class="note">O Spotify só mostra as faixas de playlists que você criou ou colabora — esta você pode tocar normalmente pelos botões acima.</p>`;
  el.innerHTML = page(`
    ${hero({
      images: p.images, eyebrow: 'Playlist', title: p.name, desc: stripHtml(p.description),
      meta: [p.owner?.display_name, total ? `${total} músicas` : ''],
      actions: playButtons({ uri: p.uri, total }),
    })}
    ${body}
  `);
}

async function album(el, { params, isStale }) {
  const a = await S.album(params.id);
  if (isStale()) return;
  const tracks = (a.tracks?.items || []).map((t) => ({ ...t, album: a }));
  const mainArtist = a.artists?.[0];
  el.innerHTML = page(`
    ${hero({
      images: a.images, eyebrow: a.album_type === 'single' ? 'Single' : 'Álbum', title: a.name,
      meta: [artistsText(a.artists), a.release_date?.slice(0, 4), `${a.total_tracks} músicas`],
      actions: playButtons({ uri: a.uri, total: a.total_tracks })
        + (mainArtist ? `<div class="btn" data-focus data-action="open" data-type="artist" data-id="${esc(mainArtist.id)}">${icon('person')}<span>${esc(mainArtist.name)}</span></div>` : ''),
    })}
    <div class="tracks">${trackList(tracks, { context: a.uri, showArt: false, showAlbum: false })}</div>
  `);
}

async function artist(el, { params, isStale }) {
  const [a, albums] = await Promise.all([S.artist(params.id), S.artistAlbums(params.id).catch(() => null)]);
  // "Top tracks" saiu da API em 2026; a busca por artista devolve as mais populares.
  const songs = await S.search(`artist:"${a.name}"`, 'track')
    .then((r) => r.tracks.items.filter((t) => t.artists.some((x) => x.id === a.id)))
    .catch(() => []);
  if (isStale()) return;
  const items = albums?.items || [];
  el.innerHTML = page(`
    ${hero({
      images: a.images, round: true, eyebrow: 'Artista', title: a.name,
      meta: [(a.genres || []).slice(0, 3).join(', ')],
      actions: playButtons({ uri: a.uri, shuffle: false }),
    })}
    ${songs.length ? `<section class="section"><h2>Populares</h2><div class="tracks">${trackList(songs, { context: (t) => t.album?.uri })}</div></section>` : ''}
    ${row('Álbuns', items.filter((x) => x.album_type === 'album').map(albumCard))}
    ${row('Singles e EPs', items.filter((x) => x.album_type !== 'album').map(albumCard))}
  `);
}

// ---- Busca com teclado na tela ----------------------------------------

let query = '';
let searchSeq = 0;
let searchTimer;

const KEYS = 'abcdefghijklmnopqrstuvwxyz1234567890'.split('');

async function search(el) {
  el.innerHTML = `<div class="view search-view">
    <div class="search-left">
      <div class="search-box">${icon('search')}<span id="q"></span><span class="caret"></span></div>
      <div class="kbd">
        ${KEYS.map((k, i) => `<div class="key" data-focus${i === 0 ? ' data-autofocus' : ''} data-key="k-${k}" data-action="key" data-char="${k}">${k}</div>`).join('')}
        <div class="key wide3" data-focus data-key="k-space" data-action="key" data-char="space">espaço</div>
        <div class="key" data-focus data-key="k-del" data-action="key" data-char="del">${icon('backspace')}</div>
        <div class="key wide2" data-focus data-key="k-clear" data-action="key" data-char="clear">limpar</div>
      </div>
      <p class="hint">Dica: dá para digitar com um teclado USB também.</p>
    </div>
    <div class="search-results view-scroll" id="results"></div>
  </div>`;
  renderQuery();
  runSearch();
}

function renderQuery() {
  const q = document.getElementById('q');
  if (q) q.innerHTML = query ? esc(query) : '<span class="muted">O que você quer ouvir?</span>';
}

export function searchKey(ch) {
  if (ch === 'space') query += ' ';
  else if (ch === 'del') query = query.slice(0, -1);
  else if (ch === 'clear') query = '';
  else query += ch;
  renderQuery();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 450);
}

async function runSearch() {
  const out = document.getElementById('results');
  if (!out) return;
  const q = query.trim();
  const seq = ++searchSeq;
  if (q.length < 2) {
    out.innerHTML = '<div class="empty-state">Use o teclado ao lado para buscar músicas, artistas, álbuns e playlists.</div>';
    return;
  }
  out.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const r = await S.search(q);
    if (seq !== searchSeq) return;
    const tracks = r.tracks?.items?.filter(Boolean) || [];
    const html = [
      tracks.length ? `<section class="section"><h2>Músicas</h2><div class="tracks">${trackList(tracks, { context: (t) => t.album?.uri, showAlbum: false })}</div></section>` : '',
      row('Artistas', (r.artists?.items || []).filter(Boolean).map(artistCard)),
      row('Álbuns', (r.albums?.items || []).filter(Boolean).map(albumCard)),
      row('Playlists', (r.playlists?.items || []).filter(Boolean).map(playlistCard)),
    ].join('');
    out.innerHTML = html || `<div class="empty-state">Nada encontrado para “${esc(q)}”.</div>`;
    out.scrollTop = 0;
  } catch (e) {
    if (seq === searchSeq) out.innerHTML = `<div class="empty-state">Erro na busca: ${esc(e.message)}</div>`;
  }
}

// ---- Dispositivos ------------------------------------------------------

const DEVICE_ICONS = { computer: 'computer', smartphone: 'phone', tv: 'tv', castvideo: 'tv' };
export const deviceIcon = (type) => DEVICE_ICONS[String(type).toLowerCase()] || 'speaker';

async function devices(el, { isStale }) {
  const [d, drm] = await Promise.all([S.devices().catch(() => ({ devices: [] })), drmCheck()]);
  if (isStale()) return;
  const activeId = P.state?.device?.id;
  const others = (d.devices || []).filter((x) => x.id !== P.deviceId);
  const tile = ({ id, name, sub, type, active, disabled }) =>
    `<div class="device${active ? ' active' : ''}${disabled ? ' disabled' : ''}" data-focus data-key="dev-${esc(id)}" data-action="transfer" data-id="${esc(id)}">
      ${icon(deviceIcon(type))}
      <div><div class="device-name">${esc(name)}</div><div class="device-sub">${esc(sub)}</div></div>
    </div>`;
  const diag = [
    ['Player da TV', sdkLabel()],
    ['DRM', drm],
    ['ID na rede Spotify', P.deviceId || '—'],
    ['Tela', `${innerWidth}×${innerHeight} @${devicePixelRatio}x`],
    ['Navegador', navigator.userAgent],
  ];
  el.innerHTML = page(`
    <h1>Dispositivos</h1>
    <p class="lead">Escolha onde a música toca. O controle remoto da TV continua comandando tudo.</p>
    <div class="devices">
      ${tile({ id: 'local', name: 'Esta TV', type: 'tv', sub: sdkLabel(), active: !!P.deviceId && activeId === P.deviceId, disabled: !P.deviceId })}
      ${others.map((x) => tile({ id: x.id, name: x.name, type: x.type, sub: x.is_active ? 'Ativo agora' : x.type, active: x.id === activeId })).join('')}
    </div>
    ${others.length ? '' : '<p class="note">Abra o Spotify no celular ou no computador para ele aparecer aqui.</p>'}
    <div class="actions-row">
      <div class="btn" data-focus data-action="nav" data-view="devices">${icon('refresh')}<span>Atualizar</span></div>
      <div class="btn" data-focus data-action="logout">${icon('logout')}<span>Sair da conta</span></div>
    </div>
    <h2>Diagnóstico</h2>
    <dl class="diag">${diag.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
  `);
}

export async function loadMore() {
  const btn = document.querySelector('#content [data-action="more"]');
  if (!btn || !moreFn || btn.dataset.busy) return;
  btn.dataset.busy = '1';
  btn.textContent = 'Carregando…';
  try {
    const { html, done } = await moreFn();
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const nodes = [...tpl.content.children];
    btn.before(...nodes);
    if (done) btn.remove();
    if (nodes[0]) focus(nodes[0]);
  } finally {
    if (btn.isConnected) { delete btn.dataset.busy; btn.textContent = 'Carregar mais'; }
  }
}

export const views = { home, search, library, liked, playlist, album, artist, devices };
