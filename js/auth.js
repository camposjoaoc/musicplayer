// Login Spotify com Authorization Code + PKCE (sem client secret).
// Duas formas: direto na TV (redirect) ou pareando pelo celular via QR code.
import { APP_BASE, CLIENT_ID, REDIRECT_URI, RELAY, SCOPES } from './config.js';
import { LANG_HEADER, b64url, fromB64url, randomBytes, store } from './util.js';

const AUTHORIZE = 'https://accounts.spotify.com/authorize';
const TOKEN = 'https://accounts.spotify.com/api/token';
const TOKEN_KEY = 'spotv.token';
const PENDING_KEY = 'spotv.pending';

export async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

export function authorizeUrl({ challenge, state }) {
  const p = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: SCOPES.join(' '),
    state,
  });
  return `${AUTHORIZE}?${p}`;
}

export async function tokenRequest(params) {
  let res;
  try {
    res = await fetch(TOKEN, {
      method: 'POST',
      headers: { ...LANG_HEADER, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID, ...params }).toString(),
    });
  } catch (e) {
    throw Object.assign(new Error(`falha de rede ao pedir o token (${e.message})`), { status: 0 });
  }
  const text = await res.text().catch((e) => `[corpo ilegível: ${e.message}]`);
  let data = {};
  try { data = JSON.parse(text); } catch {}
  if (!res.ok) {
    // Sem o JSON de erro do Spotify, mostra o começo da resposta para diagnosticar
    const detail = data.error_description || data.error
      || `HTTP ${res.status} · ${res.headers.get('content-type') || 'sem content-type'} · ${text.slice(0, 120) || 'corpo vazio'}`;
    throw Object.assign(new Error(detail), { code: data.error, status: res.status });
  }
  return data;
}

export function saveToken(data, prev) {
  const t = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || prev?.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    scope: data.scope || prev?.scope || '',
  };
  store.set(TOKEN_KEY, t);
  return t;
}

export async function exchangeCode(code, verifier, redirectUri = REDIRECT_URI) {
  saveToken(await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  }));
}

export const isLoggedIn = () => !!store.get(TOKEN_KEY)?.refresh_token;

// Permissões que o app pede hoje e que o login atual não tem (o app ganhou recursos
// novos depois que a pessoa entrou). Sessões antigas não guardavam o escopo: renova
// o token uma vez para descobrir.
export async function missingScopes() {
  if (!store.get(TOKEN_KEY)?.scope) await getAccessToken(true).catch(() => {});
  const granted = (store.get(TOKEN_KEY)?.scope || '').split(' ');
  return SCOPES.filter((s) => !granted.includes(s));
}

export function logout(reason) {
  store.del(TOKEN_KEY);
  if (reason) store.set('spotv.logoutReason', reason);
  window.dispatchEvent(new Event('spotv:logout'));
}

let refreshing = null;
export async function getAccessToken(force = false) {
  const t = store.get(TOKEN_KEY);
  if (!t?.refresh_token) throw Object.assign(new Error('Não conectado'), { status: 401 });
  if (!force && t.expires_at - Date.now() > 60_000) return t.access_token;
  refreshing ||= tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token })
    .then((d) => saveToken(d, t).access_token)
    .catch((e) => {
      if (e.code === 'invalid_grant' || e.code === 'invalid_client') logout('Sua sessão expirou. Entre novamente.');
      throw e;
    })
    .finally(() => { refreshing = null; });
  return refreshing;
}

// ---- Login direto na TV -------------------------------------------------

export async function loginOnTv() {
  const verifier = b64url(randomBytes(48));
  const state = 'tv.' + b64url(randomBytes(12));
  store.set(PENDING_KEY, { verifier, state });
  location.assign(authorizeUrl({ challenge: await challengeFor(verifier), state }));
}

// Chamado no boot: se a URL tem ?code=…, conclui o login feito na TV.
export async function completeTvLogin() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return false;
  history.replaceState(null, '', location.pathname);
  const pending = store.get(PENDING_KEY);
  store.del(PENDING_KEY);
  if (q.get('error')) throw new Error(`Login cancelado (${q.get('error')}).`);
  if (!pending || pending.state !== q.get('state')) throw new Error('Login expirou. Tente de novo.');
  await exchangeCode(q.get('code'), pending.verifier);
  return true;
}

// ---- Pareamento pelo celular ---------------------------------------------
// A TV gera um par de chaves ECDH (P-256) e mostra só a pública no QR, junto com um
// tópico do relay. O celular faz o login E a troca do código pelo token (o navegador do
// celular é mais completo que o da TV), cifra os tokens com uma chave derivada da
// pública da TV e publica no relay. Só a TV, com a chave privada, consegue decifrar —
// quem fotografar o QR não consegue ler os tokens.

const ECDH = { name: 'ECDH', namedCurve: 'P-256' };

export async function pairingKey(peerPublicRaw, myPrivateKey, usage) {
  const peer = await crypto.subtle.importKey('raw', peerPublicRaw, ECDH, false, []);
  return crypto.subtle.deriveKey({ name: 'ECDH', public: peer }, myPrivateKey, { name: 'AES-GCM', length: 256 }, false, [usage]);
}

export async function startPairing({ onDone, onError }) {
  const topic = 'spotv-' + b64url(randomBytes(16));
  const keys = await crypto.subtle.generateKey(ECDH, false, ['deriveKey']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));

  const url = new URL('pair.html', APP_BASE);
  url.hash = `${topic}.${b64url(pub)}`;

  const since = Math.floor(Date.now() / 1000) - 5;
  const es = new EventSource(`${RELAY}/${topic}/sse?since=${since}`);
  let done = false;

  es.onmessage = async (ev) => {
    if (done) return;
    let payload;
    try {
      const msg = JSON.parse(ev.data);
      if (msg.event && msg.event !== 'message') return;
      const [phonePub, iv, ct] = String(msg.message).split('.');
      const key = await pairingKey(fromB64url(phonePub), keys.privateKey, 'decrypt');
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(iv) }, key, fromB64url(ct));
      payload = JSON.parse(new TextDecoder().decode(plain));
    } catch {
      return; // mensagem que não é nossa
    }
    done = true;
    es.close();
    if (payload.error) { onError(new Error(payload.error)); return; }
    if (!payload.refresh_token) { onError(new Error('o celular não mandou o token')); return; }
    saveToken(payload);
    onDone();
  };

  return {
    url: url.href,
    stop() { done = true; es.close(); },
  };
}
