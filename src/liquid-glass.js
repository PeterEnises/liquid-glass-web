/*
 * liquid-glass.js — «жидкое стекло» для статических сайтов. ES-модуль, без зависимостей.
 * Версия 0.1 (черновик ночного прогона 30.10.2026), по glass-rnd/SPEC.md.
 *
 * Идея (SPEC §0, §2): у каждого стекла одни и те же слои внутри элемента сайта (host):
 *   .lg-frost   — матовое стекло на backdrop-filter (работает у всех, ведёт композитор);
 *   canvas.lg-lens — WebGL2-линза: преломление у кромки, радужная кайма, Френель, блик.
 *                 Картинку берёт текстурой прямо из <img>/<video>/<canvas>, а не из DOM;
 *   .lg-rim     — CSS-кромка и свет сверху (одинаковы во всех режимах, поэтому не прыгают).
 * Над живым DOM (текст, плитки) стекло честно матовое: пикселей под элементом браузер не отдаёт.
 * SVG-фильтров нет вовсе, поэтому грабли Safari 27 из CONTEXT.md (feImage, sRGB, userSpaceOnUse,
 * translate3d внутри фильтра) этого кода не касаются.
 *
 * Режимы стекла: liquid → frost → solid → off (лестница деградации, SPEC §6.3).
 * Сломалось что угодно в WebGL — остаётся законченное матовое стекло, а не дыра.
 *
 * ВНИМАНИЕ: в настоящем Safari и на iPhone этот код ещё не открывали [Safari ?].
 */

// ───────────────────────────── настройки ─────────────────────────────

/** Пресеты по SPEC §3.3: bar (капсула-шапка), pill (подпись), dot (круглая кнопка). */
const PRESETS = {
  // 30.10: подогнано под вид Chromium-стекла, которое понравилось Артёму: прозрачная середина, сильная кромка
  bar:  { bevel: 22, thickness: 22, gap: 8, profile: 'squircle', dispersion: 0.06, frost: 0.12, tint: 0.1 },
  pill: { bevel: 12, thickness: 12, gap: 4, profile: 'squircle', dispersion: 0.04, frost: 0.12, tint: 0.14 },
  dot:  { bevel: 18, thickness: 18, gap: 6, profile: 'circle',   dispersion: 0.04, frost: 0.12, tint: 0.14 },
};

/** Общие параметры одного стекла (все длины — CSS-пиксели). */
const GLASS_DEFAULTS = {
  shape: 'auto',        // auto | capsule | circle | rect
  preset: 'auto',       // auto | bar | pill | dot — auto выбирает по размеру
  over: undefined,      // селектор медиа | 'poster' | 'none' | объект Media
  sync: 'auto',         // auto | content | viewport
  bevel: 14, thickness: 12, gap: 8, profile: 'squircle',
  ior: 1.5,
  dispersion: 0.04,
  maxShift: 0,          // 0 = равен bevel
  bendSign: 1,          // 1 — кромка тянет картинку к центру, −1 — наружу (подбирать по решётке)
  frost: 0.6,           // доп. матовость сквозь линзу (мип-уровни)
  saturate: 1.5,
  tint: 0.26, tintColor: '#ffffff',
  lightAngle: -60,      // градусы, откуда свет
  specular: 0.5,
  rim: 0.4,             // сила кромки (Френель в шейдере + CSS-кромка)
  topLight: 0.07,       // свет сверху (CSS)
  shadow: 0.7,          // сила тени (CSS)
  frostBlur: 20,        // размытие матового режима, px
  clearBlur: 3,         // размытие середины в core: 'ring', px
  core: undefined,      // lens | ring; undefined = из глобальных настроек
  predict: true,        // упреждение прокрутки (только viewport)
  fastScroll: 1500,     // px/с: выше — шапка уходит в frost (только core: lens); 0 = выкл.
  motionBlur: 0.002,    // lod += motionBlur·|v|
  tone: 'auto',         // auto | light | dark — тон для цвета текста на стекле
};

/** Глобальные настройки (glass.configure). */
const cfg = {
  level: 'auto',        // auto | liquid | frost | solid | off — принудительный уровень (демо, ?glass=)
  quality: 'auto',      // auto | high (K5) | low (K1) | css (без WebGL)
  user: 'auto',         // auto | frost | off — выбор посетителя («Без прозрачности» на сайте)
  mobile: 'frost',      // что делать на телефонах до приёмки на iPhone: 'frost' | 'liquid'
  core: 'lens',         // lens | ring (SPEC §2.3)
  samples: 'auto',      // auto | 1 | 3 | 5 — спектральные выборки
  maxContexts: 4,
  maxDpr: 2,
  maxTexture: 1024,     // длинная сторона текстуры, px
  allowSoftware: false, // разрешить программный WebGL (SwiftShader) — только для тестов
  debug: false,
  autoInit: true,
};

// Адресная строка: только для замеров и отладки (SPEC §3.2).
(function readUrl() {
  let q;
  try { q = new URLSearchParams(location.search); } catch { return; }
  const g = q.get('glass');
  if (g && /^(auto|liquid|frost|solid|off)$/.test(g)) cfg.level = g;
  const core = q.get('glass-core');
  if (core === 'lens' || core === 'ring') cfg.core = core;
  const k = q.get('glass-k');
  if (k === '1' || k === '3' || k === '5') cfg.samples = +k;
  if (q.get('glass-predict') === '0') cfg._noPredict = true;
  if (q.get('glass-debug') === '1') cfg.debug = true;
  if (q.get('glass-sw') === '1') cfg.allowSoftware = true;
})();

// ───────────────────────────── окружение ─────────────────────────────

const mq = (s) => (typeof matchMedia === 'function' ? matchMedia(s) : { matches: false, addEventListener() {} });
const MQ = {
  forced: mq('(forced-colors: active)'),
  contrast: mq('(prefers-contrast: more)'),
  transparency: mq('(prefers-reduced-transparency: reduce)'),
  motion: mq('(prefers-reduced-motion: reduce)'),
  coarse: mq('(pointer: coarse)'),
  print: mq('print'),
};

const env = {
  get forcedColors() { return MQ.forced.matches; },
  get contrast() { return MQ.contrast.matches; },
  // Работает только в Chromium; Safari и Firefox этот запрос не отдают (WebKit 175497).
  get reducedTransparency() { return MQ.transparency.matches; },
  get reducedMotion() { return MQ.motion.matches; },
  get print() { return MQ.print.matches; },
  // Движок — по признакам, а не по @supports (SPEC §7). [Safari ?: живы ли признаки в Safari 27]
  webkit: typeof window !== 'undefined' &&
    ('GestureEvent' in window || 'webkitConvertPointFromNodeToPage' in window) &&
    !/Chrome|Chromium|Firefox|Edg\//.test(navigator.userAgent),
  get mobile() {
    // iPad с трекпадом отдаёт pointer: fine, поэтому ещё WebKit + несколько касаний.
    return MQ.coarse.matches || (this.webkit && navigator.maxTouchPoints > 1);
  },
  backdrop: typeof CSS !== 'undefined' &&
    (CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)')),
};

// ───────────────────────────── CSS плагина ─────────────────────────────
// Вставляется один раз. Значения backdrop-filter ставятся из JS готовой строкой: var() внутри
// -webkit-backdrop-filter в части версий Safari не работал [ист. не нашёл точного бага — Safari ?].

