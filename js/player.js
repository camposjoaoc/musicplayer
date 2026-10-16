// Estado de reprodução unificado. Duas fontes:
//  - Web Playback SDK: a própria TV vira um dispositivo Spotify Connect (precisa Premium + Widevine)
//  - Web API /me/player: qualquer dispositivo (celular, PC, caixa de som) — polling
import { S } from './api.js';
import { getAccessToken } from './auth.js';
import { DEVICE_NAME } from './config.js';
import { toast } from './util.js';

export const bus = new EventTarget();
const emit = (type) => bus.dispatchEvent(new Event(type));

export const P = {
  sdk: null,
  deviceId: null,          // id da TV no Spotify Connect, quando o SDK está pronto
  sdkStatus: 'loading',    // loading | ready | offline | unsupported | error
  sdkMessage: '',
  preferredDeviceId: null, // escolhido em "Dispositivos"; null = esta TV
  state: null,
  liked: null,
};

// ---- Normalização --------------------------------------------------------

const REPEAT = ['off', 'context', 'track'];

function normTrack(item) {
  if (!item) return null;
  const show = item.show;
  return {
    id: item.id,
    uri: item.uri,
    name: item.name,
    type: item.type,
    duration: item.duration_ms || 0,
    artists: item.artists?.length ? item.artists : show ? [{ name: show.publisher || show.name }] : [],
    album: item.album || (show ? { name: show.name, uri: show.uri, images: item.images?.length ? item.images : show.images } : {}),
  };
}

function fromApi(d) {
  if (!d?.device) return null;
  return {
    track: normTrack(d.item),
    isPlaying: !!d.is_playing,
    position: d.progress_ms || 0,
    at: performance.now(),
    shuffle: !!d.shuffle_state,
    repeat: d.repeat_state || 'off',
    device: { id: d.device.id, name: d.device.name, type: d.device.type },
    contextUri: d.context?.uri || null,
  };
}

function fromSdk(s) {
  const t = s.track_window?.current_track;
  return {
    track: t ? { ...normTrack(t), duration: s.duration || t.duration_ms } : null,
    isPlaying: !s.paused,
    position: s.position || 0,
    at: performance.now(),
    shuffle: !!s.shuffle,
    repeat: REPEAT[s.repeat_mode] || 'off',
    device: { id: P.deviceId, name: DEVICE_NAME, type: 'TV' },
    contextUri: s.context?.uri || null,
  };
}

function setState(next) {
  const prevUri = P.state?.track?.uri;
  P.state = next;
  emit('state');
  if (next?.track?.uri !== prevUri) onTrackChange();
}

function onTrackChange() {
  P.liked = null;
  emit('like');
  const uri = P.state?.track?.uri;
  if (!uri) return;
  S.libContains([uri])
    .then((r) => { if (P.state?.track?.uri === uri) { P.liked = !!r?.[0]; emit('like'); } })
    .catch(() => {});
}

export function position() {
  const s = P.state;
  if (!s) return 0;
  const p = s.isPlaying ? s.position + (performance.now() - s.at) : s.position;
  return Math.max(0, Math.min(p, s.track?.duration || p));
}

// ---- Polling da Web API --------------------------------------------------

let pollTimer;
let lastSdkAt = 0;

export async function refresh() {
  try {
    const d = await S.state();
    // Enquanto a TV toca, o SDK é mais preciso que a API (que atrasa um pouco)
    if (d?.device?.id && d.device.id === P.deviceId && performance.now() - lastSdkAt < 4000) return;
    setState(fromApi(d));
  } catch {}
}

function schedule(ms = 5000) {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    if (!document.hidden) await refresh();
    schedule();
  }, ms);
}

export function startPolling() {
  refresh();
  schedule();
}

const refreshSoon = () => { setTimeout(refresh, 700); setTimeout(refresh, 2200); };

// ---- Web Playback SDK ----------------------------------------------------

function setSdk(status, message = '') {
  P.sdkStatus = status;
  P.sdkMessage = message;
  emit('sdk');
}

export function initSdk() {
  const timeout = setTimeout(() => {
    if (P.sdkStatus === 'loading') setSdk('error', 'O player não respondeu a tempo');
  }, 25000);

  window.onSpotifyWebPlaybackSDKReady = () => {
    const player = new window.Spotify.Player({
      name: DEVICE_NAME,
      getOAuthToken: (cb) => { getAccessToken().then(cb, () => {}); },
      volume: 1, // o volume fica por conta do controle da TV
    });
    P.sdk = player;

    player.addListener('ready', ({ device_id }) => {
      clearTimeout(timeout);
      P.deviceId = device_id;
      setSdk('ready');
    });
    player.addListener('not_ready', () => {
      P.deviceId = null;
      setSdk('offline', 'A TV saiu do Spotify Connect');
    });
    player.addListener('initialization_error', ({ message }) => { clearTimeout(timeout); setSdk('unsupported', message); });
    player.addListener('authentication_error', ({ message }) => { clearTimeout(timeout); setSdk('error', `Autenticação: ${message}`); });
    player.addListener('account_error', ({ message }) => { clearTimeout(timeout); setSdk('error', `Conta sem Premium? ${message}`); });
    player.addListener('playback_error', ({ message }) => toast(`Erro de reprodução: ${message}`));
    player.addListener('autoplay_failed', () => toast('Aperte OK para liberar o áudio na TV'));
    player.addListener('player_state_changed', (s) => {
      if (!s) { refreshSoon(); return; }
      lastSdkAt = performance.now();
      setState(fromSdk(s));
    });

    player.connect().then((ok) => { if (!ok) setSdk('error', 'Não foi possível conectar o player'); });
  };

  const script = document.createElement('script');
  script.src = 'https://sdk.scdn.co/spotify-player.js';
  script.onerror = () => { clearTimeout(timeout); setSdk('error', 'Não foi possível baixar o SDK do Spotify'); };
  document.head.append(script);
}

