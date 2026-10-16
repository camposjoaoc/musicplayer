// Navegação espacial pelo controle remoto: cada elemento com [data-focus] é
// alcançável; as setas escolhem o vizinho mais próximo na direção pressionada.
// Camadas (diálogo, tela "Tocando agora") prendem o foco enquanto abertas.

let current = null;
let base = null;
const layers = [];

const visible = (el) => el.getClientRects().length > 0;

export const getFocused = () => (current && document.contains(current) ? current : null);
export const activeRoot = () => layers.at(-1)?.el || base || document.body;

export function focusables(root = activeRoot()) {
  return [...root.querySelectorAll('[data-focus]')].filter(visible);
}

export function focus(el, { scroll = true, smooth = true } = {}) {
  if (!el) return;
  if (current !== el) {
    current?.classList.remove('is-focused');
    current = el;
    el.classList.add('is-focused');
    document.dispatchEvent(new CustomEvent('focuschange', { detail: el }));
  }
  if (scroll) el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
}

export function focusFirst(root = activeRoot()) {
  const items = focusables(root);
  focus(items.find((e) => e.hasAttribute('data-autofocus')) || items[0], { smooth: false });
}

export function focusByKey(key, root = activeRoot()) {
  const el = focusables(root).find((e) => e.dataset.key === key);
  if (el) focus(el, { smooth: false });
  return !!el;
}

export function setBase(el) {
  base = el;
  layers.length = 0;
  current?.classList.remove('is-focused');
  current = null;
}

export function pushLayer(el) {
  layers.push({ el, prev: getFocused() });
  focusFirst(el);
}

export function popLayer(el) {
  const i = layers.findIndex((l) => l.el === el);
  if (i < 0) return;
  const [l] = layers.splice(i, 1);
  if (l.prev && document.contains(l.prev) && visible(l.prev)) focus(l.prev, { smooth: false });
  else focusFirst();
}

export const isLayerOpen = () => layers.length > 0;

export function move(dir, { smooth = true } = {}) {
  const root = activeRoot();
  const items = focusables(root);
  const cur = getFocused();
  if (!cur || !items.includes(cur)) return focusFirst(root);

  let r = cur.getBoundingClientRect();
  const curClip = cur.closest('[data-clip]');
  if (curClip) {
    const z = curClip.getBoundingClientRect();
    r = { left: r.left, right: Math.min(r.right, z.right), top: r.top, bottom: r.bottom, width: Math.min(r.right, z.right) - r.left, height: r.height };
  }
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const horiz = dir === 'left' || dir === 'right';
  const sign = dir === 'right' || dir === 'down' ? 1 : -1;
  // Zonas (menu, conteúdo, mini player): só se sai delas pelas direções em data-exits
  const zone = cur.closest('[data-zone]');
  const exits = (zone?.dataset.exits || '').split(' ');

  const curRow = cur.closest('[data-nav-row]');
  const rowRects = new Map();
  const rowRect = (row) => {
    if (!rowRects.has(row)) rowRects.set(row, row.getBoundingClientRect());
    return rowRects.get(row);
  };

  const scored = [];
  for (const el of items) {
    if (el === cur) continue;
    const same = el.closest('[data-zone]') === zone;
    if (!same && !exits.includes(dir)) continue;
    let b = el.getBoundingClientRect();
    // Zonas com [data-clip] (o menu recolhido) cortam o que está escondido pelo overflow
    const clipZone = el.closest('[data-clip]');
    if (clipZone) {
      const z = clipZone.getBoundingClientRect();
      b = { left: Math.max(b.left, z.left), right: Math.min(b.right, z.right), top: b.top, bottom: b.bottom, width: 0, height: b.height };
      b.width = Math.max(0, b.right - b.left);
    }
    // Cards de outra fileira só contam se estiverem visíveis nela (não os rolados para fora)
    const row = el.closest('[data-nav-row]');
    if (row && row !== curRow) {
      const rr = rowRect(row);
      if (b.right <= rr.left + 2 || b.left >= rr.right - 2) continue;
    }
    const bx = b.left + b.width / 2;
    const by = b.top + b.height / 2;
    if ((horiz ? bx - cx : by - cy) * sign <= 1) continue;
    // Na horizontal o destino tem que estar além da borda (evita pular de uma linha larga para um card abaixo)
    if (horiz && (sign > 0 ? b.left < r.right - 12 : b.right > r.left + 12)) continue;
    const gap = horiz
      ? Math.max(0, sign > 0 ? b.left - r.right : r.left - b.right)
      : Math.max(0, sign > 0 ? b.top - r.bottom : r.top - b.bottom);
    const overlap = horiz
      ? Math.min(r.bottom, b.bottom) > Math.max(r.top, b.top)
      : Math.min(r.right, b.right) > Math.max(r.left, b.left);
    const off = horiz ? Math.abs(by - cy) : Math.abs(bx - cx);
    scored.push({ el, same, overlap, score: gap + off * (horiz ? 2 : 0.5) });
  }

  // Ordem de preferência: mesma zona e mesma linha/coluna primeiro. Na vertical, depois
  // qualquer item da zona; na horizontal, sair da zona (ex.: ← abre o menu) vem antes
  // de pular na diagonal. Dentro de uma fileira de cards, ←/→ nunca pula de fileira.
  const inRow = horiz && !!cur.closest('[data-nav-row]');
  const tiers = horiz
    ? [(s) => s.same && s.overlap, (s) => !s.same && s.overlap, (s) => !s.same, (s) => s.same && !inRow]
    : [(s) => s.same && s.overlap, (s) => s.same, (s) => !s.same && s.overlap, (s) => !s.same];
  for (const tier of tiers) {
    const pool = scored.filter(tier);
    if (pool.length) {
      pool.sort((a, b) => a.score - b.score);
      let target = pool[0].el;
      // Ao entrar no menu, vai para a seção ativa em vez do item mais próximo
      if (!pool[0].same) {
        const active = target.closest('[data-zone]')?.querySelector('[data-focus].active');
        if (active && visible(active)) target = active;
      }
      focus(target, { smooth });
      return;
    }
  }
}