const CSS_TEXT = `
.lg-host{background:transparent!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
.lg-host[data-glass-mode=off]{background:Canvas!important;color:CanvasText}
.lg-frost,.lg-lens,.lg-rim{position:absolute;inset:0;border-radius:inherit;pointer-events:none}
.lg-frost{z-index:-3;background:rgb(255 255 255/.26);-webkit-backdrop-filter:blur(20px) saturate(1.8);backdrop-filter:blur(20px) saturate(1.8);transition:background-color .3s}
.lg-lens{z-index:-2;width:100%;height:100%;opacity:0;transition:opacity .16s linear}
.lg-host[data-glass-mode=liquid]>.lg-lens{opacity:1}
.lg-rim{z-index:-1;box-shadow:inset 0 1px 0 rgb(255 255 255/calc(var(--lg-rim,.4)*1.6)),inset 0 0 0 1px rgb(255 255 255/calc(var(--lg-rim,.4)*.55)),inset 0 -1px 0 rgb(0 0 0/calc(var(--lg-rim,.4)*.12))}
.lg-rim::after{content:"";position:absolute;inset:0;border-radius:inherit;background:linear-gradient(180deg,rgb(255 255 255/var(--lg-top,.07)),transparent 55%)}
.lg-host[data-glass-mode]{box-shadow:0 1px 2px rgb(0 0 0/calc(var(--lg-sh,.7)*.12)),0 8px 28px rgb(0 0 0/calc(var(--lg-sh,.7)*.2));transition:box-shadow .3s}
.lg-host[data-glass-mode=solid]>.lg-frost{background:rgb(250 250 250/.94)!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
.lg-host[data-glass-mode=solid]>.lg-lens,.lg-host[data-glass-mode=off]>.lg-lens,.lg-host[data-glass-mode=off]>.lg-frost,.lg-host[data-glass-mode=off]>.lg-rim{display:none}
@media (prefers-contrast:more){.lg-host[data-glass-mode]>.lg-rim{box-shadow:inset 0 0 0 1.5px currentColor}}
@media (prefers-reduced-motion:reduce){.lg-lens,.lg-frost,.lg-host[data-glass-mode]{transition:none!important}}
@media (forced-colors:active){.lg-frost,.lg-lens,.lg-rim{display:none!important}.lg-host{box-shadow:none!important}}
@media print{.lg-lens{display:none!important}.lg-frost{-webkit-backdrop-filter:none!important;backdrop-filter:none!important;background:#fff!important}}
`;

function injectCss() {
  if (document.getElementById('lg-style')) return;
  const s = document.createElement('style');
  s.id = 'lg-style';
  s.textContent = CSS_TEXT;
  document.head.prepend(s); // в начало head: стили сайта могут перекрыть
}

// ───────────────────────────── шейдер ─────────────────────────────

const VS = `#version 300 es
in vec2 aPos;
uniform vec2 uHalf;
out vec2 vP;               // CSS px от центра стекла, y вниз
void main(){ vP = aPos * uHalf * vec2(1., -1.); gl_Position = vec4(aPos, 0., 1.); }`;

// K (число спектральных выборок) подставляется при компиляции: 1, 3 или 5.
const FS = (K) => `#version 300 es
precision highp float;
#define K ${K}
uniform sampler2D uA, uB; uniform float uMix;
uniform vec2 uHalf; uniform float uR, uDpr;
uniform vec2 uOrigin;      // левый верхний угол стекла в px медиа
uniform vec4 uUV;          // uv = pm * uUV.xy + uUV.zw (object-fit уже учтён)
uniform vec2 uMedia;       // размер медиа, px
uniform float uBevel, uThick, uGap, uIor, uDisp, uMaxShift, uLod, uSat, uTint, uRim, uSpec, uLens, uRing, uSign, uProfile;
uniform vec3 uTintColor, uL;
uniform vec4 uOcc[4]; uniform float uOccR[4]; uniform int uOccN;
in vec2 vP; out vec4 o;

// SDF скруглённого прямоугольника с аналитическим градиентом (I. Quilez, distgradfunctions2d).
vec3 sdgRoundBox(vec2 p, vec2 b, float r){
  vec2 w = abs(p) - (b - r);
  vec2 s = vec2(p.x < 0. ? -1. : 1., p.y < 0. ? -1. : 1.);
  float g = max(w.x, w.y); vec2 q = max(w, 0.); float l = length(q);
  vec2 n = s * (g > 0. ? q / max(l, 1e-5) : (w.x > w.y ? vec2(1, 0) : vec2(0, 1)));
  return vec3((g > 0. ? l : g) - r, n);
}
float inBox(vec2 p, vec4 r, float rr){
  vec2 c = r.xy + r.zw * .5;
  return clamp(.5 - sdgRoundBox(p - c, r.zw * .5, min(rr, min(r.z, r.w) * .5)).x, 0., 1.);
}
vec3 tap(vec2 pm){
  vec2 uv = pm * uUV.xy + uUV.zw;
  vec3 a = textureLod(uA, uv, uLod).rgb;
  return uMix > 0. ? mix(a, textureLod(uB, uv, uLod).rgb, uMix) : a;
}
void main(){
  vec3 sg = sdgRoundBox(vP, uHalf, uR);
  float d = sg.x;
  float a = clamp(.5 - d * uDpr, 0., 1.);
  if (a <= 0.) discard;
  vec2 pm = uOrigin + vP + uHalf;           // точка в px медиа

  // У края медиа изгиб гаснет: за краем картинки нет (R10). Остаток дотягивает MIRRORED_REPEAT.
  float edge = min(min(pm.x, uMedia.x - pm.x), min(pm.y, uMedia.y - pm.y));
  float bend = uLens * smoothstep(0., uBevel * 2., edge);

  // Профиль кромки: x = 0 у края, 1 там, где начинается плоская середина.
  float x = clamp(-d / uBevel, .002, 1.), u = 1. - x, h, dh;
  if (uProfile < .5) { float u4 = u*u*u*u; h = pow(1. - u4, .25); dh = u*u*u * pow(1. - u4, -.75); } // сквиркл
  else { float s = sqrt(max(1. - u*u, 1e-4)); h = s; dh = u / s; }                                     // окружность
  vec3 N = normalize(vec3(sg.yz * uThick * dh / uBevel * bend, 1.));

  vec3 col = vec3(0), wsum = vec3(0);
  for (int i = 0; i < K; i++) {
    float t = K == 1 ? 0. : float(i) / float(K - 1) - .5;
    vec3 R = refract(vec3(0, 0, -1), N, 1. / (uIor + uDisp * t));
    vec2 off = uSign * R.xy * (uThick * h + uGap) / max(-R.z, .05);
    off *= min(1., uMaxShift / max(length(off), 1e-4));
    // веса выборок: красный (n меньше) → зелёный → синий; нормируются, белое остаётся белым
    vec3 w = K == 1 ? vec3(1) : clamp(vec3(-2.*t, 1. - abs(2.*t), 2.*t) + .35, 0., 1.); // у красного n меньше
    col += w * tap(pm + off); wsum += w;
  }
  col /= wsum;

  float lum = dot(col, vec3(.2126, .7152, .0722));
  col = mix(vec3(lum), col, uSat);
  col = mix(col, uTintColor, uTint);
  col = mix(col, vec3(1), (.04 + .96 * pow(1. - N.z, 5.)) * uRim);      // Френель (Шлик)
  vec3 H = normalize(uL + vec3(0, 0, 1));
  col += uSpec * (pow(max(dot(N, H), 0.), 40.) + .5 * pow(max(dot(N, H * vec3(-1, -1, 1)), 0.), 40.));

  // Покрытие: внутри медиа и не под окклюдером (DOM поверх фото, которого нет в текстуре).
  float cover = inBox(pm, vec4(0., 0., uMedia), 0.);
  for (int i = 0; i < 4; i++) if (i < uOccN) cover *= 1. - inBox(pm, uOcc[i], uOccR[i]);
  // core: ring — середина прозрачна, её показывает матовый слой (ведёт композитор, не отстаёт).
  float ring = mix(1., 1. - smoothstep(.75, 1., x), uRing);
  a *= cover * ring;
  o = vec4(clamp(col, 0., 1.) * a, a);
}`;

