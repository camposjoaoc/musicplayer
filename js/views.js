import { S } from './api.js';
import { focus } from './nav.js';
import { P, drmCheck, sdkLabel } from './player.js';
import { artistsText, colorOf, esc, fmtTime, icon, pickImage, store, stripHtml } from './util.js';

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
    <div class="card-art">${art(images, 300, kind)}<span class="card-badge"><span class="eq"><i></i><i></i><i></i></span></span></div>
    <div class="card-title">${esc(title)}</div>
    <div class="card-sub">${esc(sub || '')}</div>
  </div>`;
}

const playlistCard = (p) => card({
  key: p.uri, images: p.images, title: p.name,
  sub: p.owner?.display_name ? `De ${p.owner.display_name}` : 'Playlist',
  action: 'open',
  // nome/capa vão junto: se a API recusar os detalhes, a página ainda abre
  data: { type: 'playlist', id: p.id, name: p.name, img: pickImage(p.images, 640), owner: p.owner?.display_name },
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

const showCard = (sh) => card({
  key: sh.uri, images: sh.images, title: sh.name, sub: sh.publisher || 'Podcast',
  action: 'open', data: { type: 'show', id: sh.id },
});

const audiobookCard = (b) => card({
  key: b.uri, images: b.images, title: b.name, sub: (b.authors || []).map((a) => a.name).join(', ') || 'Audiolivro',
  action: 'open', data: { type: 'audiobook', id: b.id },
});

// Contexto de artista não aceita offset; nesse caso toca a partir do álbum.
const contextFor = (t, ctx) => (ctx && !ctx.includes(':artist:') ? ctx : t.album?.uri);

const trackCard = (t, ctx) => card({
  key: `card:${t.uri}`, images: t.album?.images, title: t.name, sub: artistsText(t.artists),
  action: 'play-track', data: { uri: t.uri, context: contextFor(t, ctx) },
});

const likedCard = () => `<div class="card" data-focus data-key="liked" data-action="open" data-type="liked">
    <div class="card-art"><div class="liked-art">${icon('heart')}</div><span class="card-badge"><span class="eq"><i></i><i></i><i></i></span></span></div>
    <div class="card-title">Músicas curtidas</div>
    <div class="card-sub">Sua biblioteca</div>
  </div>`;

const row = (title, items) => (items.length
  ? `<section class="row"><h2>${esc(title)}</h2><div class="row-track" data-nav-row>${items.join('')}</div></section>`
  : '');

const grid = (title, items) => (items.length
  ? `<section class="section"><h2>${esc(title)}</h2><div class="grid">${items.join('')}</div></section>`
  : '');

// Botão "⋯" ao lado de cada faixa/episódio: abre o menu de ações (fila, playlist, curtir…)
const idOf = (uri) => uri?.split(':')[2];
const moreBtn = (key, d) => `<div class="track-more" data-focus data-key="m:${esc(key)}" data-action="track-menu"${dataAttrs(d)}>${icon('more')}</div>`;

// `popularity` (0–100) e `followers` estão marcados como descontinuados na API:
// só aparecem enquanto o Spotify continuar mandando.
const popMeter = (p) => (typeof p === 'number'
  ? `<span class="pop" title="Popularidade ${p}/100"><i style="width:${Math.max(4, Math.min(100, p))}%"></i></span>` : '');

const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const followersText = (f) => (typeof f?.total === 'number' && f.total > 0
  ? `${compact.format(f.total)} ${f.total === 1 ? 'seguidor' : 'de seguidores'}` : '');

function trackList(tracks, { context, list, start = 0, showAlbum = true, showArt = true, showPop = false }) {
  return tracks.map((t, i) => {
    const ctx = typeof context === 'function' ? context(t) : context;
    const n = start + i;
    const menu = { uri: t.uri, name: t.name, sub: artistsText(t.artists), album: t.album?.id, artist: t.artists?.[0]?.id, type: 'track' };
    return `<div class="track-row"><div class="track" data-focus data-key="t:${esc(t.uri)}:${n}" data-action="play-track"${dataAttrs({ uri: t.uri, context: ctx, list, index: list ? n : undefined })}>
      <div class="track-num"><span>${n + 1}</span><span class="eq"><i></i><i></i><i></i></span></div>
      ${showArt ? `<div class="track-art">${art(t.album?.images, 64)}</div>` : ''}
      <div class="track-main">
        <div class="track-title">${esc(t.name)}</div>
        <div class="track-artist">${t.explicit ? '<span class="explicit">E</span>' : ''}${esc(artistsText(t.artists))}${showPop ? popMeter(t.popularity) : ''}</div>
      </div>
      ${showAlbum ? `<div class="track-album">${esc(t.album?.name || '')}</div>` : ''}
      <div class="track-dur">${fmtTime(t.duration_ms)}</div>
    </div>${moreBtn(`${t.uri}:${n}`, menu)}</div>`;
  }).join('');
}

// Episódios de podcast e capítulos de audiolivro
function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(`${d}T12:00:00`);
  if (Number.isNaN(dt.getTime())) return d;
  const sameYear = dt.getFullYear() === new Date().getFullYear();
  return dt.toLocaleDateString('pt-BR', sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

function progressInfo(e) {
  const rp = e.resume_point;
  if (rp?.fully_played) return { label: 'Ouvido', frac: 1 };
  if (rp?.resume_position_ms > 0 && e.duration_ms) {
    const left = Math.max(1, Math.round((e.duration_ms - rp.resume_position_ms) / 60000));
    return { label: `Faltam ${left} min`, frac: rp.resume_position_ms / e.duration_ms };
  }
  return null;
}

function episodeList(items, { context, showArt = true, chapters = false } = {}) {
  return items.map((e, i) => {
    const ctx = context || e.show?.uri;
    const prog = progressInfo(e);
    const meta = [
      chapters ? `Capítulo ${e.chapter_number ?? i + 1}` : fmtDate(e.release_date),
      `${Math.max(1, Math.round((e.duration_ms || 0) / 60000))} min`,
      prog?.label,
    ].filter(Boolean).join(' · ');
    const menu = { uri: e.uri, name: e.name, sub: e.show?.name || '', show: e.show?.id, type: chapters ? 'chapter' : 'episode' };
    return `<div class="track-row"><div class="track episode" data-focus data-key="e:${esc(e.uri)}" data-action="play-track"${dataAttrs({ uri: e.uri, context: ctx })}>
      ${showArt ? `<div class="track-art">${art(e.images || e.show?.images, 64)}</div>` : `<div class="track-num"><span>${i + 1}</span><span class="eq"><i></i><i></i><i></i></span></div>`}
      <div class="track-main">
        <div class="track-title">${esc(e.name)}</div>
        <div class="track-artist">${showArt && e.show?.name ? `${esc(e.show.name)} · ` : ''}${esc(meta)}</div>
        ${prog && prog.frac < 1 ? `<div class="ep-progress"><i style="width:${Math.round(prog.frac * 100)}%"></i></div>` : ''}
      </div>
      <div class="track-dur">${fmtTime(e.duration_ms)}</div>
    </div>${chapters ? '' : moreBtn(e.uri, menu)}</div>`;
  }).join('');
}

// Salvar álbum / seguir playlist ou podcast / salvar audiolivro (biblioteca genérica)
const SAVE_LABELS = { album: ['Salvar', 'Salvo'], playlist: ['Seguir', 'Seguindo'], show: ['Seguir', 'Seguindo'], audiobook: ['Salvar', 'Salvo'] };
const saveButton = (uri, kind) =>
  `<div class="btn save-btn" data-focus data-key="save" data-action="lib-toggle" data-uri="${esc(uri)}" data-kind="${kind}">${icon('plus')}<span>${SAVE_LABELS[kind][0]}</span></div>`;

export function setSaveState(btn, on) {
  btn.dataset.on = on ? '1' : '';
  btn.classList.toggle('on', on);
  btn.innerHTML = `${icon(on ? 'check' : 'plus')}<span>${SAVE_LABELS[btn.dataset.kind][on ? 1 : 0]}</span>`;
}

async function syncSaveButtons(root) {
  const btns = [...root.querySelectorAll('.save-btn')];
  if (!btns.length) return;
  try {
    const r = await S.libContains(btns.map((b) => b.dataset.uri));
    btns.forEach((b, i) => setSaveState(b, !!r?.[i]));
  } catch {}
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

// Destaque "Continuar ouvindo": o que está tocando agora ou a última faixa ouvida
function homeHero(track, context, isCurrent) {
  if (!track) return '';
  const ctx = contextFor(track, context);
  const albumId = track.album?.uri?.split(':')[2];
  return `<section class="home-hero">
    <div class="home-hero-bg"></div>
    <div class="home-hero-art">${art(track.album?.images, 640)}</div>
    <div class="home-hero-info">
      <div class="eyebrow">${isCurrent ? 'Tocando agora' : 'Continuar ouvindo'}</div>
      <h2 class="home-hero-title">${esc(track.name)}</h2>
      <div class="home-hero-sub">${esc(artistsText(track.artists))}${track.album?.name ? ` · ${esc(track.album.name)}` : ''}</div>
      <div class="hero-actions">
        <div class="btn primary" data-focus data-autofocus data-key="hero-play" data-action="resume"${dataAttrs({ uri: track.uri, context: ctx })}>${icon('play')}<span>${isCurrent ? 'Abrir player' : 'Continuar'}</span></div>
        ${albumId ? `<div class="btn" data-focus data-key="hero-album" data-action="open" data-type="album" data-id="${esc(albumId)}">${icon('album')}<span>Ver álbum</span></div>` : ''}
      </div>
    </div>
  </section>`;
}

const RANGES = [['short_term', '4 semanas'], ['medium_term', '6 meses'], ['long_term', 'Sempre']];
let topRange = store.get('spotv.topRange', 'short_term');

const topsBody = (artists, tracks) =>
  row('Artistas', (artists || []).map(artistCard)) + row('Músicas', (tracks || []).map((t) => trackCard(t)));

const topsSection = (artists, tracks) => `<section class="tops">
    <div class="tops-head"><h2>Seus favoritos</h2>
      <div class="chips">${RANGES.map(([v, l]) => `<div class="chip${v === topRange ? ' on' : ''}" data-focus data-key="range-${v}" data-action="top-range" data-range="${v}">${l}</div>`).join('')}</div>
    </div>
    <div id="tops-body">${topsBody(artists, tracks)}</div>
  </section>`;

export async function setTopRange(range) {
  topRange = range;
  store.set('spotv.topRange', range);
  document.querySelectorAll('.chip[data-range]').forEach((c) => c.classList.toggle('on', c.dataset.range === range));
  const [a, t] = await Promise.allSettled([S.topArtists(range), S.topTracks(range)]);
  const body = document.getElementById('tops-body');
  if (body && topRange === range) body.innerHTML = topsBody(value(a)?.items, value(t)?.items);
}

async function home(el, { me, isStale }) {
  const r = await Promise.allSettled([S.recent(), S.playlists(), S.topArtists(topRange), S.topTracks(topRange), S.savedAlbums()]);
  if (isStale()) return;
  const seen = new Set();
  const recentItems = (value(r[0])?.items || []).filter((i) => i.track && !seen.has(i.track.id) && seen.add(i.track.id));
  const recent = recentItems.map((i) => trackCard(i.track, i.context?.uri));
  const playlists = [likedCard(), ...(value(r[1])?.items || []).filter(Boolean).slice(0, 30).map(playlistCard)];
  const albums = (value(r[4])?.items || []).map((i) => i.album).filter(Boolean).map(albumCard);
  const name = me?.display_name?.split(' ')[0];

  const current = P.state?.track?.album?.images?.length ? P.state : null;
  const heroTrack = current?.track || recentItems[0]?.track;
  const heroCtx = current ? current.contextUri : recentItems[0]?.context?.uri;

  el.innerHTML = page(`
    <h1 class="greeting">${greeting()}${name ? `, ${esc(name)}` : ''}</h1>
    ${homeHero(heroTrack, heroCtx, !!current?.isPlaying)}
    ${row('Tocadas recentemente', recent)}
    ${row('Suas playlists', playlists)}
    ${topsSection(value(r[2])?.items, value(r[3])?.items)}
    ${row('Álbuns salvos', albums)}
  `);
  colorOf(pickImage(heroTrack?.album?.images, 64)).then((rgb) => {
    if (rgb) el.querySelector('.home-hero')?.style.setProperty('--hero-rgb', rgb.join(','));
  });
}

export async function allPlaylists() {
  const out = [];
  for (let offset = 0; offset < 200; offset += 50) {
    const p = await S.playlists(offset);
    out.push(...(p.items || []).filter(Boolean));
    if (!p.next) break;
  }
  return out;
}

async function library(el, { isStale }) {
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

// Playlists do próprio Spotify (Daily Mix, Descobertas da Semana, editoriais…) não são
// liberadas pela API para apps criados depois de nov/2024: mostramos o que veio do card
// e deixamos tocar pelo contexto, que é resolvido pelo player.
function blockedPlaylist(el, params) {
  const uri = `spotify:playlist:${params.id}`;
  el.innerHTML = page(`
    ${hero({
      images: params.img ? [{ url: params.img, width: 640 }] : [],
      eyebrow: 'Playlist', title: params.name || 'Playlist', meta: [params.owner],
      actions: playButtons({ uri }),
    })}
    <p class="note">O Spotify não libera os detalhes das playlists feitas por ele (Daily Mix, Descobertas da Semana, “This Is”, editoriais) para apps de desenvolvedores. Tente tocar mesmo assim pelos botões acima.</p>
  `);
}

async function playlist(el, { params, me, isStale }) {
  let p;
  try {
    p = await S.playlist(params.id);
  } catch (e) {
    if (isStale()) return;
    if (e.status === 404 || e.status === 403) return blockedPlaylist(el, params);
    throw e;
  }
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
      actions: playButtons({ uri: p.uri, total }) + (p.owner?.id && p.owner.id !== me?.id ? saveButton(p.uri, 'playlist') : ''),
    })}
    ${body}
  `);
  syncSaveButtons(el);
}