// Navegadores só liberam áudio depois de um gesto do usuário; a tecla do controle conta.
let activated = false;
export function activateAudio() {
  if (activated || !P.sdk?.activateElement) return;
  activated = true;
  P.sdk.activateElement().catch?.(() => {});
}

export async function drmCheck() {
  if (!window.isSecureContext) return 'Página sem HTTPS — o DRM não funciona';
  if (!navigator.requestMediaKeySystemAccess) return 'EME indisponível neste navegador';
  const cfg = [{ initDataTypes: ['cenc'], audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }] }];
  try {
    await navigator.requestMediaKeySystemAccess('com.widevine.alpha', cfg);
    return 'Widevine disponível';
  } catch (e) {
    return `Widevine indisponível (${e.name})`;
  }
}

export function sdkLabel() {
  const base = {
    loading: 'Iniciando o player…',
    ready: 'Pronta para tocar',
    offline: 'Player desconectado',
    unsupported: 'Player não suportado neste navegador',
    error: 'Player com erro',
  }[P.sdkStatus];
  return P.sdkMessage && P.sdkStatus !== 'ready' ? `${base} — ${P.sdkMessage}` : base;
}

// ---- Comandos ------------------------------------------------------------

const isLocal = () => !!(P.sdk && P.deviceId && P.state?.device?.id === P.deviceId);
const activeId = () => P.state?.device?.id;

export function explain(e) {
  if (e?.status === 404) return 'Nenhum dispositivo ativo. Escolha um em Dispositivos.';
  if (e?.status === 403) return e.reason === 'PREMIUM_REQUIRED' ? 'Isso exige Spotify Premium.' : `O Spotify recusou a ação${e.reason ? ` (${e.reason})` : ''}.`;
  if (e?.status === 401) return 'Sessão expirada. Entre novamente.';
  return e?.message || 'Algo deu errado.';
}

async function guard(fn) {
  try {
    await fn();
  } catch (e) {
    toast(explain(e));
    refresh();
  }
}

function optimistic(patch) {
  if (!P.state) return;
  P.state = { ...P.state, position: position(), at: performance.now(), ...patch };
  emit('state');
}

export async function togglePlay() {
  const s = P.state;
  if (!s?.track) { toast('Nada tocando. Escolha uma música.'); return; }
  if (isLocal()) return guard(() => P.sdk.togglePlay());
  optimistic({ isPlaying: !s.isPlaying });
  await guard(() => (s.isPlaying ? S.pause() : S.play()));
  refreshSoon();
}

export async function next() {
  if (!P.state) return;
  if (isLocal()) return guard(() => P.sdk.nextTrack());
  await guard(() => S.next());
  refreshSoon();
}

export async function prev() {
  if (!P.state) return;
  if (isLocal()) return guard(() => P.sdk.previousTrack());
  await guard(() => S.previous());
  refreshSoon();
}

export async function seekBy(delta) {
  const s = P.state;
  if (!s?.track) return;
  const to = Math.max(0, Math.min(position() + delta, s.track.duration - 1000));
  optimistic({ position: to });
  if (isLocal()) return guard(() => P.sdk.seek(to));
  await guard(() => S.seek(to));
}

export async function toggleShuffle() {
  const s = P.state;
  if (!s) return;
  optimistic({ shuffle: !s.shuffle });
  await guard(() => S.shuffle(!s.shuffle, activeId()));
  refreshSoon();
}

export async function cycleRepeat() {
  const s = P.state;
  if (!s) return;
  const nextMode = REPEAT[(REPEAT.indexOf(s.repeat) + 1) % REPEAT.length];
  optimistic({ repeat: nextMode });
  await guard(() => S.repeat(nextMode, activeId()));
  refreshSoon();
}

export async function toggleLike() {
  const uri = P.state?.track?.uri;
  if (!uri || P.liked === null) return;
  const was = P.liked;
  P.liked = !was;
  emit('like');
  try {
    await (was ? S.libRemove([uri]) : S.libSave([uri]));
    toast(was ? 'Removida das curtidas' : 'Adicionada às curtidas');
  } catch (e) {
    P.liked = was;
    emit('like');
    toast(explain(e));
  }
}

// Por padrão toca na própria TV; se o usuário escolheu outro aparelho, toca lá.
const targetDevice = () => P.preferredDeviceId || P.deviceId || activeId() || null;

export async function play({ contextUri, uris, offsetUri, offsetIndex, shuffle }) {
  const device = targetDevice();
  if (!device) throw Object.assign(new Error('Nenhum dispositivo disponível.'), { status: 404 });
  const body = {};
  if (contextUri) body.context_uri = contextUri;
  else if (uris) body.uris = uris;
  if (offsetUri) body.offset = { uri: offsetUri };
  else if (Number.isInteger(offsetIndex)) body.offset = { position: offsetIndex };
  await S.play(body, device);
  if (shuffle !== undefined) S.shuffle(shuffle, device).catch(() => {});
  refreshSoon();
}

export async function transfer(id) {
  const target = id === 'local' ? P.deviceId : id;
  if (!target) { toast(sdkLabel()); return; }
  P.preferredDeviceId = id === 'local' ? null : id;
  await guard(() => S.transfer(target, !!P.state?.isPlaying));
  toast('Reprodução transferida');
  refreshSoon();
}