const UNIFORMS = ['uA', 'uB', 'uMix', 'uHalf', 'uR', 'uDpr', 'uOrigin', 'uUV', 'uMedia', 'uBevel', 'uThick',
  'uGap', 'uIor', 'uDisp', 'uMaxShift', 'uLod', 'uSat', 'uTint', 'uRim', 'uSpec', 'uLens', 'uRing', 'uSign',
  'uProfile', 'uTintColor', 'uL', 'uOcc', 'uOccR', 'uOccN'];

// ───────────────────────────── утилиты ─────────────────────────────

const now = () => performance.now();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const idle = (fn) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 800 }) : setTimeout(fn, 60));

function hexToRgb(hex) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(String(hex).trim());
  return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [1, 1, 1];
}

function readDataOptions(el) {
  // data-glass-thickness="10" → { thickness: 10 }
  const out = {};
  for (const [k, v] of Object.entries(el.dataset)) {
    if (!k.startsWith('glass') || k === 'glass' || k === 'glassMode' || k === 'glassTone') continue;
    let key = k.slice(5);
    key = key[0].toLowerCase() + key.slice(1);
    out[key] = v !== '' && !isNaN(+v) ? +v : v;
  }
  return out;
}

function waitLoad(img) {
  if (img.complete && img.naturalWidth) return Promise.resolve();
  return new Promise((res, rej) => {
    img.addEventListener('load', res, { once: true });
    img.addEventListener('error', rej, { once: true });
  });
}

// ───────────────────────────── источник картинки ─────────────────────────────
// Картинка уменьшается один раз в 2D-canvas (≤ maxTexture) и из него грузится в текстуры всех стёкол.
// createImageBitmap с resizeWidth не берём: в Safari поддержка опций неполная, а flipY у ImageBitmap
// ведёт себя по-разному в движках (playcanvas#9107) — путь через canvas одинаков везде.

class Source {
  constructor(el) {
    this.el = el;          // img | video | canvas
    this.canvas = null;    // уменьшенная копия (для img)
    this.w = 0; this.h = 0; // размер текстуры
    this.natW = 0; this.natH = 0; // «родной» размер (для object-fit)
    this.luma = null;      // сетка яркостей 16×9 для тона текста
    this.live = false;     // video/canvas: перезаливать при смене version
    this.version = 0;
    this.ready = null;
  }
  static forImage(img, srcOverride) {
    const s = new Source(img);
    s.ready = (async () => {
      let pic = img;
      if (srcOverride) { pic = new Image(); pic.decoding = 'async'; pic.src = srcOverride; }
      await waitLoad(pic);
      if (pic.decode) await pic.decode().catch(() => {});
      s.natW = img.naturalWidth || pic.naturalWidth; s.natH = img.naturalHeight || pic.naturalHeight;
      const k = Math.min(1, cfg.maxTexture / Math.max(pic.naturalWidth, pic.naturalHeight));
      s.w = Math.max(1, Math.round(pic.naturalWidth * k)); s.h = Math.max(1, Math.round(pic.naturalHeight * k));
      const c = document.createElement('canvas');
      c.width = s.w; c.height = s.h;
      c.getContext('2d').drawImage(pic, 0, 0, s.w, s.h);
      s.canvas = c;
      s.luma = lumaGrid(pic);
      return s;
    })();
    return s;
  }
  static forLive(el) { // video или canvas, кадр берётся как есть
    const s = new Source(el);
    s.live = true;
    s.ready = (async () => {
      if (el.tagName === 'VIDEO' && el.readyState < 2) await new Promise((r) => el.addEventListener('loadeddata', r, { once: true }));
      s.natW = el.videoWidth || el.width; s.natH = el.videoHeight || el.height;
      s.w = s.natW; s.h = s.natH;
      return s;
    })();
    return s;
  }
  get pixels() { return this.live ? this.el : this.canvas; }
}

function lumaGrid(pic) {
  const W = 16, H = 9, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true });
  try {
    x.drawImage(pic, 0, 0, W, H);
    const d = x.getImageData(0, 0, W, H).data, g = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) g[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
    return { W, H, g };
  } catch { return null; } // чужой домен без CORS
}

// ───────────────────────────── медиа ─────────────────────────────

const medias = new Map(); // el → Media

class Media {
  constructor(el, opts = {}) {
    this.el = el;
    this.opts = opts;
    const tag = el.tagName;
    this.kind = opts.kind || el.dataset.glassMedia ||
      (tag === 'IMG' ? 'image' : tag === 'VIDEO' ? 'video' : tag === 'CANVAS' ? 'canvas' : 'stack');
    if (this.kind === 'auto' || this.kind === '') this.kind = tag === 'IMG' ? 'image' : 'stack';
    this.animated = el.hasAttribute('data-glass-media-animated');
    this.sources = new Map();  // элемент → Source
    this.a = null;             // текущая картинка (Source)
    this.b = null;             // следующая при кроссфейде
    this.mix = 0;
    this.fadeEl = null;
    this.rect = { x: 0, y: 0, w: 0, h: 0 };  // в координатах документа
    this.fit = { sx: 1, sy: 1, ox: 0, oy: 0 }; // uv = pm*s + o
    this.lodBase = 0;
    this.occ = [];             // окклюдеры в px медиа: {x,y,w,h,r}
    this.glasses = new Set();
    this.visible = true;
    this._init();
  }

  /** Элемент, который сейчас показан (для стопки — активный слайд). */
  active() {
    if (this.kind !== 'stack') return this.el;
    const sel = this.opts.active || this.el.dataset.glassActive || '.is-on';
    return this.el.querySelector(sel) || this.el.querySelector('img');
  }

  _source(el) {
    let s = this.sources.get(el);
    if (!s) {
      if (el.tagName === 'IMG') s = Source.forImage(el, el.dataset.glassSrc);
      else if (el.tagName === 'VIDEO' && !(this.opts.live || el.hasAttribute('data-glass-live')) && el.poster) {
        const p = new Image(); p.src = el.poster;
        s = Source.forImage(p);
      } else s = Source.forLive(el);
      this.sources.set(el, s);
      s.ready.catch(() => {});
    }
    return s;
  }

  /** Заранее подготовить картинку (decode → canvas) — в простое, чтобы смена слайда не дёргалась. */
  prepare(el) { return this._source(el).ready; }

  /** Слайдер сообщает о смене; Promise — когда картинка готова. */
  show(el) { return this._switch(el || this.active()); }

  /** Для canvas/video: «кадр изменился». */
  invalidate() {
    const s = this.a; if (s) s.version++;
    for (const g of this.glasses) g.dirty = true;
    requestFrame();
  }