async function album(el, { params, isStale }) {
  const a = await S.album(params.id);
  if (isStale()) return;
  const tracks = (a.tracks?.items || []).map((t) => ({ ...t, album: a }));
  const mainArtist = a.artists?.[0];
  let offset = tracks.length;
  moreFn = async () => {
    const next = await S.albumTracks(a.id, offset);
    const more = (next.items || []).map((t) => ({ ...t, album: a }));
    const html = trackList(more, { context: a.uri, start: offset, showArt: false, showAlbum: false });
    offset += more.length;
    return { html, done: !next.next };
  };
  el.innerHTML = page(`
    ${hero({
      images: a.images, eyebrow: a.album_type === 'single' ? 'Single' : 'Álbum', title: a.name,
      meta: [artistsText(a.artists), a.release_date?.slice(0, 4), `${a.total_tracks} músicas`],
      actions: playButtons({ uri: a.uri, total: a.total_tracks }) + saveButton(a.uri, 'album')
        + (mainArtist ? `<div class="btn" data-focus data-action="open" data-type="artist" data-id="${esc(mainArtist.id)}">${icon('person')}<span>${esc(mainArtist.name)}</span></div>` : ''),
    })}
    <div class="tracks">${trackList(tracks, { context: a.uri, showArt: false, showAlbum: false })}${a.tracks?.next ? moreButton() : ''}</div>
  `);
  syncSaveButtons(el);
}

