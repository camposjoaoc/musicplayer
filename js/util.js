import { ICONS } from './icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const store = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
  del(key) {
    try { localStorage.removeItem(key); } catch {}
  },
};

export const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

export function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function fmtTime(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export const artistsText = (artists) => (artists || []).map((a) => a?.name).filter(Boolean).join(', ');

// Menor imagem com largura >= min (o Spotify manda 640/300/64)
export function pickImage(images, min = 300) {
  if (!images?.length) return '';
  const sorted = [...images].sort((a, b) => (a.width || 640) - (b.width || 640));
  return (sorted.find((i) => (i.width || 640) >= min) || sorted[sorted.length - 1]).url;
}

export function stripHtml(html) {
  if (!html) return '';
  return new DOMParser().parseFromString(html, 'text/html').body.textContent.trim();
}

let toastTimer;
export function toast(msg, ms = 3500) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// Cor dominante da capa — usada no fundo do "Tocando agora" (e o Ambilight acompanha)
const colorCache = new Map();
export function colorOf(url) {
  if (!url) return Promise.resolve(null);
  if (colorCache.has(url)) return colorCache.get(url);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 16;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, 16, 16);
        const d = ctx.getImageData(0, 0, 16, 16).data;
        let r = 0, g = 0, b = 0, w = 0;
        for (let i = 0; i < d.length; i += 4) {
          const max = Math.max(d[i], d[i + 1], d[i + 2]);
          const min = Math.min(d[i], d[i + 1], d[i + 2]);
          const sat = max ? (max - min) / max : 0;
          const wt = 0.1 + sat * sat + (max > 50 ? 0.2 : 0);
          r += d[i] * wt; g += d[i + 1] * wt; b += d[i + 2] * wt; w += wt;
        }
        resolve([r / w, g / w, b / w].map(Math.round));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
  colorCache.set(url, p);
  return p;
}

// Controles do player usam o peso "fill"; o resto, "bold" (mais legível de longe na TV)
const FILLED = new Set(['play', 'pause', 'next', 'prev', 'heart']);

export function icon(name, cls = '', weight) {
  const key = name === 'heartOutline' ? 'heart' : name;
  const w = weight || (name !== 'heartOutline' && FILLED.has(key) ? 'fill' : 'bold');
  return `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 256 256" aria-hidden="true">${ICONS[key]?.[w] || ''}</svg>`;
}

// Preenche os [data-icon] do HTML estático; [data-dual] gera as versões normal e ativa
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    const n = el.dataset.icon;
    el.innerHTML = el.hasAttribute('data-dual') ? icon(n, 'ic-off', 'bold') + icon(n, 'ic-on', 'fill') : icon(n);
  });
}