  _init() {
    const first = this.active();
    if (first) this._source(first).ready.then((s) => { if (!this.a) { this.a = s; remeasureSoon(); this._dirty(); this._prepareNext(); } }).catch(() => { this.failed = true; this._dirty(); });
    if (this.kind === 'stack') {
      this._mo = new MutationObserver(() => {
        const act = this.active();
        if (act && act !== this.fadeEl && (!this.a || act !== this.a.el)) this._switch(act);
      });
      this._mo.observe(this.el, { subtree: true, attributes: true, attributeFilter: ['class'] });
    }
    if (this.kind === 'video' && (this.opts.live || this.el.hasAttribute('data-glass-live'))) this._liveVideo();
  }

  async _switch(el) {
    const s = this._source(el);
    let src;
    try { src = await s.ready; } catch { return; }
    if (this.active() !== el && this.kind === 'stack') return; // слайд уже снова сменился
    if (!this.a) { this.a = src; this._dirty(); return; }
    if (src === this.a) return;
    if (this.b && this.mix > 0.5) this.a = this.b;
    this.b = src; this.fadeEl = el; this.mix = 0;
    this._dirty(true);
    this._prepareNext();
  }

  _prepareNext() {
    if (this.kind !== 'stack') return;
    idle(() => {
      const imgs = [...this.el.querySelectorAll('img')];
      const act = this.active(), i = imgs.indexOf(act);
      if (i >= 0 && imgs.length > 1) this.prepare(imgs[(i + 1) % imgs.length]).catch(() => {});
    });
  }

  /** Шаг кроссфейда: прогресс берём из той же CSS-анимации, что и у фото (SPEC §4.4). */
  stepFade() {
    if (!this.b) return false;
    let op = 1;
    try { op = parseFloat(getComputedStyle(this.fadeEl).opacity); } catch {}
    if (!(op >= 0)) op = 1;
    this.mix = op;
    if (op >= 0.999) { this.a = this.b; this.b = null; this.mix = 0; this.fadeEl = null; for (const g of this.glasses) g.toneDirty = true; return false; }
    return true;
  }

  _liveVideo() {
    const v = this.el;
    if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) return;
    let last = 0;
    const tick = (t) => {
      // не чаще 30 Гц и только пока видео играет и стекло над ним видно (SPEC §4.1)
      if (t - last > 33 && [...this.glasses].some((g) => g.visible && g.mode === 'liquid')) {
        last = t; if (this.a) this.a.version++;
        for (const g of this.glasses) g.dirty = true;
        requestFrame();
      }
      v.requestVideoFrameCallback(tick);
    };
    v.requestVideoFrameCallback(tick);
  }

  _dirty(fade) {
    for (const g of this.glasses) { g.dirty = true; g.toneDirty = true; if (fade) g.fading = true; }
    requestFrame();
  }

  measure(sx, sy) {
    const r = this.el.getBoundingClientRect();
    this.rect = { x: r.left + sx, y: r.top + sy, w: r.width, h: r.height };
    // object-fit/object-position → матрица UV (для стопки — по активному img)
    const pic = this.active();
    const nat = this.a || {};
    const iw = nat.natW || pic?.naturalWidth || r.width, ih = nat.natH || pic?.naturalHeight || r.height;
    let fit = 'fill', pos = ['50%', '50%'];
    if (pic && pic.tagName !== 'CANVAS') {
      const cs = getComputedStyle(pic);
      fit = cs.objectFit || 'fill';
      pos = (cs.objectPosition || '50% 50%').split(' ');
    }
    const W = r.width, H = r.height;
    let dw = W, dh = H;
    if (fit === 'cover' || fit === 'contain') {
      const s = fit === 'cover' ? Math.max(W / iw, H / ih) : Math.min(W / iw, H / ih);
      dw = iw * s; dh = ih * s;
    }
    const pp = (v, free) => (v.endsWith('%') ? (parseFloat(v) / 100) * free : parseFloat(v) || 0);
    const ox = pp(pos[0] || '50%', W - dw), oy = pp(pos[1] || '50%', H - dh);
    this.fit = { sx: 1 / dw, sy: 1 / dh, ox: -ox / dw, oy: -oy / dh };
    const texW = this.a ? this.a.w : iw;
    this.lodBase = Math.max(0, Math.log2(texW / (dw * Math.min(devicePixelRatio || 1, cfg.maxDpr))));
    // Окклюдеры: явные data-glass-occluder, пересекающие медиа; не больше 4 (SPEC §4.3).
    this.occ = [];
    for (const o of document.querySelectorAll('[data-glass-occluder]')) {
      const q = o.getBoundingClientRect();
      if (q.right <= r.left || q.left >= r.right || q.bottom <= r.top || q.top >= r.bottom) continue;
      const rr = parseFloat(getComputedStyle(o).borderTopLeftRadius) || 0;
      this.occ.push({ x: q.left - r.left, y: q.top - r.top, w: q.width, h: q.height, r: rr });
      if (this.occ.length === 4) break;
    }
  }

  /** Средняя яркость картинки под прямоугольником (px медиа), 0…1. */
  lumaAt(x, y, w, h) {
    const L = (this.b && this.mix > 0.5 ? this.b : this.a)?.luma;
    if (!L) return null;
    const f = this.fit;
    const u0 = clamp(x * f.sx + f.ox, 0, 1), u1 = clamp((x + w) * f.sx + f.ox, 0, 1);
    const v0 = clamp(y * f.sy + f.oy, 0, 1), v1 = clamp((y + h) * f.sy + f.oy, 0, 1);
    const i0 = Math.floor(u0 * (L.W - 1e-6)), i1 = Math.floor(u1 * (L.W - 1e-6));
    const j0 = Math.floor(v0 * (L.H - 1e-6)), j1 = Math.floor(v1 * (L.H - 1e-6));
    let s = 0, n = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { s += L.g[j * L.W + i]; n++; }
    return n ? s / n : null;
  }
}

function getMedia(el, opts) {
  if (!el) return null;
  let m = medias.get(el);
  if (!m) { m = new Media(el, opts); medias.set(el, m); observeMedia(m); }
  return m;
}

// ───────────────────────────── WebGL ─────────────────────────────

let glFailed = false;   // WebGL2 недоступен или программный: дальше даже не пробуем
let liveContexts = 0;

function createGL(canvas) {
  if (glFailed) return null;
  let gl = null;
  try {
    gl = canvas.getContext('webgl2', {
      alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false,
      preserveDrawingBuffer: false, powerPreference: 'low-power',
      failIfMajorPerformanceCaveat: !cfg.allowSoftware, // отсекает программный WebGL: там стекло дороже SVG
    });
  } catch { gl = null; }
  if (!gl) { glFailed = true; return null; }
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  return {
    gl, buf, progs: new Map(), // K → {p, u, ready}
    par: gl.getExtension('KHR_parallel_shader_compile'),
    tex: new Map(),            // Source → {t, version, used}
  };
}

function compile(G, K) {
  let pr = G.progs.get(K);
  if (pr) return pr;
  const gl = G.gl;
  const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const vs = mk(gl.VERTEX_SHADER, VS), fs = mk(gl.FRAGMENT_SHADER, FS(K));
  const p = gl.createProgram();
  gl.attachShader(p, vs); gl.attachShader(p, fs);
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  pr = { p, vs, fs, u: null, ready: false, failed: false };
  G.progs.set(K, pr);
  return pr;
}

