// Letras via LRCLIB (https://lrclib.net): banco aberto, sem chave de API.
// A letra do app oficial do Spotify (Musixmatch) não está na API pública.
import { esc } from './util.js';

const BASE = 'https://lrclib.net/api';
const HEADERS = { 'Lrclib-Client': 'spotify-tv (https://github.com/camposjoaoc/spotify-tv)' };
const cache = new Map();

// "Música - Remastered 2011", "Música (feat. X)" → "Música"
const cleanName = (s) => s
  .replace(/\s+-\s+.*(remaster|version|vers[aã]o|mono|stereo|edit|mix|live|ao vivo).*$/i, '')
  .replace(/\s*[([](feat|with|com)\.?\s[^)\]]*[)\]]/i, '')
  .trim();

async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`LRCLIB respondeu ${res.status}`);
  return res.json();
}

function parseLrc(lrc) {
  const lines = [];
  for (const raw of lrc.split('\n')) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) lines.push({ t: (Number(m[1]) * 60 + Number(m[2])) * 1000, text });
  }
  return lines.sort((a, b) => a.t - b.t);
}

function toLyrics(r) {
  if (!r) return null;
  if (r.instrumental) return { instrumental: true };
  const synced = r.syncedLyrics ? parseLrc(r.syncedLyrics) : null;
  if (synced?.length) return { synced };
  if (r.plainLyrics?.trim()) return { plain: r.plainLyrics.trim() };
  return null;
}

async function lookup(track) {
  const artist = track.artists?.[0]?.name || '';
  const secs = Math.round((track.duration || 0) / 1000);
  // 1) Busca exata (nome, artista, álbum e duração)
  let reachable = true;
  const exact = await getJson(`${BASE}/get?${new URLSearchParams({
    track_name: track.name, artist_name: artist, album_name: track.album?.name || '', duration: String(secs),
  })}`).catch(() => { reachable = false; return null; });
  const fromExact = toLyrics(exact);
  if (fromExact) return fromExact;
  // 2) Busca aproximada: prefere letra sincronizada com duração parecida.
  // O LRCLIB às vezes responde 503 quando a busca não tem resultado; se a busca exata
  // respondeu normalmente, o serviço está no ar e tratamos isso como "não encontrada".
  const results = await getJson(`${BASE}/search?${new URLSearchParams({ track_name: cleanName(track.name), artist_name: artist })}`)
    .catch((e) => { if (reachable) return null; throw e; });
  if (!results?.length) return null;
  const close = (r) => !secs || Math.abs((r.duration || 0) - secs) <= 6;
  const best = results.find((r) => r.syncedLyrics && close(r))
    || results.find((r) => r.syncedLyrics)
    || results.find((r) => r.plainLyrics || r.instrumental);
  return toLyrics(best);
}

// Retorna { synced: [{t, text}] } | { plain } | { instrumental } | null (não achou)
export function getLyrics(track) {
  if (!track?.uri) return Promise.resolve(null);
  if (!cache.has(track.uri)) {
    const p = lookup(track).catch((e) => { cache.delete(track.uri); throw e; });
    cache.set(track.uri, p);
    // Guarda só as últimas 100 músicas (Map mantém a ordem de inserção)
    if (cache.size > 100) cache.delete(cache.keys().next().value);
  }
  return cache.get(track.uri);
}

export function renderLines(lyrics) {
  if (lyrics.synced) {
    return lyrics.synced.map((l, i) => `<p class="lyr-line" data-i="${i}">${l.text ? esc(l.text) : '♪'}</p>`).join('');
  }
  return lyrics.plain.split('\n').map((l) => `<p class="lyr-line plain">${l ? esc(l) : '&nbsp;'}</p>`).join('');
}

// Índice da linha que está tocando (a última cujo tempo já passou)
export function activeIndex(synced, posMs) {
  let lo = 0;
  let hi = synced.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (synced[mid].t <= posMs + 250) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}
