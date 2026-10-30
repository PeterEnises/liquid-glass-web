# liquid-glass.js — «жидкое стекло» для статического сайта

Один ES-модуль без зависимостей (`liquid-glass.js`, 59 КБ исходника с комментариями, 20 КБ gzip; без минификации).
Сделан по `../SPEC.md`. Черновик от 30.10.2026. **В настоящем Safari и на iPhone пока не проверен.**

## Как устроено

У каждого стекла внутри элемента сайта (host) три слоя `aria-hidden`:

| слой | что делает | чем считается |
|---|---|---|
| `.lg-frost` | матовое стекло: `backdrop-filter: blur() saturate()` и тон | композитор, есть во всех браузерах |
| `canvas.lg-lens` | линза: преломление у кромки (`refract`, n = 1,5), радужная кайма (1/3/5 спектральных выборок), Френель, блик | WebGL2, картинка берётся текстурой из `<img>`/`<video>`/`<canvas>` |
| `.lg-rim` | кромка (три `inset box-shadow`) и свет сверху | CSS |

Тень даёт `box-shadow` у host. SVG-фильтров нет совсем, поэтому грабли Safari 27 из `CONTEXT.md`
(feImage, sRGB, `userSpaceOnUse`, `translate3d` внутри фильтра) этот код не задевают.

Над фото, видео и canvas стекло **жидкое**. Над живым DOM (текст, плитки) — **матовое**: пикселей под
элементом браузеры не отдают, а снимок DOM в текстуру дорогой и в WebKit ненадёжен (SPEC §1). Так же
делает Apple: Clear над медиа, Regular над остальным.

## Подключение

```html
<script type="module" src="/assets/lg/liquid-glass.js"></script>

<!-- медиа, через которое стекло преломляет -->
<figure class="hero__photo" data-glass-media="stack">          <!-- стопка слайдов, активный = .is-on -->
  <img class="is-on" src="hero-2000.webp" data-glass-src="hero-1000.webp" alt="…">
  <img src="…" data-glass-src="…" alt="…">
</figure>
<div class="hero__panel" data-glass-occluder>…</div>            <!-- DOM поверх фото: тут не преломлять -->

<!-- стёкла -->
<nav class="nav__row" data-glass data-glass-preset="bar" data-glass-over=".hero__photo">…</nav>
<figcaption data-glass data-glass-preset="pill">…</figcaption>    <!-- медиа = ближайшее data-glass-media -->
<span class="video__btn" data-glass="circle" data-glass-preset="dot" data-glass-over="poster">…</span>
```

Плагин сам находит `[data-glass]` и `[data-glass-media]` после загрузки DOM. WebGL-контекст создаётся
только когда стекло подходит к экрану.

Требования к вёрстке host:
- свой фон и `backdrop-filter` у host можно оставить: это и есть запасной вид без JS. Плагин на время
  работы делает фон host прозрачным (класс `.lg-host`), а матовость переносит на `.lg-frost`;
- `border-radius` у host задаёт форму стекла (`data-glass="capsule|circle"` — принудительно);
- если `position: static`, плагин ставит `relative`; если `z-index: auto`, ставит `0` (слои живут
  внутри host с отрицательным `z-index`).

## Атрибуты

| атрибут | значение |
|---|---|
| `data-glass="auto\|capsule\|circle\|rect"` | стекло; форма (`auto` — по `border-radius`) |
| `data-glass-preset="bar\|pill\|dot"` | набор параметров; без него — по размеру элемента |
| `data-glass-over` | селектор медиа, `poster` (картинка или `poster` видео в том же родителе), `none` (только матовое) |
| `data-glass-sync="content\|viewport"` | обычно не нужен: у `sticky`/`fixed` (и их потомков) — `viewport` |
| `data-glass-<параметр>` | любой параметр из таблицы ниже, например `data-glass-thickness="10"` |
| `data-glass-name` | имя в отладочном HUD |
| `data-glass-media="stack\|image\|video\|canvas"` | источник картинки |
| `data-glass-src` | у `<img>`: картинка поменьше для текстуры (≤ 1024 px, экономит память GPU) |
| `data-glass-active` | у стопки: селектор активного слайда (по умолчанию `.is-on`) |
| `data-glass-live` | у `<video>`: брать живые кадры (не чаще 30 Гц). Без него — постер |
| `data-glass-media-animated` | медиа анимировано (Ken Burns и т. п.): стекло над ним матовое |
| `data-glass-occluder` | DOM поверх медиа; до 4 на медиа, скругление из `border-radius` |