/** Готова ли программа. С KHR_parallel_shader_compile не блокируем поток, пока драйвер компилирует. */
function progReady(G, pr) {
  if (pr.ready || pr.failed) return pr.ready;
  const gl = G.gl;
  if (G.par && !gl.getProgramParameter(pr.p, G.par.COMPLETION_STATUS_KHR)) return false;
  if (!gl.getProgramParameter(pr.p, gl.LINK_STATUS)) {
    console.warn('[liquid-glass] шейдер не собрался:', gl.getShaderInfoLog(pr.fs) || gl.getProgramInfoLog(pr.p));
    pr.failed = true; return false;
  }
  pr.u = {};
  for (const n of UNIFORMS) pr.u[n] = gl.getUniformLocation(pr.p, n.endsWith('Occ') || n === 'uOccR' ? n + '[0]' : n) || gl.getUniformLocation(pr.p, n);
  pr.ready = true;
  return true;
}

function texFor(G, src) {
  const gl = G.gl;
  let e = G.tex.get(src);
  if (e && (!src.live || e.version === src.version)) { e.used = now(); return e.t; }
  const px = src.pixels;
  if (!px) return null;
  if (!e) {
    // не больше 3 текстур на контекст: выбрасываем самую старую
    if (G.tex.size >= 3) {
      let old = null; for (const [k, v] of G.tex) if (!old || v.used < old[1].used) old = [k, v];
      gl.deleteTexture(old[1].t); G.tex.delete(old[0]);
    }
    e = { t: gl.createTexture(), version: -1, used: now() };
    G.tex.set(src, e);
  }
  gl.bindTexture(gl.TEXTURE_2D, e.t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); // строка 0 = верх картинки, uv.y вниз — переворот не нужен
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  try {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, px);
  } catch (err) { // чужая картинка без CORS → SecurityError
    G.tex.delete(src); gl.deleteTexture(e.t); throw err;
  }
  const mips = !src.live;
  if (mips) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
  e.version = src.version; e.used = now();
  return e.t;
}

