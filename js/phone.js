// Páginas abertas no celular durante o pareamento (pair.html → Spotify → callback.html)
import { authorizeUrl } from './auth.js';
import { REDIRECT_URI, RELAY } from './config.js';
import { b64url, esc, fromB64url, randomBytes, store } from './util.js';

const PHONE_KEY = 'spotv.phone';
const show = (html) => { document.getElementById('msg').innerHTML = html; };

export function startPair() {
  const [topic, key, challenge] = location.hash.slice(1).split('.');
  if (!topic || !key || !challenge) {
    show('<h1>Link inválido</h1><p>Escaneie o QR code da TV de novo.</p>');
    return;
  }
  const state = 'pair.' + b64url(randomBytes(12));
  store.set(PHONE_KEY, { topic, key, state });
  const url = authorizeUrl({ challenge, state });
  document.getElementById('go').href = url;
  setTimeout(() => location.assign(url), 500);
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

  try {
    const key = await crypto.subtle.importKey('raw', fromB64url(p.key), 'AES-GCM', false, ['encrypt']);
    const iv = randomBytes(12);
    const plain = new TextEncoder().encode(JSON.stringify({ code: q.get('code'), redirect_uri: REDIRECT_URI }));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
    const res = await fetch(`${RELAY}/${p.topic}`, { method: 'POST', body: `${b64url(iv)}.${b64url(ct)}` });
    if (!res.ok) throw new Error(`relay respondeu ${res.status}`);
    store.del(PHONE_KEY);
    history.replaceState(null, '', location.pathname);
    show('<h1>Pronto!</h1><p>Pode olhar para a TV — ela conecta em instantes.</p>');
  } catch (e) {
    show(`<h1>Não deu certo</h1><p>${esc(e.message)}. Escaneie o QR code de novo.</p>`);
  }
}