На host плагин ставит `data-glass-mode="liquid|frost|solid|off"` и `data-glass-tone="light|dark"`
(тон фона под стеклом, с гистерезисом). По тону сайт меняет цвет текста:

```css
.nav__row[data-glass-tone=dark] { color: #fff; }
```

## Параметры стекла

Пресеты (`bar / pill / dot`): `bevel` 14/10/16, `thickness` 12/8/14, `gap` 8/4/6, `profile`
squircle/squircle/circle, `dispersion` .04/.02/.02.

| параметр | по умолч. | смысл |
|---|---|---|
| `bevel` | 14 | ширина кромки, где поверхность гнётся; середина плоская и не искажает |
| `thickness`, `gap` | 12, 8 | толщина стекла и зазор до фона: сила сдвига у кромки |
| `profile` | squircle | `squircle` или `circle` |
| `ior` | 1.5 | показатель преломления |
| `dispersion` | .04 | разброс n между красным и синим; < .03 → одна выборка |
| `maxShift` | = bevel | предел сдвига, px |
| `bendSign` | 1 | 1 — край тянет картинку к центру, −1 — наружу |
| `frost` | .6 | матовость сквозь линзу (мип-уровни) |
| `saturate` | 1.5 | насыщенность |
| `tint`, `tintColor` | .26, #fff | тон стекла («тон 26 %» владелец сайтаа), общий для линзы и матового слоя |
| `lightAngle`, `specular` | −60, .5 | откуда свет и сила блика |
| `rim`, `topLight`, `shadow` | .4, .07, .7 | кромка, свет сверху, тень («кромка 40 %, свет 7 %, тень 70 %») |
| `frostBlur`, `clearBlur` | 20, 3 | размытие матового режима и середины в режиме «кольцо», px |
| `core` | из глобальных | `lens` — шейдер рисует всю линзу; `ring` — только кольцо кромки, середину ведёт композитор |
| `predict` | true | упреждение прокрутки на кадр (только `viewport`) |
| `fastScroll` | 1500 | px/с: быстрее — шапка временно матовая (только `lens`); 0 = выкл. |
| `motionBlur` | .002 | размытие по скорости прокрутки |
| `tone` | auto | `light`/`dark` — зафиксировать тон |

Старые числа из SVG-лаборатории (rim 4.5, bend −140…) в новые однозначно не переводятся: подбирать на
решётке в демо (раздел «Решётка для подбора», стекло там можно таскать).

## Программно

```js
import { glass } from './liquid-glass.js';

glass.configure({
  level: 'auto',       // auto | liquid | frost | solid | off — принудительно для всех
  user: 'auto',        // auto | frost | off — выбор посетителя («Без прозрачности»); off → плашка
  mobile: 'frost',     // телефоны до приёмки на iPhone — матовое; 'liquid' — включить
  core: 'lens',        // lens | ring
  samples: 'auto',     // auto | 1 | 3 | 5
  quality: 'auto',     // auto | high | low | css (без WebGL)
  maxContexts: 4, maxDpr: 2, maxTexture: 1024,
  debug: false,        // HUD с режимами
});

const hero = glass.media(document.querySelector('.hero__photo'));
hero.prepare(nextImg);       // заранее: decode → уменьшенная копия (в простое)
hero.show(nextImg);          // необязательно: смену .is-on плагин видит сам (MutationObserver)
glass.media(canvas).invalidate(); // canvas перерисован

const bar = glass.attach(el, { preset: 'bar', over: '.hero__photo' });
bar.set({ thickness: 10 });  // только uniform'ы
bar.mode;                    // 'liquid' | 'frost' | 'solid' | 'off'
bar.on('mode', ({ mode, reason }) => {});  // или событие 'glass:mode' на host
bar.refresh();               // пересчитать геометрию (после translate и т. п.)
bar.destroy();
glass.stats();               // сводка для замеров
```

Причины режима (`reason`): `user`, `no-media`, `no-webgl`, `loading`, `occluded`, `fast-scroll`,
`budget` (кончились контексты или регулятор), `context-lost`, `mobile-default`, `contrast`,
`reduced-transparency`, `forced-colors`, `print`, `animated-media`, `hidden`.

