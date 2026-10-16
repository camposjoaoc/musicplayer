// Páginas abertas no celular durante o pareamento (pair.html → Spotify → callback.html).
// O celular faz o login e a troca do código pelo token, e manda os tokens cifrados
// para a TV (veja startPairing em auth.js).
import { authorizeUrl, challengeFor, pairingKey, tokenRequest } from './auth.js';
import { REDIRECT_URI, RELAY } from './config.js';
import { b64url, esc, fromB64url, randomBytes, store } from './util.js';

const PHONE_KEY = 'spotv.phone';
const show = (html) => { document.getElementById('msg').innerHTML = html; };

export async function startPair() {
  const [topic, tvPub] = location.hash.slice(1).split('.');
  if (!topic || !tvPub) {
    show('<h1>Link inválido</h1><p>Escaneie o QR code da TV de novo.</p>');
    return;
  }
  const verifier = b64url(randomBytes(48));
  const state = 'pair.' + b64url(randomBytes(12));
  store.set(PHONE_KEY, { topic, tvPub, verifier, state });
  const url = authorizeUrl({ challenge: await challengeFor(verifier), state });
  document.getElementById('go').href = url;
  setTimeout(() => location.assign(url), 500);
}

// Cifra para a chave pública da TV com um par de chaves descartável do celular
async function sealForTv(tvPub, data) {
  const mine = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
  const minePub = new Uint8Array(await crypto.subtle.exportKey('raw', mine.publicKey));
  const key = await pairingKey(fromB64url(tvPub), mine.privateKey, 'encrypt');
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(data))));
  return `${b64url(minePub)}.${b64url(iv)}.${b64url(ct)}`;
}

export async function handleCallback() {
  const q = new URLSearchParams(location.search);
  const state = q.get('state') || '';

  // Login feito direto na TV: devolve para o app, que conclui a troca do código
  if (state.startsWith('tv.')) {
    location.replace('./' + location.search);
    return;
  }

  if (q.get('error')) {
    show(`<h1>Login cancelado</h1><p>${esc(q.get('error'))}. Escaneie o QR code de novo.</p>`);
    return;
  }

  const p = store.get(PHONE_KEY);
  if (!p || p.state !== state || !q.get('code')) {
    show('<h1>Pareamento não encontrado</h1><p>Escaneie o QR code da TV de novo.</p>');
    return;
  }
  history.replaceState(null, '', location.pathname);

  try {
    let payload;
    try {
      const t = await tokenRequest({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: REDIRECT_URI, code_verifier: p.verifier });
      payload = { access_token: t.access_token, refresh_token: t.refresh_token, expires_in: t.expires_in, scope: t.scope };
    } catch (e) {
      payload = { error: `troca do código falhou no celular: ${e.message}` };
    }
    const res = await fetch(`${RELAY}/${p.topic}`, { method: 'POST', body: await sealForTv(p.tvPub, payload) });
    if (!res.ok) throw new Error(`relay respondeu ${res.status}`);
    store.del(PHONE_KEY);
    if (payload.error) throw new Error(payload.error);
    show('<h1>Pronto!</h1><p>Pode olhar para a TV — ela conecta em instantes.</p>');
  } catch (e) {
    show(`<h1>Não deu certo</h1><p>${esc(e.message)}. Escaneie o QR code de novo.</p>`);
  }
}