function releaseGL(g) {
  const G = g.G; if (!G) return;
  g.G = null;
  try {
    for (const v of G.tex.values()) G.gl.deleteTexture(v.t);
    G.gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {}
  g.canvas.width = 0; g.canvas.height = 0; // освобождаем память холста сразу (iOS, pqina)
  liveContexts--;
  for (const o of glasses) if (o.noCtx) { o.noCtx = false; o.dirty = true; }
  // контекст привязан к canvas навсегда — следующий раз нужен новый canvas
  const c = g.canvas.cloneNode(); g.canvas.replaceWith(c); g.canvas = c; g._bindCanvas();
}

// ───────────────────────────── прокрутка и регулятор ─────────────────────────────

const scroll = { y: 0, v: 0, t: 0, last: 0, fast: false, slowSince: 0 };
const reg = {               // регулятор качества (SPEC §6.4)
  steps: [5, 3, 1], step: 0, exhausted: false,
  iv: [], t0: 0, lastFrame: 0, period: 1000 / 60,
};
try {
  const s = sessionStorage.getItem('lg-step');
  if (s != null) { reg.step = Math.min(+s, 3); reg.exhausted = reg.step >= 3; }
} catch {}

function samplesNow() {
  if (cfg.samples !== 'auto') return +cfg.samples;
  if (cfg.quality === 'high') return 5;
  if (cfg.quality === 'low') return 1;
  const base = env.mobile ? 1 : 0; // телефон стартует с K3
  return reg.steps[Math.min(reg.steps.length - 1, reg.step + base)];
}

function regSample(t, active) {
  const dt = t - reg.lastFrame;
  reg.lastFrame = t;
  if (!active || dt > 250) { reg.iv.length = 0; reg.t0 = t; return; }
  reg.iv.push(dt);
  if (t - reg.t0 < 2000 || reg.iv.length < 30) return;
  const s = [...reg.iv].sort((a, b) => a - b);
  const med = s[s.length >> 1], p95 = s[Math.floor(s.length * 0.95)], worst = s[s.length - 1];
  reg.period = med;
  // Период берём из медианы: при 30 Гц (энергосбережение iOS) не уходим в frost зря.
  if (cfg.samples === 'auto' && cfg.quality === 'auto' && (p95 > med * 1.25 || worst > 50)) {
    reg.step++;
    if (reg.step >= reg.steps.length) { reg.exhausted = true; reg.step = reg.steps.length; }
    try { sessionStorage.setItem('lg-step', String(reg.step)); } catch {}
    if (cfg.debug) console.info('[liquid-glass] регулятор: ступень', reg.step, { med, p95, worst });
    for (const g of glasses) g.dirty = true;
  }
  reg.iv.length = 0; reg.t0 = t;
}

function onScroll() {
  const t = now(), y = window.scrollY;
  const dt = t - scroll.t;
  if (dt > 0 && dt < 120) {
    const inst = ((y - scroll.y) / dt) * 1000;
    if (Math.sign(inst) !== Math.sign(scroll.v)) scroll.v = inst; // смена направления — сброс
    else scroll.v = scroll.v * 0.55 + inst * 0.45;              // EMA по 3–4 событиям
  } else scroll.v = 0;
  scroll.y = y; scroll.t = t; scroll.last = t;
  let any = false;
  for (const g of viewportGlasses) if (g.media && g.media.visible) { g.dirty = true; any = true; }
  if (any) requestFrame();
}

function onScrollEnd() {
  scroll.v = 0; scroll.fast = false;
  remeasureSoon(); // дрейф адресной строки iOS (SPEC §4.2)
  for (const g of viewportGlasses) g.dirty = true;
  requestFrame();
}

// ───────────────────────────── стекло ─────────────────────────────

const glasses = new Set();
const viewportGlasses = new Set();
const hostMap = new WeakMap();

class Glass {
  constructor(host, opts = {}) {
    this.host = host;
    const dataOpts = readDataOptions(host);
    const shape = host.dataset.glass && host.dataset.glass !== 'true' ? host.dataset.glass : undefined;
    this.raw = { ...dataOpts, ...(shape ? { shape } : {}), ...opts };
    this.mode = '';
    this.reason = '';
    this.visible = true;
    this.dirty = true;
    this.toneDirty = true;
    this.fading = false;
    this.lens = 0;            // нарастание изгиба uLens 0→1
    this.lensT = 0;
    this.listeners = new Set();
    this.draws = 0;
    this.G = null;
    this.coverIn = false;
    this._build();
    this.setOptions(this.raw);
    glasses.add(this);
    hostMap.set(host, this);
  }

  _build() {
    const h = this.host, cs = getComputedStyle(h);
    if (cs.position === 'static') h.style.position = 'relative';
    if (cs.zIndex === 'auto') h.style.zIndex = '0'; // свой контекст наложения: слои с z-index<0 остаются внутри
    h.classList.add('lg-host');
    const mk = (tag, cls) => { const e = document.createElement(tag); e.className = cls; e.setAttribute('aria-hidden', 'true'); return e; };
    this.frost = mk('div', 'lg-frost');
    this.canvas = mk('canvas', 'lg-lens');
    this.rimEl = mk('div', 'lg-rim');
    h.prepend(this.frost, this.canvas, this.rimEl);
    this._bindCanvas();
  }

  _bindCanvas() {
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (!this.G || this.G.gl.canvas !== e.target) return; // это мы сами освободили контекст
      this.lost = true; this.G = null; liveContexts--; this.dirty = true; requestFrame();
    });
    this.canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this.dirty = true; requestFrame(); });
  }

  /** Сливает пресет, data-атрибуты и опции; меняет только uniform'ы, без пересборки. */
  setOptions(o) {
    const r = this.host.getBoundingClientRect();
    let preset = o.preset || this.raw.preset || 'auto';
    if (preset === 'auto') {
      // пресет по размеру, а не по имени элемента (L5 аудита)
      preset = r.width > 3 * r.height && r.height <= 120 ? (r.width > 360 ? 'bar' : 'pill') : (Math.abs(r.width - r.height) < 4 ? 'dot' : 'pill');
    }
    this.p = { ...GLASS_DEFAULTS, ...(PRESETS[preset] || {}), ...this.raw, ...o, preset };
    if (this.p.dispersion < 0.03 && cfg.samples === 'auto') this.p._k1 = true; // слабая дисперсия — хватит одной выборки
    else this.p._k1 = false;
    this.tintRgb = hexToRgb(this.p.tintColor);
    // медиа под стеклом
    this.media?.glasses.delete(this);
    this.media = this._resolveMedia(this.p.over);
    this.media?.glasses.add(this);
    // синхронизация: sticky/fixed у host или предков → viewport
    let sync = this.p.sync;
    if (sync === 'auto') {
      sync = 'content';
      for (let e = this.host; e && e !== document.body; e = e.parentElement) {
        const pos = getComputedStyle(e).position;
        if (pos === 'fixed' || pos === 'sticky') { sync = 'viewport'; break; }
      }
    }
    this.sync = sync;
    if (sync === 'viewport') viewportGlasses.add(this); else viewportGlasses.delete(this);
    // CSS-часть
    const st = this.host.style;
    st.setProperty('--lg-rim', String(this.p.rim));
    st.setProperty('--lg-top', String(this.p.topLight));
    this._shadow();
    this._frostStyle();
    this.measure();
    this.dirty = true;
    requestFrame();
  }

  _shadow() { this.host.style.setProperty('--lg-sh', String(this.p.shadow * (this.media && this.coverIn ? 1 : 0.5))); }

  _frostStyle() {
    const ring = this.mode === 'liquid' && this.core() === 'ring';
    const blur = ring ? this.p.clearBlur : this.p.frostBlur;
    const f = `blur(${blur}px) saturate(${ring ? 1.2 : 1.8})`;
    if (this._lastF === f) return;
    this._lastF = f;
    const s = this.frost.style, [r, g, b] = this.tintRgb.map((v) => Math.round(v * 255));
    s.webkitBackdropFilter = f; s.backdropFilter = f;
    s.backgroundColor = `rgb(${r} ${g} ${b} / ${ring ? this.p.tint * 0.5 : this.p.tint})`;
  }

  _resolveMedia(over) {
    if (over && typeof over === 'object' && over instanceof Media) return over;
    if (over === 'none') return null;
    if (over === 'poster') {
      const box = this.host.parentElement;
      const v = box?.querySelector('video');
      const img = box?.querySelector(':scope > img') || box?.querySelector('img');
      return getMedia(v || img);
    }
    if (typeof over === 'string' && over) return getMedia(document.querySelector(over));
    if (over && over.nodeType === 1) return getMedia(over);
    // по умолчанию — ближайший предок или сосед с data-glass-media
    const anc = this.host.closest('[data-glass-media]');
    if (anc) return getMedia(anc);
    for (let e = this.host.parentElement, i = 0; e && i < 4; e = e.parentElement, i++) {
      const m = e.querySelector(':scope > [data-glass-media]');
      if (m) return getMedia(m);
    }
    return null;
  }

  core() { return this.p.core || cfg.core; }

  measure() {
    const sx = window.scrollX, sy = window.scrollY;
    const r = this.host.getBoundingClientRect();
    this.w = r.width; this.h = r.height;
    this.vp = { x: r.left, y: r.top };              // для viewport: положение во вьюпорте
    this.doc = { x: r.left + sx, y: r.top + sy };   // для content: в документе
    const br = parseFloat(getComputedStyle(this.host).borderTopLeftRadius) || 0;
    const half = Math.min(r.width, r.height) / 2;
    const sh = this.p.shape;
    this.radius = sh === 'capsule' || sh === 'circle' ? half : Math.min(br, half);
    if (this.media) this.media.measure(sx, sy);
    this.dirty = true; this.toneDirty = true;
  }

  /** Левый верхний угол стекла в px медиа (с упреждением для viewport). */
  origin() {
    const m = this.media.rect;
    if (this.sync === 'viewport') {
      let y = window.scrollY, x = window.scrollX;
      if (this.p.predict && !cfg._noPredict && Math.abs(scroll.v) > 30 && now() - scroll.last < 100) {
        // упреждение на один кадр: композитор покажет прокрутку раньше, чем наш canvas
        const max = document.documentElement.scrollHeight - innerHeight;
        y = clamp(y + scroll.v * (reg.period / 1000), 0, max);
      }
      return { x: this.vp.x - (m.x - x), y: this.vp.y - (m.y - y) };
    }
    return { x: this.doc.x - m.x, y: this.doc.y - m.y };
  }

  /** Доля стекла над медиа без окклюдеров (по прямоугольникам, без пикселей). */
  coverage(o) {
    const m = this.media, W = this.w, H = this.h;
    if (!W || !H) return 0;
    const ix = (ax, aw, bx, bw) => Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx));
    let a = ix(o.x, W, 0, m.rect.w) * ix(o.y, H, 0, m.rect.h);
    for (const q of m.occ) a -= ix(o.x, W, q.x, q.w) * ix(o.y, H, q.y, q.h);
    return Math.max(0, a) / (W * H);
  }

  /** Автомат режимов (SPEC §6.3): сверху вниз, первое сработавшее. */
  decide(o) {
    const L = cfg.level;
    if (env.forcedColors || env.print) return ['off', env.print ? 'print' : 'forced-colors'];
    if (L === 'off') return ['off', 'user'];
    if (env.contrast) return ['solid', 'contrast'];
    if (env.reducedTransparency) return ['solid', 'reduced-transparency'];
    if (L === 'solid' || cfg.user === 'off') return ['solid', 'user'];
    if (!env.backdrop) return ['solid', 'no-backdrop'];
    if (L === 'frost' || cfg.user === 'frost' || cfg.quality === 'css') return ['frost', 'user'];
    if (!this.media) return ['frost', 'no-media'];
    if (glFailed) return ['frost', 'no-webgl'];
    if (env.mobile && cfg.mobile === 'frost' && L !== 'liquid') return ['frost', 'mobile-default'];
    if (this.lost) return ['frost', 'context-lost'];
    if (this.noCtx) return ['frost', 'budget'];
    if (reg.exhausted && cfg.samples === 'auto') return ['frost', 'budget'];
    if (this.media.animated) return ['frost', 'animated-media'];
    if (this.media.failed) return ['frost', 'no-media'];
    if (!this.media.a) return ['frost', 'loading'];
    // покрытие с гистерезисом: < 0,02 — frost, > 0,05 — liquid
    const c = this.coverage(o);
    this.cov = c;
    if (this.coverIn ? c < 0.02 : c <= 0.05) { this.coverIn = false; return ['frost', 'occluded']; }
    this.coverIn = true;
    if (this.sync === 'viewport' && this.core() === 'lens' && this.p.fastScroll > 0) {
      const v = Math.abs(scroll.v), t = now();
      if (v > this.p.fastScroll) { scroll.fast = true; scroll.slowSince = 0; }
      else if (scroll.fast) {
        if (v < 400) { scroll.slowSince ||= t; if (t - scroll.slowSince > 120 || t - scroll.last > 150) scroll.fast = false; }
        else scroll.slowSince = 0;
      }
      if (scroll.fast) return ['frost', 'fast-scroll'];
    }
    if (!this.visible) return [this.mode === 'liquid' ? 'liquid' : 'frost', 'hidden'];
    return ['liquid', ''];
  }

  _setMode(mode, reason) {
    if (mode === this.mode && reason === this.reason) return;
    const prev = this.mode;
    this.mode = mode; this.reason = reason;
    this.host.dataset.glassMode = mode;
    if (mode === 'liquid' && prev !== 'liquid') { this.lens = env.reducedMotion ? 1 : 0; this.lensT = now(); }
    this._frostStyle();
    if (mode !== prev) {
      const detail = { mode, reason };
      this.host.dispatchEvent(new CustomEvent('glass:mode', { detail }));
      for (const f of this.listeners) try { f(detail); } catch (e) { console.error(e); }
    }
  }

  _tone(o) {
    if (this.p.tone !== 'auto') { this.host.dataset.glassTone = this.p.tone; return; }
    if (this.mode === 'solid') { this.host.dataset.glassTone = 'light'; return; }
    let l = null;
    if (this.media && this.media.a && (this.cov ?? 1) > 0.3) l = this.media.lumaAt(o.x, o.y, this.w, this.h);
    if (l == null) l = 0.9; // над белой страницей
    l = l + (1 - l) * this.p.tint * 0.5; // тонировка стекла немного осветляет фон под текстом
    const cur = this.host.dataset.glassTone;
    const next = cur === 'dark' ? (l > 0.58 ? 'light' : 'dark') : (l < 0.42 ? 'dark' : 'light'); // гистерезис
    if (next !== cur) this.host.dataset.glassTone = next;
  }

  /** Один шаг кадра. Возвращает true, если нужен следующий кадр. */
  update(t) {
    let again = false;
    const o = this.media ? this.origin() : { x: 0, y: 0 };
    const [mode, reason] = this.decide(o);
    this._setMode(mode, reason);
    const wasCover = this._cov0; this._cov0 = this.coverIn;
    if (wasCover !== this.coverIn) this._shadow();
    if (this.toneDirty || this.sync === 'viewport') { this._tone(o); this.toneDirty = false; }
    if (this.media?.b) again = this.media.stepFade() || again;
    if (mode !== 'liquid' || !this.visible) return again;
    if (this.lens < 1) {
      if (t < this.lensT) this.lensT = t; // rAF-время бывает чуть раньше performance.now()
      const k = clamp((t - this.lensT) / 250, 0, 1);
      this.lens = k >= 1 ? 1 : 1 - (1 - k) ** 3; // плавный выход
      this.dirty = true; again = true;
    }
    if (this.media.b) this.dirty = true;
    if (!this.dirty) return again;
    if (!this.G && !this._ensureGL()) return false;
    const ok = this._draw(o);
    if (ok === 'wait') return true; // программа ещё компилируется
    this.dirty = false;
    // прокрутка продолжается — следующий кадр поставит событие scroll; затухание скорости:
    if (this.sync === 'viewport' && scroll.v !== 0 && t - scroll.last > 100) { scroll.v = 0; this.dirty = true; again = true; }
    return again;
  }

  _ensureGL() {
    if (liveContexts >= cfg.maxContexts) {
      // освобождаем контекст у невидимого стекла (iOS ограничивает память холстов)
      // сначала невидимые, потом те, что сейчас не жидкие (шапка над текстом и т. п.)
      const victim = [...glasses].find((g) => g.G && !g.visible) || [...glasses].find((g) => g.G && g !== this && g.mode !== 'liquid');
      if (victim) releaseGL(victim);
      else { this.noCtx = true; this._setMode('frost', 'budget'); return false; }
    }
    this.G = createGL(this.canvas);
    if (!this.G) { this._setMode('frost', 'no-webgl'); return false; }
    liveContexts++;
    compile(this.G, samplesNow());
    return true;
  }

  _draw(o) {
    const t0 = now();
    const G = this.G, gl = G.gl, p = this.p, m = this.media;
    let K = p._k1 ? 1 : samplesNow();
    const pr = compile(G, K);
    if (!progReady(G, pr)) {
      if (pr.failed) { glFailed = true; return false; }
      return 'wait';
    }
    const dpr = Math.min(devicePixelRatio || 1, cfg.maxDpr);
    const cw = Math.max(1, Math.round(this.w * dpr)), ch = Math.max(1, Math.round(this.h * dpr));
    if (this.canvas.width !== cw || this.canvas.height !== ch) { this.canvas.width = cw; this.canvas.height = ch; }
    let ta, tb;
    try {
      ta = texFor(G, m.a);
      tb = m.b ? texFor(G, m.b) : ta;
    } catch { m.failed = true; return false; }
    if (!ta) return 'wait';
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(pr.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, G.buf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ta);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tb);
    const u = pr.u;
    gl.uniform1i(u.uA, 0); gl.uniform1i(u.uB, 1);
    gl.uniform1f(u.uMix, m.b ? m.mix : 0);
    gl.uniform2f(u.uHalf, this.w / 2, this.h / 2);
    gl.uniform1f(u.uR, this.radius);
    gl.uniform1f(u.uDpr, dpr);
    gl.uniform2f(u.uOrigin, o.x, o.y);
    gl.uniform4f(u.uUV, m.fit.sx, m.fit.sy, m.fit.ox, m.fit.oy);
    gl.uniform2f(u.uMedia, m.rect.w, m.rect.h);
    gl.uniform1f(u.uBevel, Math.max(1, Math.min(p.bevel, Math.min(this.w, this.h) / 2)));
    gl.uniform1f(u.uThick, p.thickness);
    gl.uniform1f(u.uGap, p.gap);
    gl.uniform1f(u.uIor, p.ior);
    gl.uniform1f(u.uDisp, p.dispersion);
    gl.uniform1f(u.uMaxShift, p.maxShift || p.bevel);
    const blur = this.sync === 'viewport' && !env.reducedMotion ? p.motionBlur * Math.abs(scroll.v) : 0;
    gl.uniform1f(u.uLod, m.lodBase + p.frost + Math.min(blur, 3));
    gl.uniform1f(u.uSat, p.saturate);
    gl.uniform1f(u.uTint, p.tint);
    gl.uniform3f(u.uTintColor, ...this.tintRgb);
    gl.uniform1f(u.uRim, p.rim);
    gl.uniform1f(u.uSpec, p.specular);
    const a = (p.lightAngle * Math.PI) / 180;
    gl.uniform3f(u.uL, Math.cos(a) * 0.6, Math.sin(a) * 0.6, 0); // y вниз: −60° — свет сверху-слева… сверху
    gl.uniform1f(u.uLens, this.lens);
    gl.uniform1f(u.uRing, this.core() === 'ring' ? 1 : 0);
    gl.uniform1f(u.uSign, p.bendSign >= 0 ? 1 : -1);
    gl.uniform1f(u.uProfile, p.profile === 'circle' ? 1 : 0);
    const occ = new Float32Array(16), occR = new Float32Array(4);
    m.occ.forEach((q, i) => { occ.set([q.x, q.y, q.w, q.h], i * 4); occR[i] = q.r; });
    gl.uniform4fv(u.uOcc, occ); gl.uniform1fv(u.uOccR, occR); gl.uniform1i(u.uOccN, m.occ.length);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.draws++;
    this.K = K;
    stats.drawMs += now() - t0; stats.draws++;
    // в простое докомпилировать соседние ступени, чтобы смена качества не дёргала кадр
    if (!G._warm) { G._warm = true; idle(() => { if (this.G === G) [5, 3, 1].forEach((k) => compile(G, k)); }); }
    return true;
  }

  // ── публичное API стекла ──
  set(o) { Object.assign(this.raw, o); this.setOptions({}); return this; }
  on(ev, f) { if (ev === 'mode') this.listeners.add(f); return () => this.listeners.delete(f); }
  refresh() { this.measure(); requestFrame(); }
  destroy() {
    releaseGL(this);
    this.frost.remove(); this.canvas.remove(); this.rimEl.remove();
    this.host.classList.remove('lg-host');
    delete this.host.dataset.glassMode; delete this.host.dataset.glassTone;
    this.media?.glasses.delete(this);
    glasses.delete(this); viewportGlasses.delete(this);
    io?.unobserve(this.host); ro?.unobserve(this.host);
  }
}

