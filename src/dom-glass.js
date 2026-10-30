// Жидкое стекло над текстом и плитками (дополнение к liquid-glass.js), только Chromium.
// liquid-glass.js преломляет только фото и видео: пикселей обычной страницы браузер шейдеру не отдаёт.
// Chromium умеет backdrop-filter со SVG-фильтром — он гнёт живую страницу под элементом сам, на видеокарте.
// Safari и Firefox этого не умеют: там над текстом остаётся матовое стекло, над фото — WebGL-линза плагина.
// В Chromium этот путь используется везде, включая фото (WebGL-линза там прячется).
// Карта изгиба считается по форме элемента (скруглённый прямоугольник, кромка-сквиркл, Снеллиус n = 1,5).
const chromium = /Chrome\/|Chromium\/|Edg\//.test(navigator.userAgent) && !/Firefox\//.test(navigator.userAgent);
if (chromium && !matchMedia('(prefers-reduced-transparency: reduce)').matches) {
  // В Chromium это стекло гнёт и фото тоже, поэтому WebGL-линзу плагина прячем: одно стекло на весь сайт
  document.documentElement.classList.add('lg-dom');
  const st = document.createElement('style');
  st.textContent = '.lg-dom canvas.lg-lens { display: none !important; }';
  document.head.append(st);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  Object.assign(svg.style, { position: 'absolute', width: 0, height: 0 });
  svg.setAttribute('aria-hidden', 'true');
  document.body.append(svg);

  const bend = (t) => { // t: 0 — край, 1 — плоская часть
    const x = Math.min(Math.max(t, 1e-4), 0.9999);
    const slope = (1 - x) ** 3 / (1 - (1 - x) ** 4) ** 0.75;
    const ti = Math.atan(slope), tt = Math.asin(Math.sin(ti) / 1.5);
    return Math.sin(ti - tt);
  };
  const peak = bend(1e-4);

  // Карта: R — сдвиг по X, G — по Y, 128 — на месте. У кромки берём картинку изнутри (вдоль нормали).
  const mapFor = (w, h, r, bevel) => {
    const s = 0.5, W = Math.max(2, Math.round(w * s)), H = Math.max(2, Math.round(h * s));
    const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
    const ctx = c.getContext('2d'), img = ctx.createImageData(W, H);
    const R = Math.min(r, w / 2, h / 2);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const px = (i + 0.5) / s - w / 2, py = (j + 0.5) / s - h / 2;
      const qx = Math.abs(px) - (w / 2 - R), qy = Math.abs(py) - (h / 2 - R);
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0), out = Math.hypot(ox, oy);
      const d = R - (out + Math.min(Math.max(qx, qy), 0)); // расстояние до края внутрь
      let nx = 0, ny = 0;
      if (out > 0) { nx = ox / out * Math.sign(px); ny = oy / out * Math.sign(py); }
      else if (qx > qy) nx = Math.sign(px); else ny = Math.sign(py);
      const k = d < bevel ? bend(d / bevel) / peak : 0;
      const n = (j * W + i) * 4;
      img.data[n] = 128 + 127 * nx * k; img.data[n + 1] = 128 + 127 * ny * k; img.data[n + 2] = 128; img.data[n + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL();
  };

  let gen = 0;
  const apply = (host) => {
    const frost = host.querySelector(':scope > .lg-frost');
    const target = frost || host;
    const { width: w, height: h } = host.getBoundingClientRect();
    if (w < 8 || h < 8) return;
    const r = parseFloat(getComputedStyle(host).borderTopLeftRadius) || h / 2;
    const bevel = Math.min(h / 2, w / 2, host.dataset.glassPreset === 'bar' ? 22 : 14);
    const scale = host.dataset.glassPreset === 'bar' ? 70 : 40;
    const id = `lg-dom-${++gen}`;
    const old = host._lgDom; if (old) old.remove();
    const f = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    f.id = id;
    for (const [k, v] of [['x', 0], ['y', 0], ['width', w], ['height', h], ['filterUnits', 'userSpaceOnUse'], ['primitiveUnits', 'userSpaceOnUse'], ['color-interpolation-filters', 'sRGB']]) f.setAttribute(k, v);
    const sp = 0.06; // радужная кайма: каналы гнутся чуть по-разному
    f.innerHTML = `<feImage href="${mapFor(w, h, r, bevel)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="map"/>
      <feDisplacementMap in="SourceGraphic" in2="map" scale="${-scale}" xChannelSelector="R" yChannelSelector="G" result="dr"/>
      <feDisplacementMap in="SourceGraphic" in2="map" scale="${-scale * (1 + sp)}" xChannelSelector="R" yChannelSelector="G" result="dg"/>
      <feDisplacementMap in="SourceGraphic" in2="map" scale="${-scale * (1 + 2 * sp)}" xChannelSelector="R" yChannelSelector="G" result="db"/>
      <feColorMatrix in="dr" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="r"/>
      <feColorMatrix in="dg" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="g"/>
      <feColorMatrix in="db" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="b"/>
      <feComposite in="r" in2="g" operator="arithmetic" k2="1" k3="1" result="rg"/>
      <feComposite in="rg" in2="b" operator="arithmetic" k2="1" k3="1"/>`;
    svg.append(f);
    host._lgDom = f;
    target.style.backdropFilter = `url(#${id}) blur(1.5px) saturate(1.6)`;
  };

  const hosts = () => document.querySelectorAll('[data-glass]');
  const sizes = new ResizeObserver((es) => es.forEach((e) => apply(e.target)));
  const modes = new MutationObserver((ms) => ms.forEach((m) => apply(m.target)));
  const start = () => hosts().forEach((h) => {
    sizes.observe(h);
    modes.observe(h, { attributes: true, attributeFilter: ['data-glass-mode'] });
    apply(h);
  });
  // слои .lg-frost плагин создаёт после загрузки: начинаем чуть позже
  setTimeout(start, 400);
}