// ---- Podcasts e audiolivros ------------------------------------------------

async function podcasts(el, { isStale }) {
  const r = await Promise.allSettled([S.shows(), S.savedEpisodes(), S.audiobooks()]);
  if (isStale()) return;
  const shows = (value(r[0])?.items || []).map((i) => i.show).filter(Boolean);
  const episodes = (value(r[1])?.items || []).map((i) => i.episode).filter(Boolean);
  const books = (value(r[2])?.items || []).map((i) => i.audiobook || i).filter((b) => b?.id);
  const empty = !shows.length && !episodes.length && !books.length;
  el.innerHTML = page(`
    <h1>Podcasts e audiolivros</h1>
    ${row('Seus podcasts', shows.map(showCard))}
    ${episodes.length ? `<section class="section"><h2>Episódios salvos</h2><div class="tracks">${episodeList(episodes)}</div></section>` : ''}
    ${row('Seus audiolivros', books.map(audiobookCard))}
    ${empty ? '<p class="note">Você ainda não segue nenhum podcast. Use a Busca para encontrar e seguir os seus favoritos.</p>' : ''}
  `);
}

async function show(el, { params, isStale }) {
  const sh = await S.show(params.id);
  if (isStale()) return;
  const eps = (sh.episodes?.items || []).filter(Boolean).map((e) => ({ ...e, show: sh }));
  let offset = sh.episodes?.items?.length || 0;
  moreFn = async () => {
    const next = await S.showEpisodes(sh.id, offset);
    const more = (next.items || []).filter(Boolean).map((e) => ({ ...e, show: sh }));
    offset += next.items?.length || 0;
    return { html: episodeList(more, { context: sh.uri, showArt: false }), done: !next.next };
  };
  const latest = eps[0];
  el.innerHTML = page(`
    ${hero({
      images: sh.images, eyebrow: 'Podcast', title: sh.name, desc: stripHtml(sh.description),
      meta: [sh.publisher, sh.total_episodes ? `${sh.total_episodes} episódios` : ''],
      actions: (latest ? `<div class="btn primary" data-focus data-autofocus data-key="play" data-action="play-track"${dataAttrs({ uri: latest.uri, context: sh.uri })}>${icon('play')}<span>Episódio mais recente</span></div>` : '')
        + saveButton(sh.uri, 'show'),
    })}
    <div class="tracks">${episodeList(eps, { context: sh.uri, showArt: false })}${sh.episodes?.next ? moreButton() : ''}</div>
  `);
  syncSaveButtons(el);
}