// ───────────────────────────── планировщик кадров ─────────────────────────────

const stats = { drawMs: 0, draws: 0, frames: 0 };
let raf = 0;
function requestFrame() { if (!raf && !document.hidden) raf = requestAnimationFrame(frame); }

function frame(t) {
  raf = 0;
  stats.frames++;
  const scrolling = t - scroll.last < 150;
  regSample(t, scrolling && [...viewportGlasses].some((g) => g.mode === 'liquid'));
  let again = false;
  for (const g of glasses) {
    try { if (g.update(t)) again = true; }
    catch (e) { console.error('[liquid-glass]', e); g._setMode('frost', 'error'); }
  }
  if (again || scrolling) requestFrame();
  if (cfg.debug) hud(t);
}

// ───────────────────────────── наблюдатели ─────────────────────────────

let io = null, ioMedia = null, ro = null, started = false, remeasureTimer = 0;

function remeasureSoon() {
  clearTimeout(remeasureTimer);
  remeasureTimer = setTimeout(() => { for (const g of glasses) g.measure(); requestFrame(); }, 60);
}

function observeMedia(m) {
  ioMedia?.observe(m.el);
  ro?.observe(m.el);
}

function startObservers() {
  if (started) return;
  started = true;
  // Контекст и текстуры создаются при первом пересечении с экраном (ashk.au: так меньше вылетов Safari).
  io = new IntersectionObserver((es) => {
    let freed = false;
    for (const e of es) {
      const g = hostMap.get(e.target); if (!g) continue;
      g.visible = e.isIntersecting; g.dirty = true;
      if (g.visible) g.noCtx = false;      // появилось — пробуем получить контекст снова
      else if (g.G) freed = true;           // ушло — его контекст можно отдать другим
    }
    if (freed) for (const g of glasses) if (g.noCtx && g.visible) g.noCtx = false;
    requestFrame();
  }, { rootMargin: '64px' });
  // Медиа ушло с экрана — слушатель прокрутки шапки ничего не делает.
  ioMedia = new IntersectionObserver((es) => {
    for (const e of es) { const m = medias.get(e.target); if (m) { m.visible = e.isIntersecting; for (const g of m.glasses) g.dirty = true; } }
    requestFrame();
  }, { rootMargin: '100px' });
  ro = new ResizeObserver(remeasureSoon);
  for (const g of glasses) { io.observe(g.host); ro.observe(g.host); }
  for (const m of medias.values()) observeMedia(m);
  addEventListener('scroll', onScroll, { passive: true });
  if ('onscrollend' in window) addEventListener('scrollend', onScrollEnd, { passive: true });
  else { let to = 0; addEventListener('scroll', () => { clearTimeout(to); to = setTimeout(onScrollEnd, 140); }, { passive: true }); }
  addEventListener('resize', remeasureSoon);
  window.visualViewport?.addEventListener('resize', remeasureSoon); // iOS 26: прыжки fixed (WebKit 297779)
  document.fonts?.ready.then(remeasureSoon);
  addEventListener('load', remeasureSoon);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { for (const g of glasses) g.dirty = true; requestFrame(); } });
  for (const k of Object.keys(MQ)) MQ[k].addEventListener?.('change', () => { for (const g of glasses) { g.dirty = true; g._lastF = ''; g._frostStyle(); } requestFrame(); });
}

