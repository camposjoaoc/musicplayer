// Login Spotify com Authorization Code + PKCE (sem client secret).
// Duas formas: direto na TV (redirect) ou pareando pelo celular via QR code.
import { CLIENT_ID, REDIRECT_URI, RELAY, SCOPES } from './config.js';
import { b64url, fromB64url, randomBytes, store } from './util.js';

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

async function tokenRequest(params) {
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...params }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error_description || data.error || `HTTP ${res.status}`);
    err.code = data.error;
    err.status = res.status;
    throw err;
  }
  return data;
}

function saveToken(data, prev) {
  const t = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || prev?.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    scope: data.scope || prev?.scope || '',
  };
  store.set(TOKEN_KEY, t);
  return t;
}

export async function exchangeCode(code, verifier) {
  saveToken(await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
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
// A TV gera verifier + chave AES. O QR leva só o challenge, o tópico e a chave.
// O celular faz login, cifra o authorization code e publica no relay; a TV
// decifra e troca o code pelo token (o verifier nunca sai da TV).

export async function startPairing({ onDone, onError }) {
  const verifier = b64url(randomBytes(48));
  const challenge = await challengeFor(verifier);
  const topic = 'spotv-' + b64url(randomBytes(16));
  const rawKey = randomBytes(32);
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);

  const url = new URL('pair.html', location.href);
  url.search = '';
  url.hash = [topic, b64url(rawKey), challenge].join('.');

  const since = Math.floor(Date.now() / 1000) - 5;
  const es = new EventSource(`${RELAY}/${topic}/sse?since=${since}`);
  let done = false;

  es.onmessage = async (ev) => {
    if (done) return;
    let code;
    try {
      const msg = JSON.parse(ev.data);
      if (msg.event && msg.event !== 'message') return;
      const [iv, ct] = String(msg.message).split('.');
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(iv) }, key, fromB64url(ct));
      code = JSON.parse(new TextDecoder().decode(plain)).code;
    } catch {
      return; // mensagem que não é nossa
    }
    done = true;
    es.close();
    try {
      await exchangeCode(code, verifier);
      onDone();
    } catch (e) {
      onError(e);
    }
  };

  return {
    url: url.href,
    stop() { done = true; es.close(); },
  };
}