async function audiobook(el, { params, isStale }) {
  const b = await S.audiobook(params.id);
  if (isStale()) return;
  const chapters = (b.chapters?.items || []).filter(Boolean);
  let offset = chapters.length;
  moreFn = async () => {
    const next = await S.audiobookChapters(b.id, offset);
    const more = (next.items || []).filter(Boolean);
    offset += more.length;
    return { html: episodeList(more, { context: b.uri, showArt: false, chapters: true }), done: !next.next };
  };
  el.innerHTML = page(`
    ${hero({
      images: b.images, eyebrow: 'Audiolivro', title: b.name, desc: stripHtml(b.description),
      meta: [(b.authors || []).map((a) => a.name).join(', '), (b.narrators || []).length ? `Narração: ${b.narrators.map((n) => n.name).join(', ')}` : '', b.total_chapters ? `${b.total_chapters} capítulos` : ''],
      actions: playButtons({ uri: b.uri, shuffle: false }) + saveButton(b.uri, 'audiobook'),
    })}
    <div class="tracks">${episodeList(chapters, { context: b.uri, showArt: false, chapters: true })}${b.chapters?.next ? moreButton() : ''}</div>
  `);
  syncSaveButtons(el);
}

// Junta até `max` páginas de 10 (limite do endpoint de álbuns do artista)
async function pagesOf(fetchPage, max = 3) {
  const out = [];
  for (let i = 0; i < max; i++) {
    const p = await fetchPage(i * 10);
    out.push(...(p.items || []).filter(Boolean));
    if (!p.next) break;
  }
  return out;
}