// ───────────────────────────── отладочный HUD ─────────────────────────────

let hudEl = null, hudT = 0;
function hud(t) {
  if (t - hudT < 400) return;
  hudT = t;
  if (!hudEl) {
    hudEl = document.createElement('pre');
    hudEl.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483647;margin:0;padding:8px 10px;font:11px/1.35 ui-monospace,Menlo,monospace;color:#fff;background:rgb(0 0 0/.72);border-radius:8px;pointer-events:none;max-width:90vw;white-space:pre-wrap';
    document.body.append(hudEl);
  }
  const lines = [`уровень ${cfg.level} · K ${samplesNow()} · ступень ${reg.step} · v ${Math.round(scroll.v)} px/с · контекстов ${liveContexts}`];
  for (const g of glasses) {
    const name = g.host.dataset.glassName || g.host.id || [...g.host.classList].filter((c) => c !== 'lg-host').pop() || g.host.tagName;
    lines.push(`${name.slice(0, 18).padEnd(18)} ${g.mode.padEnd(6)} ${g.reason || '—'} ${g.sync === 'viewport' ? 'vp' : ''} покр ${(g.cov ?? 0).toFixed(2)} рис ${g.draws}`);
  }
  hudEl.textContent = lines.join('\n');
}

// ───────────────────────────── публичное API ─────────────────────────────

function init(root = document) {
  injectCss();
  startObservers();
  for (const el of root.querySelectorAll('[data-glass-media]')) getMedia(el);
  for (const el of root.querySelectorAll('[data-glass]')) if (!hostMap.has(el)) attach(el);
  requestFrame();
}

function attach(host, opts) {
  injectCss();
  startObservers();
  const existing = hostMap.get(host);
  if (existing) return existing.set(opts || {});
  const g = new Glass(host, opts);
  io.observe(host); ro.observe(host);
  return g;
}

export const glass = {
  /** Глобальные настройки. Можно звать в любой момент: стёкла пересчитаются. */
  configure(o = {}) {
    Object.assign(cfg, o);
    if ('samples' in o || 'quality' in o) { reg.step = 0; reg.exhausted = false; try { sessionStorage.removeItem('lg-step'); } catch {} }
    for (const g of glasses) { g.dirty = true; g._lastF = ''; g._frostStyle(); }
    requestFrame();
    return { ...cfg };
  },
  init,
  attach,
  /** Зарегистрировать медиа (img | video | canvas | контейнер-стопка). */
  media(el, opts) { injectCss(); startObservers(); return getMedia(el, opts); },
  get(host) { return hostMap.get(host) || null; },
  get list() { return [...glasses]; },
  /** Сводка для замеров (bench.html). */
  stats() {
    return {
      level: cfg.level, samples: samplesNow(), step: reg.step, contexts: liveContexts,
      draws: stats.draws, drawMs: stats.drawMs, frames: stats.frames,
      glasses: [...glasses].map((g) => ({ mode: g.mode, reason: g.reason, sync: g.sync, draws: g.draws, K: g.K })),
      env: { mobile: env.mobile, webkit: env.webkit, backdrop: env.backdrop, webgl2: !glFailed },
    };
  },
  resetStats() { stats.drawMs = 0; stats.draws = 0; stats.frames = 0; },
  presets: PRESETS,
  version: '0.1.0',
};

export default glass;

// Автозапуск: setTimeout, чтобы glass.configure() из кода страницы успел выполниться раньше.
if (typeof document !== 'undefined') {
  const go = () => setTimeout(() => { if (cfg.autoInit) init(); }, 0);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true });
  else go();
}