Адресная строка (для замеров): `?glass=liquid|frost|solid|off`, `?glass-core=lens|ring`,
`?glass-k=1|3|5`, `?glass-predict=0`, `?glass-debug=1`, `?glass-sw=1` (разрешить программный WebGL).

## Деградация

| условие | режим |
|---|---|
| `forced-colors`, печать | `off` |
| `prefers-contrast: more`, `prefers-reduced-transparency` (только Chromium), `user: 'off'`, нет `backdrop-filter` | `solid` (плашка 94 %) |
| нет WebGL2 или он программный (`failIfMajorPerformanceCaveat`), контекст потерян, телефон до приёмки, регулятор исчерпан, нет медиа под стеклом | `frost` |
| шапка ушла с фото (покрытие < 0,02, возврат > 0,05), очень быстрая прокрутка | `frost` |
| иначе | `liquid` |

- Регулятор: если 2 с подряд p95 интервала кадров > 1,25 × медианы или есть кадр > 50 мс, ступень
  вниз: K5 → K3 → K1 → frost. Решение хранится в `sessionStorage` до конца сессии.
- «Уменьшить движение»: без анимаций стекла, без размытия по скорости; преломление остаётся.
- «Уменьшить прозрачность» Safari и Firefox сайту не сообщают
  ([WebKit 175497](https://bugs.webkit.org/show_bug.cgi?id=175497),
  [caniuse](https://caniuse.com/wf-prefers-reduced-transparency)): нужен выключатель на сайте →
  `glass.configure({ user: 'off' })`.
- Без JS остаётся то, что написано в CSS сайта для host (обычно матовое).

## Что известно о поддержке (30.10.2026)

| где | статус |
|---|---|
| Chrome 1xx, Mac M4 Pro (Playwright, headless, ANGLE Metal) | **проверено нами**: страницы без ошибок, жидкое рисуется; замер 5 с: 60 fps, p95 16,7 мс, худший 16,8 мс, JS стекла ≈ 0,16 мс на кадр, долгих задач 0 — во всех режимах. Headless держит ровный такт, это оценка сверху по качеству, не по реальному экрану |
| Chrome без видеокарты (`--disable-gpu`) | **проверено**: WebGL2 отсекается, всё стекло матовое, ошибок нет |
| Playwright-WebKit | открывается без ошибок, WebGL2 есть, стёкла уходят в `liquid`. **Доказательством для Safari не считается** (CONTEXT.md) |
| Safari 26–27 Mac, iPhone | **не проверено** [Safari ?]. WebGL2 в Safari с 15-й версии [ист.]. По умолчанию на телефонах — матовое (`mobile: 'frost'`) |
| Firefox | не проверено. Ожидается `liquid` на десктопе |

Первая проверка в настоящем Safari — по SPEC §12.2: `demo/index.html` и `demo/bench.html` с
`python3 -I -m http.server 8731 --bind 127.0.0.1` из `glass-rnd/`.

Выбор путей загрузки текстуры: уменьшение через 2D-canvas, а не `createImageBitmap({resizeWidth})`.
Поддержка опций resize в Safari неполная
([Kaiido/createImageBitmap](https://github.com/Kaiido/createImageBitmap),
[interop#1390](https://github.com/web-platform-tests/interop/issues/1390)), а `flipY` у ImageBitmap
ведёт себя по-разному в движках ([playcanvas#9107](https://github.com/playcanvas/engine/issues/9107)).
Без `UNPACK_FLIP_Y` строка 0 текстуры — верх картинки, переворачивать ничего не нужно.

## Известные ограничения v0.1

- Один WebGL-контекст на видимое жидкое стекло, не больше 4 (SPEC §5.3). Остальные — `frost (budget)`,
  пока кто-то не уйдёт с экрана.
- Шапка `viewport` считает, что её положение во вьюпорте постоянно (липкая у `top: 0` или `fixed`).
  Пересчёт — по `scrollend` и изменению размеров.
- `core: 'ring'` сделан альфой по всему прямоугольнику (а не рамкой из 4 полос, как в SPEC): GPU всё
  равно красит середину, но прозрачным.
- Отставание линзы шапки от фото на кадр при прокрутке: упреждение есть, но его пользу надо мерить в
  Safari записью экрана (SPEC §6, R1).
