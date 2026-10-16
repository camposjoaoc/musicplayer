import { getAccessToken } from './auth.js';
import { LANG_HEADER, sleep } from './util.js';

const BASE = 'https://api.spotify.com/v1';

export async function api(path, { method = 'GET', query, body, retry = true } = {}) {
  const url = new URL(BASE + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }
  const token = await getAccessToken();
  const res = await fetch(url, {
    method,
    headers: { ...LANG_HEADER, Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (retry && res.status === 401) {
    await getAccessToken(true);
    return api(path, { method, query, body, retry: false });
  }
  if (retry && res.status === 429) {
    const wait = Number(res.headers.get('Retry-After')) || 2;
    await sleep(Math.min(wait, 10) * 1000);
    return api(path, { method, query, body, retry: false });
  }

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Erro ${res.status}`);
    err.status = res.status;
    err.reason = data?.error?.reason;
    throw err;
  }
  return data;
}

const csv = (uris) => uris.join(',');

// Endpoints disponíveis para apps em Development Mode (regras de fev/2026)
export const S = {
  me: () => api('/me'),
  recent: () => api('/me/player/recently-played', { query: { limit: 30 } }),
  topArtists: (time_range = 'short_term') => api('/me/top/artists', { query: { limit: 20, time_range } }),
  topTracks: (time_range = 'short_term') => api('/me/top/tracks', { query: { limit: 20, time_range } }),
  playlists: (offset = 0) => api('/me/playlists', { query: { limit: 50, offset } }),
  savedTracks: (offset = 0) => api('/me/tracks', { query: { limit: 50, offset } }),
  savedAlbums: () => api('/me/albums', { query: { limit: 50 } }),
  followedArtists: () => api('/me/following', { query: { type: 'artist', limit: 50 } }),
  search: (q, type = 'track,artist,album,playlist,show,episode,audiobook') => api('/search', { query: { q, type, limit: 10 } }),
  album: (id) => api(`/albums/${id}`),
  albumTracks: (id, offset = 0) => api(`/albums/${id}/tracks`, { query: { limit: 50, offset } }),
  artist: (id) => api(`/artists/${id}`),
  // Máximo de 10 por página desde fev/2026
  artistAlbums: (id, group, offset = 0) => api(`/artists/${id}/albums`, { query: { include_groups: group, limit: 10, offset } }),
  playlist: (id) => api(`/playlists/${id}`),
  playlistItems: (id, offset = 0) => api(`/playlists/${id}/items`, { query: { limit: 50, offset } }),
  addToPlaylist: (id, uris) => api(`/playlists/${id}/items`, { method: 'POST', body: { uris } }),
  createPlaylist: (name, description) => api('/me/playlists', { method: 'POST', body: { name, description, public: false } }),

  // Podcasts e audiolivros
  shows: (offset = 0) => api('/me/shows', { query: { limit: 50, offset } }),
  savedEpisodes: (offset = 0) => api('/me/episodes', { query: { limit: 20, offset } }),
  show: (id) => api(`/shows/${id}`),
  showEpisodes: (id, offset = 0) => api(`/shows/${id}/episodes`, { query: { limit: 50, offset } }),
  audiobooks: () => api('/me/audiobooks', { query: { limit: 50 } }),
  audiobook: (id) => api(`/audiobooks/${id}`),
  audiobookChapters: (id, offset = 0) => api(`/audiobooks/${id}/chapters`, { query: { limit: 50, offset } }),

  state: () => api('/me/player', { query: { additional_types: 'track,episode' } }),
  devices: () => api('/me/player/devices'),
  queue: () => api('/me/player/queue'),
  addToQueue: (uri, device_id) => api('/me/player/queue', { method: 'POST', query: { uri, device_id } }),
  volume: (percent, device_id) => api('/me/player/volume', { method: 'PUT', query: { volume_percent: Math.round(percent), device_id } }),
  transfer: (id, play) => api('/me/player', { method: 'PUT', body: { device_ids: [id], play } }),
  play: (body, device_id) => api('/me/player/play', { method: 'PUT', query: { device_id }, body }),
  pause: (device_id) => api('/me/player/pause', { method: 'PUT', query: { device_id } }),
  next: (device_id) => api('/me/player/next', { method: 'POST', query: { device_id } }),
  previous: (device_id) => api('/me/player/previous', { method: 'POST', query: { device_id } }),
  seek: (ms, device_id) => api('/me/player/seek', { method: 'PUT', query: { position_ms: Math.max(0, Math.round(ms)), device_id } }),
  shuffle: (state, device_id) => api('/me/player/shuffle', { method: 'PUT', query: { state, device_id } }),
  repeat: (state, device_id) => api('/me/player/repeat', { method: 'PUT', query: { state, device_id } }),

  libContains: (uris) => api('/me/library/contains', { query: { uris: csv(uris) } }),
  libSave: (uris) => api('/me/library', { method: 'PUT', query: { uris: csv(uris) } }),
  libRemove: (uris) => api('/me/library', { method: 'DELETE', query: { uris: csv(uris) } }),
};
