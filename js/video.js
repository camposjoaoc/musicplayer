// Clipes via YouTube: o Spotify não expõe vídeos na API pública, então buscamos o
// clipe oficial no YouTube, pausamos o Spotify e tocamos em tela cheia.
import { YOUTUBE_API_KEY } from './config.js';
import { artistsText, store, toast } from './util.js';

// A chave chega uma vez pela URL (?yt=...), fica no armazenamento do aparelho e sai da URL
// na hora, para não aparecer no histórico nem ser repassada adiante.
const KEY_STORE = 'spotv.ytkey';
(function captureKey() {
  const q = new URLSearchParams(location.search);
  const k = q.get('yt');
  if (k === null) return;
  if (/^AIza[0-9A-Za-z_-]{35}$/.test(k)) store.set(KEY_STORE, k);
  else if (k === '') store.del(KEY_STORE); // ?yt= vazio apaga a chave guardada
  q.delete('yt');
  const rest = q.toString();
  history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
})();

const apiKey = () => YOUTUBE_API_KEY || store.get(KEY_STORE, '');
export const videoEnabled = () => !!apiKey();

const CACHE_KEY = 'spotv.clips';
let apiReady = null;
let player = null;
let candidates = [];
let onClose = null;
let hudTimer;
let adHintTimer;
const DEFAULT_HINT = 'OK pausa · ◀ ▶ 10s · Voltar fecha e retoma o Spotify';
const setHint = (t) => { document.querySelector('#video .video-hint').textContent = t; };

const $ = (id) => document.getElementById(id);
export const isVideoOpen = () => !$('video').hidden;

function loadApi() {
  apiReady ||= new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve();
    window.onYouTubeIframeAPIReady = () => resolve();
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { apiReady = null; reject(new Error('Não foi possível carregar o YouTube')); };
    document.head.append(s);
  });
  return apiReady;
}

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Dá preferência a canais oficiais (VEVO / nome do artista) e a "official video"
function score(item, artist, title) {
  const t = norm(item.snippet.title);
  const ch = norm(item.snippet.channelTitle);
  const a = norm(artist);
  let s = 0;
  if (ch.endsWith('vevo')) s += 4;
  if (ch.includes(a.replace(/\s+/g, '')) || ch.includes(a)) s += 3;
  if (t.includes(norm(title))) s += 3;
  if (/official (music )?video|clipe oficial|video oficial/.test(t)) s += 2;
  if (/lyric|letra|audio|cover|karaoke|live|ao vivo|reaction/.test(t)) s -= 3;
  return s;
}

async function findClips(track) {
  const cache = store.get(CACHE_KEY, {});
  if (cache[track.uri]) return cache[track.uri];
  const artist = track.artists?.[0]?.name || '';
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.search = new URLSearchParams({
    part: 'snippet', type: 'video', videoEmbeddable: 'true', maxResults: '6',
    q: `${artist} ${track.name} official video`, key: apiKey(),
  });
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `YouTube respondeu ${res.status}`);
  const items = (data.items || [])
    .map((it) => ({ id: it.id.videoId, title: it.snippet.title, s: score(it, artist, track.name) }))
    .sort((a, b) => b.s - a.s);
  // Guarda só os últimos 200 para não encher o armazenamento
  const keys = Object.keys(cache);
  if (keys.length > 200) delete cache[keys[0]];
  cache[track.uri] = items;
  store.set(CACHE_KEY, cache);
  return items;
}

function showHud(ms = 4000) {
  const hud = $('video-hud');
  hud.classList.add('show');
  clearTimeout(hudTimer);
  hudTimer = setTimeout(() => hud.classList.remove('show'), ms);
}

function playNext() {
  const next = candidates.shift();
  if (!next) {
    toast('Nenhum clipe disponível para esta música.');
    closeVideo();
    return;
  }
  $('video-title').textContent = next.title.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  showHud();
  if (player) {
    player.loadVideoById(next.id);
    return;
  }
  player = new window.YT.Player('yt-player', {
    videoId: next.id,
    width: '100%',
    height: '100%',
    playerVars: { autoplay: 1, controls: 0, rel: 0, playsinline: 1, iv_load_policy: 3, fs: 0, disablekb: 1, modestbranding: 1 },
    events: {
      onReady: (e) => {
        // A partir daqui o player do YouTube mostra o próprio carregamento (e os anúncios);
        // nosso spinner sairia por cima deles.
        $('video-loading').hidden = true;
        e.target.playVideo();
        adHintTimer = setTimeout(() => {
          if (isVideoOpen() && player?.getPlayerState?.() !== window.YT.PlayerState.PLAYING) {
            setHint('Anúncio do YouTube: ele termina sozinho em alguns segundos · Voltar fecha');
            showHud(8000);
          }
        }, 2500);
      },
      onStateChange: (e) => {
        if (e.data === window.YT.PlayerState.PLAYING) setHint(DEFAULT_HINT);
        if (e.data === window.YT.PlayerState.ENDED) closeVideo({ ended: true });
      },
      // 100 = removido, 101/150 = dono não permite embed → tenta o próximo
      onError: (e) => { console.warn('YouTube: erro', e.data); playNext(); },
    },
  });
}

export async function openVideo(track, { onOpen, onClosed }) {
  if (!track?.uri) { toast('Nada tocando.'); return; }
  onClose = onClosed;
  $('video').hidden = false;
  $('video-loading').hidden = false;
  setHint(DEFAULT_HINT);
  $('video-title').textContent = `${track.name} — ${artistsText(track.artists)}`;
  showHud();
  onOpen?.();
  try {
    const [clips] = await Promise.all([findClips(track), loadApi()]);
    if (!isVideoOpen()) return;
    candidates = [...clips];
    playNext();
  } catch (e) {
    toast(e.message);
    closeVideo();
  }
}

export function closeVideo({ ended = false } = {}) {
  if (!isVideoOpen()) return;
  $('video').hidden = true;
  candidates = [];
  clearTimeout(adHintTimer);
  try { player?.destroy(); } catch {}
  player = null;
  // A API recria o iframe no lugar desta div; garante que ela exista de novo
  if (!$('yt-player')) {
    const div = document.createElement('div');
    div.id = 'yt-player';
    div.className = 'yt-player';
    $('video').prepend(div);
  }
  const cb = onClose;
  onClose = null;
  cb?.({ ended });
}

// Teclas enquanto o clipe está aberto. Retorna true se tratou.
export function videoKey(k) {
  if (!isVideoOpen()) return false;
  if (!player?.getPlayerState) return k !== 'back';
  const playing = player.getPlayerState() === window.YT.PlayerState.PLAYING;
  switch (k) {
    case 'enter':
    case 'playpause':
      playing ? player.pauseVideo() : player.playVideo();
      showHud();
      return true;
    case 'play': player.playVideo(); return true;
    case 'pause':
    case 'stop': player.pauseVideo(); showHud(); return true;
    case 'left':
    case 'right':
    case 'next':
    case 'prev': {
      const d = k === 'left' || k === 'prev' ? -10 : 10;
      player.seekTo(Math.max(0, player.getCurrentTime() + d), true);
      showHud(1500);
      return true;
    }
    case 'up':
    case 'down':
      showHud();
      return true;
    default:
      return false;
  }
}