const newestFirst = (list) => [...list].sort((x, y) => (y.release_date || '').localeCompare(x.release_date || ''));

async function artist(el, { params, isStale }) {
  const groups = ['album', 'single', 'appears_on'].map((g) => pagesOf((offset) => S.artistAlbums(params.id, g, offset)));
  const [a, ...albumResults] = await Promise.all([S.artist(params.id), ...groups.map((p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e })))]);
  // "Top tracks" saiu da API em 2026; a busca por artista devolve as mais populares.
  const songs = await S.search(`artist:"${a.name}"`, 'track')
    .then((r) => r.tracks.items.filter((t) => t.artists.some((x) => x.id === a.id)))
    .catch(() => []);
  if (isStale()) return;
  const [albumsR, singlesR, appearsR] = albumResults;
  const failed = albumResults.every((r) => !r.ok);
  el.innerHTML = page(`
    ${hero({
      images: a.images, round: true, eyebrow: 'Artista', title: a.name,
      meta: [followersText(a.followers), (a.genres || []).slice(0, 3).join(', ')],
      actions: playButtons({ uri: a.uri, shuffle: false }),
    })}
    ${songs.length ? `<section class="section"><h2>Populares</h2><div class="tracks">${trackList(songs, { context: (t) => t.album?.uri, showPop: true })}</div></section>` : ''}
    ${row('Álbuns', newestFirst(albumsR.ok ? albumsR.v : []).map(albumCard))}
    ${row('Singles e EPs', newestFirst(singlesR.ok ? singlesR.v : []).map(albumCard))}
    ${row('Aparece em', newestFirst(appearsR.ok ? appearsR.v : []).map(albumCard))}
    ${failed ? `<p class="note">Não foi possível carregar os álbuns: ${esc(albumResults[0].e?.message || 'erro')}.</p>` : ''}
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
    out.innerHTML = '<div class="empty-state">Use o teclado ao lado para buscar músicas, artistas, álbuns, playlists, podcasts e audiolivros.</div>';
    return;
  }
  out.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    // Em países sem audiolivros o tipo "audiobook" pode ser recusado: tenta sem ele
    const r = await S.search(q).catch((e) => {
      if (e.status === 400) return S.search(q, 'track,artist,album,playlist,show,episode');
      throw e;
    });
    if (seq !== searchSeq) return;
    const tracks = r.tracks?.items?.filter(Boolean) || [];
    const html = [
      tracks.length ? `<section class="section"><h2>Músicas</h2><div class="tracks">${trackList(tracks, { context: (t) => t.album?.uri, showAlbum: false, showPop: true })}</div></section>` : '',
      row('Artistas', (r.artists?.items || []).filter(Boolean).map(artistCard)),
      row('Álbuns', (r.albums?.items || []).filter(Boolean).map(albumCard)),
      row('Playlists', (r.playlists?.items || []).filter(Boolean).map(playlistCard)),
      row('Podcasts', (r.shows?.items || []).filter(Boolean).map(showCard)),
      (r.episodes?.items || []).filter(Boolean).length
        ? `<section class="section"><h2>Episódios</h2><div class="tracks">${episodeList(r.episodes.items.filter(Boolean).slice(0, 5))}</div></section>` : '',
      row('Audiolivros', (r.audiobooks?.items || []).filter(Boolean).map(audiobookCard)),
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
    const first = nodes.map((n) => (n.matches('[data-focus]') ? n : n.querySelector('[data-focus]'))).find(Boolean);
    if (first) focus(first);
  } finally {
    if (btn.isConnected) { delete btn.dataset.busy; btn.textContent = 'Carregar mais'; }
  }
}

// ---- Esqueletos de carregamento -----------------------------------------

const skCards = (n, round = false) => Array.from({ length: n }, () =>
  `<div class="card sk-card${round ? ' round' : ''}"><div class="card-art sk"></div><div class="sk sk-line"></div><div class="sk sk-line short"></div></div>`).join('');
const skRow = (round) => `<section class="row"><div class="sk sk-title"></div><div class="row-track">${skCards(8, round)}</div></section>`;
const skTracks = (n) => Array.from({ length: n }, () =>
  `<div class="track sk-track"><div></div><div class="track-art sk"></div><div class="track-main"><div class="sk sk-line"></div><div class="sk sk-line short"></div></div></div>`).join('');
const skHero = (round) => `<header class="hero"><div class="hero-art sk${round ? ' round' : ''}"></div><div class="hero-info"><div class="sk sk-line short"></div><div class="sk sk-h1"></div><div class="sk sk-line"></div><div class="hero-actions"><div class="sk sk-btn"></div><div class="sk sk-btn"></div></div></div></header>`;

const SKELETONS = {
  home: () => `<div class="sk sk-h1 greet"></div><div class="home-hero sk-hero sk"></div>${skRow()}${skRow()}`,
  library: () => `<div class="sk sk-h1"></div><section class="section"><div class="sk sk-title"></div><div class="grid">${skCards(14)}</div></section>`,
  liked: () => skHero() + skTracks(8),
  playlist: () => skHero() + skTracks(8),
  album: () => skHero() + skTracks(8),
  artist: () => skHero(true) + skTracks(5),
  podcasts: () => `<div class="sk sk-h1"></div>${skRow()}${skTracks(5)}`,
  show: () => skHero() + skTracks(8),
  audiobook: () => skHero() + skTracks(8),
};

export function skeleton(name) {
  const fn = SKELETONS[name];
  return fn ? page(fn(), 'is-skeleton') : '<div class="view"><div class="loading"><div class="spinner"></div></div></div>';
}

export const views = { home, search, library, liked, playlist, album, artist, podcasts, show, audiobook, devices };
