# Плагин «жидкого стекла»: итоговая спецификация

Дата: 30.10.2026. Это итог ночного прогона, кода пока нет. Документ сводит в одно:
- проекты `design/hybrid.md` (победитель), `design/gpu.md`, `design/free.md`, `design/svg.md`;
- исследования `research/*.md`: apple, audit, browsers, fresh, graphics, implementations, performance;
- две оценки судей.

Живой сайт `<сайт>/` не трогал. Встраивание решает владелец сайта.

**Метки** (как в проектах):
- **[S27]**: проверено владелец сайтаом в настоящем Safari 27 на Mac (из `CONTEXT.md`);
- **[Chrome]**: измерено нами в Chrome (аудит);
- **[ист.]**: взято из источника по ссылке, нами не проверено;
- **[оценка]**: расчёт на бумаге;
- **[Safari ?]**: в настоящем Safari или на iPhone не проверено. Playwright-WebKit доказательством не считается [S27].

> Главное ограничение всего документа. Ни один WebGL-вариант ещё не открывали в настоящем Safari и
> на iPhone. Все цифры скорости ниже — оценки, а опираются они на один чужой замер
> ([m2-md](https://github.com/m2-md/liquid-glass-refraction-shader/blob/main/README.md): M2 Pro, Chrome).
> Поэтому первая работа — прототип шапки и замер в настоящем Safari (раздел 12). Выбор архитектуры
> держится, только если прототип его подтвердит.

---

## 0. Коротко

1. **Основа — гибрид «по содержимому»** (hybrid). Над фото и видео преломление считает один
   WebGL2-шейдер, а картинку берёт текстурой прямо из `<img>`/`<video>`. Над всем остальным стекло
   матовое, на `backdrop-filter`. В плагине нет ни одного SVG-фильтра, поэтому грабли Safari 27
   (feImage, sRGB, `userSpaceOnUse`, `translate3d` внутри фильтра, программный путь фильтров) нас не
   касаются.
2. **Ядро шейдера взято из gpu**: аналитический SDF с градиентом, профиль сквиркла, `refract()` с
   n = 1,5, 3–5 спектральных выборок с нормированными весами, Френель по Шлику, матовость через
   мип-уровни. Без библиотек, около 5–7 КБ gzip на ядро.
3. **Слои у всех стёкол одинаковые.** Прозрачный host, под ним матовый слой, на нём canvas с линзой,
   поверх CSS-кромка и блик. Тень даёт `box-shadow` у host. Сломалось что угодно в WebGL — остаётся
   законченное матовое стекло, а не дыра. Без JS тоже матовое: уровень L1 на чистом CSS (из svg).
4. **Два способа синхронизации с прокруткой.** Стекло, которое едет вместе с картинкой (кнопки ▶,
   подпись и «пауза» на фото), рисуется один раз и при прокрутке не перерисовывается
   (`sync: content`). Перерисовка на каждом кадре нужна только шапке (`sync: viewport`). Против её
   отставания на кадр есть три средства: упреждение `scrollY`, режим «кольцо» (из free) как A/B и
   уход в матовое на очень быстрой прокрутке.
5. **v1 простой, v2 по нужде.** В v1 входят: окклюдеры только явные и не больше 4 (для `.hero__panel`
   сайт-пример), без автопоиска; по контексту WebGL на стекло, не больше 4. Общий `OffscreenCanvas`,
   автопоиск окклюдеров, живое видео на iPhone, модуль для Chromium над DOM — это v2.
6. **Доступность.** `prefers-contrast: more` → сплошная плашка. `forced-colors` → без стекла.
   «Уменьшить прозрачность» Safari сайту не сообщает
   ([WebKit 175497](https://bugs.webkit.org/show_bug.cgi?id=175497),
   [caniuse](https://caniuse.com/wf-prefers-reduced-transparency)), поэтому на сайте нужен
   выключатель «Без прозрачности» и `?glass=off`. «Уменьшить движение» оставляет преломление, но
   убирает анимации стекла.
7. **Бюджет** [оценка]. На кадр прокрутки главный поток тратит ≤ 0,3 мс, видеокарта ≤ 1 мс на Mac и
   ≤ 2 мс на iPhone. Цели приёмки: Mac p95 ≤ 16,7 мс и худший кадр ≤ 25 мс; iPhone p95 ≤ 17 мс и
   худший ≤ 33 мс. Сейчас SVG в Safari даёт худший кадр 33 мс [S27].

---

## 1. Что взято из каждого проекта

| Откуда | Что берём | Почему |
|---|---|---|
| **hybrid** (основа) | слои (прозрачный host, `.lg-frost`, canvas, `.lg-rim`); кромка, блик и тень в CSS одни для всех режимов; смена режима через `opacity` canvas за 160 мс; `sync: content` / `viewport`; окклюдеры и маска покрытия (урезанные до v1); нарастание изгиба `uLens` при появлении (так у Apple, [WWDC25 219](https://developer.apple.com/videos/play/wwdc2025/219/)); IntersectionObserver снимает слушатель прокрутки; автомат режимов с гистерезисом | лучше всех закрывает раскладку сайт-пример; при поломке остаётся матовое |
| **gpu** | шейдер §4.8 (аналитический градиент SDF, а не `dFdx`; дисперсия через свой `ior` на выборку); лестница `gpu → frost → solid → off`; `failIfMajorPerformanceCaveat`; `uMix` из `getAnimations()` CSS-перехода; следующий слайд готовить в простое; постер вместо живого видео под ▶; DPR ≤ 2; регулятор от фактической частоты rAF; край текстуры (R10); полосатая линейка и `?mode/?k/?predict`; ядро пригодно для перевода на WGSL | самое чистое и простое ядро |
| **free** | режим «кольцо» (WebGL только у кромки, середина у композитора) как A/B для шапки; упреждение по EMA скорости; размытие по скорости `lod += k·|v|`; мягкий внутренний край кольца 4–6 px; `N = 1` при слабой дисперсии; тон по числам яркости из build.py с гистерезисом 0,42/0,58; учёт `visualViewport` (прыжки fixed на iOS 26, [WebKit 297779](https://bugs.webkit.org/show_bug.cgi?id=297779)) | лучший ответ на отставание середины линзы |
| **svg** | L1 на чистом CSS по умолчанию; L0 (плашка) и `forced-colors`; движок определять по признакам, а не по `@supports`; список быстрых проверок в Safari (флаг Accelerated Filter Rendering и др.); `backdrop-filter: url()` только как модуль для Chromium над DOM (v2); дешёвая промежуточная правка нынешнего сайта | надёжный нижний этаж и запасной путь |

Чего **не** берём: копию DOM под стеклом; снимок DOM в текстуру (100–500 мс, в WebKit ненадёжно,
[WebKit 180301](https://bugs.webkit.org/show_bug.cgi?id=180301)); JS-прокрутку типа Lenis (ломает
нативную прокрутку на iPhone и `sticky`); three.js (~150 КБ gzip ради одного квадрата); WebGPU в v1
(асинхронный старт, нет в Firefox на Android и Linux, выигрыша на одном квадрате нет); «жидкое в покое»
на SVG как основной режим (стекло мигает между матовым и жидким).

---

## 2. Архитектура

### 2.1 Слои одного стекла

```
host  (элемент сайта: .nav__row, .video__btn, figcaption)   position: relative; isolation: isolate;
 │                                                            фон прозрачный; box-shadow = тень
 ├─ .lg-frost   abs, inset 0, radius inherit, aria-hidden     backdrop-filter: blur() saturate() + тон
 ├─ canvas.lg-lens abs, inset −2px, aria-hidden, pointer-events: none   WebGL2: изгиб, аберрация, Френель, блик
 ├─ .lg-rim     abs, inset 0, radius inherit, aria-hidden     ::before кромка-градиент, ::after локальное затемнение / подсветка
 └─ содержимое host (текст, ссылки, иконки)                   живой DOM поверх всего
```

Правила:
- **Фон host прозрачный, матовость на дочернем слое.** Safari 26 красит свои панели по фону и
  `backdrop-filter` фиксированных элементов у края экрана
  ([1ar.io](https://1ar.io/updates/safari-26-liquid-glass-web/)). Если матовость висит на
  абсолютном дочернем слое, этого, по их данным, можно избежать [Safari ?: проверить на iPhone].
- **Матовый слой всегда лежит под canvas.** Где под стеклом есть медиа, canvas непрозрачен и закрывает
  матовое. Где медиа нет, canvas прозрачен, и видно матовое. Пустой или потерянный canvas даёт
  матовое стекло.
- **Форму рисует шейдер по SDF с альфой.** У canvas нет `overflow: hidden` и `border-radius`, поэтому
  нет и бага Firefox, где WebGL-canvas в композитном слое не обрезается скруглением
  ([Amir-Abushanab/liquid-glass-js](https://github.com/Amir-Abushanab/liquid-glass-js), `mount.ts`).
- SVG-фильтров нет, поэтому `translate3d`, `will-change` и анимация `opacity` на любых слоях разрешены.
  Правило [S27] «внутри фильтра только 2D translate» здесь не действует.
- Кромка, блик и тень лежат в CSS и одинаковы во всех режимах. Поэтому при переходе
  `liquid ↔ frost` кромка не прыгает: меняется только прозрачность canvas.

### 2.2 Модули и файлы

```
assets/lg/
  lg.css       ~2 КБ gz   слои, L0/L1 на CSS, медиазапросы доступности, печать
  lg.js        ~4 КБ gz   ядро: регистр медиа и стёкол, автомат режимов, наблюдатели, регулятор, CSS-путь
  lg-gl.js     ~5–7 КБ gz WebGL2: программа K=1/3/5, текстуры, кадр; грузится через import() только когда нужен
сайт-пример-glass.js         клей сайта (раздел 9), не часть плагина
```

Без зависимостей и без CDN, всё лежит рядом с сайтом. Формулы взяты из открытых разборов: SDF и его
градиент у [Inigo Quilez](https://iquilezles.org/articles/distgradfunctions2d) (код у автора под MIT),
профиль у [kube.io](https://kube.io/blog/liquid-glass-css-svg/), сквиркл и Шлик у
[Charles Grassi](https://charlesgrassi.dev/blog/apple-liquid-glass/), спектральная дисперсия у
[m2-md](https://github.com/m2-md/liquid-glass-refraction-shader) (MIT). Чужой код не копируем.

`lg-gl.js` не грузится, если WebGL2 недоступен, включена доступность или `?glass=frost|off`.

### 2.3 Режимы одного стекла

| Режим | Что видно | Чем считается |
|---|---|---|
| `off` | стекла нет, системные цвета | ничем (`forced-colors`, печать) |
| `solid` (L0) | плотная тонированная плашка 90–95 %, кромка, тень; при `contrast: more` рамка `currentColor` | CSS |
| `frost` (L1) | Regular по Apple: `backdrop-filter: blur(20px) saturate(1.8)` + тон + CSS-кромка и блик | композитор, GPU во всех движках [S27 для матового на сайте] |
| `liquid` | Clear по Apple: преломление у кромки, радужная кайма, Френель и блик в шейдере, CSS-кромка | WebGL2 + композитор |

У режима `liquid` есть вариант середины `core` (выбор по A/B, раздел 12):
- `core: 'lens'` (hybrid/gpu): шейдер рисует всю линзу, середина тоже из текстуры;
- `core: 'ring'` (free): шейдер рисует только кольцо кромки, середину показывает `.lg-frost` с
  лёгким Clear-размытием (2–4 px). Её ведёт композитор, и она не отстаёт от прокрутки никогда. Шейдер
  в середине отдаёт альфу 0, а у внутреннего края кольца альфа плавно спадает на 4–6 px. Геометрия —
  рамка из 4 полос (8 треугольников), поэтому середину GPU не красит вовсе.

---

## 3. API

### 3.1 Декларативно (то, что нужно сайт-пример)

```html
<link rel="stylesheet" href="/assets/lg/lg.css">
<script type="module" src="/assets/lg/lg.js"></script>

<!-- медиа, через которое стекло умеет преломлять -->
<figure class="hero__photo" data-glass-media="stack">               <!-- стопка слайдов, активный = .is-on -->
  <img class="is-on" src="…2000.webp" data-glass-src="…-768.webp"
       data-glass-tone="0.41 0.38 0.36 0.40 0.47 0.52 0.55 0.58" alt="…">
  …
</figure>
<div class="hero__panel" data-glass-occluder>…</div>                <!-- DOM поверх медиа: тут не преломлять -->

<!-- стёкла -->
<div class="nav__row" data-glass="auto" data-glass-preset="bar" data-glass-over=".hero__photo">…</div>
<div class="hero__ctl">
  <figcaption data-glass="auto" data-glass-preset="pill">…</figcaption>    <!-- over по умолчанию = ближайший data-glass-media -->
  <button class="hero__pause" data-glass="circle" data-glass-preset="dot">…</button>
</div>
<span class="video__btn" data-glass="circle" data-glass-preset="dot" data-glass-over="poster">…</span>
```

- `data-glass="auto|capsule|circle|rect"`: форма. `auto` берёт `border-radius` host.
- `data-glass-preset="bar|pill|dot"`: набор параметров. Пресет подбирается по размеру, а не по
  имени элемента (замечание L5 аудита).
- `data-glass-over`: селектор медиа, `poster` (соседний `<img>` или атрибут `poster` у `<video>`),
  `none` (только матовое). По умолчанию это ближайший предок или сосед с `data-glass-media`.
- `data-glass-*` для любого параметра из 3.3 (`data-glass-thickness="10"`).
- `data-glass-media="image|video|canvas|stack"`, `data-glass-src` (маленькая картинка для текстуры),
  `data-glass-tone` (8–10 чисел яркости по высоте кадра из build.py).
- `data-glass-occluder`: прямоугольник DOM поверх медиа (v1: до 4 на медиа, скругление берётся из
  `border-radius`).
- `data-glass-sync="content|viewport"`: обычно не нужен, `auto` решает по `position` host и предков
  (`sticky`/`fixed` → `viewport`).

`lg.js` находит элементы при загрузке, но контекст, шейдер и текстуры создаёт только при первом
пересечении с экраном (`IntersectionObserver`, `rootMargin: 200px`). Так Ash Kyd лечил вылеты Safari
([ashk.au](https://ashk.au/2024/02/07/dev-log-debugging-safari-an-ogre-with-layers/)). Атрибут
`loading` у постеров не трогаем (G8 аудита).

### 3.2 Программно

```js
import { glass } from '/assets/lg/lg.js';

glass.configure({
  quality: 'auto',          // 'auto' | 'high' | 'low' | 'css' (без WebGL)
  maxContexts: 4,
  maxDpr: 2,
  mobile: 'frost',          // до приёмки на iPhone (раздел 12): 'frost'; после — 'liquid'
  user: 'auto',             // 'auto' | 'frost' | 'off' — выбор посетителя (выключатель на сайте)
  debug: false,             // то же, что ?glass-debug=1
});

const hero = glass.media(document.querySelector('.hero__photo'), {
  kind: 'stack', active: 'img.is-on',
  fade: 'css',              // длительность и кривую кроссфейда брать из CSS-перехода img
});
hero.show(nextImg);         // слайдер сообщает о смене; Promise резолвится, когда текстура на GPU
hero.prepare(nextImg);      // заранее: decode → createImageBitmap → вторая текстура (в простое)

const bar = glass.attach(document.querySelector('.nav__row'), { preset: 'bar', over: hero });
bar.set({ thickness: 10 }); // только uniform'ы, без пересборки
bar.mode;                   // 'liquid' | 'frost' | 'solid' | 'off'
bar.on('mode', ({ mode, reason }) => {});
bar.refresh();              // пересчитать геометрию (обычно хватает ResizeObserver)
bar.destroy();              // canvas.width = 0, WEBGL_lose_context, слои убраны
```

Событие `glass:mode` на host, `detail: { mode, reason }`. Причины: `no-media`, `occluded`,
`fast-scroll`, `edge` (кромка у края фото), `no-webgl`, `context-lost`, `budget`, `mobile-default`,
`reduced-transparency`, `contrast`, `forced-colors`, `user`, `print`.

На host плагин ставит `data-glass-mode` и `data-glass-tone="light|dark"`. По ним сайт меняет цвет
текста и иконок шапки: Apple переключает мелкие элементы по фону ([apple.md](research/apple.md), §7).

Адресная строка (только для замеров и отладки, на живых страницах ничего не хранит):
`?glass=liquid|frost|solid|off`, `?glass-core=lens|ring`, `?glass-k=1|3|5`, `?glass-predict=0|1`,
`?glass-debug=1` (HUD: режим и причина, покрытие, fps, p95, худший кадр, отставание, время JS).
Настройки лаборатории в `localStorage` на сайт не подмешиваются (G14 аудита).

### 3.3 Параметры

Все длины в CSS-пикселях. Всё, кроме `over/sync/core/samples`, — uniform'ы, их можно менять хоть
каждый кадр.

| Параметр | bar / pill / dot | Смысл |
|---|---|---|
| `bevel` | 14 / 10 / 16 | ширина кромки, где поверхность изгибается; середина плоская |
| `thickness` | 12 / 8 / 14 | высота стекла в середине |
| `gap` | 8 / 4 / 6 | зазор до фона: стекло «парит» |
| `profile` | squircle / squircle / circle | `squircle` y = ⁴√(1−(1−x)⁴), `circle`, `lip` (переключатели) |
| `ior` | 1,5 | показатель преломления |
| `dispersion` | 0,04 / 0,02 / 0,02 | разброс n между красным и синим; при < 0,03 автоматически `samples = 1` |
| `samples` | auto (5 Mac, 3 телефон) | спектральные выборки, программа компилируется под K = 1/3/5 |
| `maxShift` | = bevel | предел сдвига у самого края |
| `frost` | 0,6 | матовость сквозь линзу, мип-уровни сверх «родного» |
| `saturate` | 1,5 | насыщение (у Apple цвет сочнее) |
| `tint`, `tintColor` | 0,26, белый | тон («тон 26 %» владелец сайтаа); общий для шейдера и `.lg-frost` |
| `lightAngle` | −60° | откуда свет, uniform и CSS `--lg-light` (`@property <angle>`) |
| `specular` | 0,5 | направленный блик в шейдере |
| `rim` | 0,4 | Френелевская кромка в шейдере и сила CSS-кромки («кромка 40 %») |
| `topLight` | 0,07 | свет сверху в CSS («свет сверху 7 %») |
| `shadow` | 0,7 | CSS-тень («тень 70 %»); над медиа ×1, над белым ×0,5 |
| `frostBlur` | 20 | размытие матового режима, px |
| `clearBlur` | 3 | размытие середины в `core: 'ring'`, px (подбирается под `frost` шейдера) |
| `core` | lens (bar: по A/B) | `lens` или `ring` (2.3) |
| `predict` | true для viewport | упреждение прокрутки (6.2) |
| `fastScroll` | 1500 px/с (`lens`), выкл. (`ring`) | выше скорости шапка уходит в матовое (6.3) |
| `motionBlur` | 0,002 | `lod += motionBlur·|v|`, выкл. при «Уменьшить движение» |

Старые числа из лаборатории (rim 4.5, bend −140, spread .12, soft 1.3) задавали σ размытия маски и
масштаб feDisplacementMap. Однозначно в новые они не переводятся. Подбирать заново **по решётке**:
старое SVG-стекло и шейдерное рядом в Chrome на одной клетчатой подложке. Ориентир: `bevel ≈ 3·rim`,
знак `bend < 0` (край тянет картинку внутрь) соответствует выпуклому профилю [оценка].

---

## 4. Картинка за стеклом

### 4.1 Источники

| Источник | Как попадает в текстуру | Когда обновляется |
|---|---|---|
| `<img>` | `await img.decode()` → `createImageBitmap()` → `texImage2D` → `generateMipmap`. Берём `data-glass-src` (768 px), иначе `currentSrc`, ограниченный `maxTexture: 1280` через `createImageBitmap(img, {resizeWidth})` [Safari ?: опции resize] | один раз на картинку |
| стопка слайдов | две текстуры A и B, `mix(A, B, uMix)` в шейдере | `hero.show()` или смена `.is-on` (MutationObserver на `class` как запасной путь) |
| постер под ▶ | как `<img>` | один раз |
| `<video>` (v2, по замеру) | `texImage2D(video)` по `requestVideoFrameCallback`, не чаще 30 Гц, только при воспроизведении и пока кнопка видна; на паузе ни разу | на новом кадре видео |
| `<canvas>` | `texImage2D(canvas)` по `media.invalidate()` | по событию автора |
| живой DOM | нет текстуры: стекло матовое (Regular по Apple) | — |

Почему под ▶ постер, а не живое видео. У `texImage2D(video)` в WebKit долгая история медленной
работы и регрессий ([WebKit 236699](https://bugs.webkit.org/show_bug.cgi?id=236699),
[WebKit 231031](https://bugs.webkit.org/show_bug.cgi?id=231031)). Свежий отчёт: iPhone 12 в цикле
rVFC + `texImage2D` держит около 12 кадров в секунду
([media-mock#81](https://github.com/eatsjobs/media-mock/issues/81)) [ист., версия iOS не указана].
Есть и сообщение, что rVFC на играющем видео в WebKit роняет WebGL-контексты
([orktes/jsui#74](https://github.com/orktes/jsui/pull/74), по Playwright-WebKit, то есть не
доказательство). У сайт-пример видео открывается в плеере Rutube, а кнопка ▶ лежит на постере, так что
живое видео под стеклом сейчас не нужно.

Свой домен, поэтому CORS не нужен. Для чужих картинок нужен `crossorigin`, иначе стекло уходит в
`frost` с причиной `no-media`.

### 4.2 Геометрия без чтения раскладки в кадре

- Один раз и затем по `ResizeObserver` (на медиа, host и окклюдеры), по `load` шрифтов и по
  `scrollend` (на случай дрейфа адресной строки iOS) кэшируем прямоугольники в координатах документа
  (`rect + scrollX/Y`). Для `sync: viewport` прямоугольник host берём во вьюпорте, с поправкой на
  `visualViewport`.
- `object-fit: cover|contain` и `object-position` переводим в обрезку UV: для cover
  `s = max(W/iw, H/ih)`. Получается одна матрица 3×3 `uToUV` (px стекла → UV).
- В кадре JS пишет один uniform `uScroll` (для `viewport`) и вызывает один draw. Ни одного
  `getBoundingClientRect` при прокрутке (G6 аудита).
- Анимированное медиа (Ken Burns, параллакс) текстура не повторяет. Такое медиа помечается
  `data-glass-media-animated`, и стекло над ним матовое. У сайт-пример фото статичное.

### 4.3 Маска покрытия и окклюдеры (v1 урезанный)

У сайт-пример `.hero__panel` налезает на фото на 152 px (`margin-top: -152px`, `page.css` строка 75) и
занимает 9 из 12 колонок. Плашки в текстуре нет. Без маски шапка над стыком показывала бы фото
сквозь текст. Поэтому в v1:

```
cover = inside(pPage, mediaRect)                                  // smoothstep по 1 px
      · Π_i (1 − insideRound(pPage, occ_i, occR_i))               // i < uOccN ≤ 4
alpha = shape · cover
```

- окклюдеры только явные (`data-glass-occluder`), до 4 штук, `vec4 uOcc[4]` + `float uOccR[4]`;
- в debug-HUD окклюдеры подсвечиваются, чтобы забытый был виден сразу;
- **автопоиска нет** (он остаётся на v2): так проще, а забытый окклюдер ловится HUD;
- долю покрытия (0…1) JS считает по тем же прямоугольникам, без пикселей. При покрытии < 0,02
  стекло уходит в `frost`, а при > 0,05 возвращается (гистерезис). Частичное покрытие —
  не повод переключаться: граница плавная по маске;
- **край медиа**: UV зажимаем в обрезку, а сила изгиба гаснет на ширине `bevel` у края фото. Шапка у
  верха фото дотягивает картинку отражением (`MIRRORED_REPEAT`) на 4 % (из free), чтобы у верхней
  кромки не было полосы одного цвета. На выходе из героя стекло уходит в `frost` чуть раньше, чем
  кромка дойдёт до края фото (R10 из gpu: `IntersectionObserver` с запасом `maxShift`).

### 4.4 Кроссфейд слайдов

На сайте слайды меняются CSS-переходом `opacity 900ms var(--ease-in-out)` (`page.css` строка 422).
В шейдере `mix(A, B, uMix)`, а `uMix` в каждом кадре перехода берётся из **той же** анимации:
`img.getAnimations()[0]?.effect.getComputedTiming().progress` с той же кривой, иначе
`getComputedStyle(img).opacity`. Так линза и фото вокруг меняются синхронно. rAF крутится только
900 мс перехода. При «Уменьшить движение» CSS уже ставит `transition: none`, и `uMix` прыгает сам.

Следующий слайд готовится сразу после предыдущей смены, в `requestIdleCallback` (где его нет —
`setTimeout`): `decode()` → `createImageBitmap` → текстура B. К моменту смены текстура уже на GPU.
Это заодно лечит рывок S1 из аудита (первый кадр нового фото 69–169 мс [Chrome]), если сайт тоже ждёт
`decode()` (раздел 9.3).

### 4.5 Цвет

Canvas и `<img>` по умолчанию оба sRGB, и браузер приводит оба к цвету дисплея. `unpackColorSpace` и
`drawingBufferColorSpace` оставляем `srgb` (по умолчанию). Ставить `display-p3` опасно: в WebView2
картинку переводило в P3 второй раз ([Genzo#24](https://github.com/GabrielBG0/Genzo/pull/24)) [ист.,
не Safari]. Поддержка этих свойств в Safari по источникам не ясна
([MDN unpackColorSpace](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/unpackColorSpace),
[web-features](https://web-platform-dx.github.io/web-features-explorer/features/webgl-color-management/))
[Safari ?]. Проверка: центр линзы против фото рядом на решётке и на P3-картинке. Расхождение видно
сразу как «наклейка».

---

## 5. Шейдер

### 5.1 Кадр

```
p (CSS px от центра стекла)
 └ sdgRoundBox(p) → d (до края), ĝ (наружу), аналитически (Quilez); для малых радиусов норма L4 (сквиркл)
 └ x = clamp(−d/bevel, .002, 1);  h = (1−(1−x)⁴)^¼;  h' = (1−x)³·(1−(1−x)⁴)^(−¾)
 └ N = normalize(ĝ · thickness·h'/bevel · uLens, 1)        uLens 0→1: нарастание изгиба при появлении
 └ для i < K:  n_i = ior + dispersion·(i/(K−1) − ½)
               R = refract((0,0,−1), N, 1/n_i);  off = R.xy·(thickness·h + gap)/−R.z, |off| ≤ maxShift
               col += W_i · tex(p + off + predictOff, lod)     W_i нормированы: Σ по каналу = 1, белое остаётся белым
 └ lod = lodBase + frost + motionBlur·|v|
 └ насыщение mix(luma, col, sat), тон mix(col, tint, a)
 └ Френель (Шлик) F = .04 + .96·(1 − N.z)⁵ → mix(col, white, F·rim)
 └ блик spec·pow(max(N·H,0),40) сверху-слева + ½ того же снизу-справа
 └ alpha = clamp(.5 − d·dpr, 0, 1) · cover · ringFade        премультипликация
       ringFade = 1 для core:lens;  для core:ring = 1 − smoothstep(.85, 1, x) (мягкий внутренний край 4–6 px)
```

В плоской середине N = (0,0,1), поэтому сдвиг ровно 0 и аберрация пропадает сама. Это Pixel Normal
Offset из Unreal ([Epic](https://dev.epicgames.com/documentation/unreal-engine/refraction-using-pixel-normal-offset-in-unreal-engine)):
середина чистая, гнётся только кромка, как у Apple ([apple.md](research/apple.md), §1).
Опция `exitRefraction` (второе преломление через плоское дно) стоит ещё один `refract` на выборку.
Её сравнить в лаборатории.

### 5.2 Набросок (GLSL ES 3.0, основа — gpu.md §4.8)

```glsl
#version 300 es
precision highp float;
uniform sampler2D uA, uB;  uniform float uMix;
uniform vec2  uHalf;  uniform float uR, uDpr;
uniform mat3  uToUV;                         // px стекла → UV картинки, прокрутка и упреждение внутри
uniform float uBevel, uThick, uGap, uIor, uDisp, uMaxShift, uLod, uSat, uTint, uRim, uSpec, uLens, uRing;
uniform vec3  uTintColor, uL;
uniform vec4  uMediaPx;                      // прямоугольник медиа в px стекла
uniform vec4  uOcc[4]; uniform float uOccR[4]; uniform int uOccN;
in vec2 vP; out vec4 o;

vec3 sdgRoundBox(vec2 p, vec2 b, float r) {  // I. Quilez: x = расстояние, yz = градиент
  vec2 w = abs(p) - (b - r);
  vec2 s = vec2(p.x < 0. ? -1. : 1., p.y < 0. ? -1. : 1.);
  float g = max(w.x, w.y); vec2 q = max(w, 0.); float l = length(q);
  vec2 n = s * (g > 0. ? q / l : (w.x > w.y ? vec2(1, 0) : vec2(0, 1)));
  return vec3((g > 0. ? l : g) - r, n);
}
float inBox(vec2 p, vec4 r, float rr) { vec2 c = r.xy + r.zw * .5;
  return clamp(.5 - sdgRoundBox(p - c, r.zw * .5, rr).x, 0., 1.); }
vec3 tap(vec2 p) { vec2 uv = (uToUV * vec3(p + uHalf, 1.)).xy;
  return mix(textureLod(uA, uv, uLod).rgb, textureLod(uB, uv, uLod).rgb, uMix); }

const int K = SAMPLES;                       // 1, 3 или 5: подставляется при компиляции
void main() {
  vec3 sg = sdgRoundBox(vP, uHalf, uR);
  float d = sg.x;  float a = clamp(.5 - d * uDpr, 0., 1.);  if (a <= 0.) discard;
  float x = clamp(-d / uBevel, .002, 1.), u = 1. - x, u4 = u*u*u*u;
  float h = pow(1. - u4, .25), dh = u*u*u * pow(1. - u4, -.75);
  vec3 N = normalize(vec3(sg.yz * uThick * dh / uBevel * uLens, 1.));
  vec3 col = vec3(0), wsum = vec3(0);
  for (int i = 0; i < K; i++) {
    float t = K == 1 ? 0. : float(i) / float(K - 1) - .5;
    vec3 R = refract(vec3(0, 0, -1), N, 1. / (uIor + uDisp * t));
    vec2 off = R.xy * (uThick * h + uGap) / -R.z;
    off *= min(1., uMaxShift / max(length(off), 1e-4));
    vec3 w = K == 1 ? vec3(1) : clamp(vec3(-2.*t, 1. - abs(2.*t), 2.*t) + .35, 0., 1.);
    col += w * tap(vP + off);  wsum += w;
  }
  col /= wsum;
  float lum = dot(col, vec3(.2126, .7152, .0722));
  col = mix(vec3(lum), col, uSat);  col = mix(col, uTintColor, uTint);
  col = mix(col, vec3(1), (.04 + .96 * pow(1. - N.z, 5.)) * uRim);
  vec3 H = normalize(uL + vec3(0, 0, 1));
  col += uSpec * (pow(max(dot(N, H), 0.), 40.) + .5 * pow(max(dot(N, H * vec3(-1, -1, 1)), 0.), 40.));
  vec2 pp = vP + uHalf;
  float cover = inBox(pp, uMediaPx, 0.);
  for (int i = 0; i < 4; i++) if (i < uOccN) cover *= 1. - inBox(pp, uOcc[i], uOccR[i]);
  float ring = mix(1., 1. - smoothstep(.85, 1., x), uRing);
  a *= cover * ring;
  o = vec4(col * a, a);
}
```

Это набросок для оценки объёма (около 70 строк). Знак нормали и `thickness` вместе задают, тянется
ли картинка к центру или наружу, подбирается по решётке. Проверяется в лаборатории, а не по тексту.

Ядро (SDF, профиль, выборка) пишется чистыми функциями, чтобы его можно было перевести на WGSL, если
когда-нибудь понадобится WebGPU-бэкенд (живое видео через `importExternalTexture`).

### 5.3 Контекст и жизненный цикл

- `getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false,
  stencil: false, preserveDrawingBuffer: false, powerPreference: 'low-power',
  failIfMajorPerformanceCaveat: true })`. Последний флаг отсекает программный WebGL: там стекло
  дороже SVG, и мы уходим в `frost`.
- v1: по контексту на **видимое** жидкое стекло, не больше 4. Создаётся при входе в зону видимости,
  при выходе освобождается (`WEBGL_lose_context` + `canvas.width = 0`): на iOS память холстов
  ограничена ~224–384 МБ, а освобождается не сразу
  ([pqina](https://pqina.nl/blog/total-canvas-memory-use-exceeds-the-maximum-limit/)). Браузеры держат
  около 16 контекстов на страницу.
- v2, если стёкол станет больше 4: один `OffscreenCanvas` с WebGL2 на главном потоке, каждое стекло
  рисуется в него по очереди и отдаётся через `transferToImageBitmap()` в `bitmaprenderer`-canvas
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas/transferToImageBitmap)).
  У WebKit есть расхождения по размерам такого canvas
  ([whatwg/html#7833](https://github.com/whatwg/html/issues/7833)) [Safari ?].
- Вечного rAF нет. `invalidate()` ставит один rAF. Поводы для кадра: прокрутка (только `viewport` и
  только пока медиа под стеклом), кроссфейд, `uLens`, ресайз, `set()`.
- `webglcontextlost` → `preventDefault()`, режим `frost`; `webglcontextrestored` → заново программа и
  текстуры. `document.hidden` → всё стоит.
- Программы K = 1/3/5 компилируются заранее, в простое после первого кадра, а не в кадре
  переключения качества. Компиляция стоит 5–50 мс [оценка], поэтому первый кадр стекла рисуется
  через `frost → liquid` с `uLens`, и задержка не видна.
- `@media print`: canvas `display: none`, режим `solid`.

---

## 6. Прокрутка: отставание и режимы

### 6.1 Почему отстаёт

Шапка липкая, её держит композитор, фото под ней едет тоже на композиторе. Canvas с линзой
перерисовывает JS по `scrollY`, а JS узнаёт положение прокрутки на кадр позже
([Mozilla: scroll-linked effects](https://firefox-source-docs.mozilla.org/performance/scroll-linked_effects.html),
[joyco](https://hub.joyco.studio/logs/08-webgl-scroll-sync),
[w3c/svgwg#1142](https://github.com/w3c/svgwg/issues/1142)). Отставание ≈ скорость × 16,7 мс:
300 px/с дают 5 px, 1500 px/с дают 25 px [оценка]. Сильнее всего это видно в чистой середине линзы,
где глаз сравнивает её с фото рядом. У кромки, где картинка и так изогнута, почти не видно.

Для `sync: content` (кнопки, подписи, пауза) этой проблемы нет совсем: взаимное положение стекла и
картинки постоянно, кадр рисуется один раз, canvas едет с композитором.

### 6.2 Что делает шапка (`sync: viewport`)

1. `scroll` (passive) только ставит rAF. В rAF читается только `scrollY`.
2. **Упреждение** (`predict`, из free и gpu): скорость сглаживаем EMA по 3–4 последним событиям и
   рисуем по `scrollY + v·τ`, где τ ≈ 1 период кадра. Ограничено краями страницы, при смене знака
   скорости сбрасывается, на `scrollend` рисуем точное положение. τ подбирается по записи 240 fps.
   Помогает ли это в Safari, неизвестно [Safari ?].
3. **Размытие по скорости**: `lod += motionBlur·|v|`. Остаток рассинхрона уходит в смаз, похожий на
   естественный. При «Уменьшить движение» выключено.
4. **Режим середины** `core` выбирается по A/B (раздел 12):
   - `lens`: при скорости > `fastScroll` (1500 px/с) шапка уходит в `frost` (canvas `opacity → 0`,
     160 мс), возврат по `scrollend` ([Safari 26.2+](https://www.infoq.com/news/2026/04/safari-scrollend-support))
     или когда скорость < 400 px/с держится 120 мс. Порог 600 px/с из hybrid судьи сочли слишком
     низким: это обычная прокрутка, и Apple изгиб на ней держит;
   - `ring`: середина у композитора, уход в матовое не нужен (`fastScroll` выключен), отставание
     остаётся только в кольце и маскируется размытием по скорости.
5. `IntersectionObserver` на медиа с `rootMargin: -<высота шапки>px` снимает слушатель `scroll`, как
   только фото ушло из-под шапки. Дальше шапка просто матовая и ничего не считает (audit G6,
   performance §5.5).
6. Вариант на будущее (hybrid §5.3 п. 3): canvas кладётся внутрь медиа и едет с композитором. Тогда
   картинка в линзе всегда совпадает с фото, а на кадр отстаёт уже форма стекла относительно текста
   шапки. В v1 не входит, только эксперимент в прототипе, если и `lens`, и `ring` провалятся.

JS-прокрутку (Lenis и т. п.) не берём: она ломает нативную прокрутку на iPhone и `sticky`
([Lenis blog](https://www.edoardolunardi.dev/blog/building-smooth-scroll-in-2025-with-lenis)).

### 6.3 Автомат режимов

| Условие (сверху вниз, первое сработавшее) | Режим |
|---|---|
| `forced-colors: active`, печать | `off` |
| `prefers-contrast: more`, `prefers-reduced-transparency: reduce`, `user: 'off'`, `?glass=solid`, нет `backdrop-filter` | `solid` |
| `user: 'frost'`, `?glass=frost`, нет WebGL2 или он программный, контекст потерян, регулятор исчерпан, `mobile: 'frost'` на телефоне | `frost` |
| покрытие медиа < 0,02 (вход) / > 0,05 (выход); стекло у края фото (R10); медиа анимировано | `frost` |
| `viewport`, `core: lens`, скорость > `fastScroll` | `frost` до `scrollend` |
| стекло вне экрана, вкладка скрыта | ничего не рисуем |
| иначе | `liquid` |

Переходы:
- `liquid → frost`: canvas `opacity 1 → 0` за 160 мс (композитор). CSS-кромка и блик остаются.
- `frost → liquid`: canvas `opacity 0 → 1` за 160 мс и одновременно `uLens 0 → 1` за 250 мс.
  Картинка сначала ровная, потом «натекает» изгиб у кромки, как Apple показывает появление стекла.
- Тень `--lg-sh` меняется `transition` вместе с режимом (над медиа ×1, над белым ×0,5).
- При «Уменьшить движение» все переходы мгновенные, `uLens` сразу 1.

### 6.4 Регулятор качества

- Ступени: `K5·dpr2 → K3·dpr2 → K1·dpr1.5 → frost`. На старте Mac и десктоп берут K5, телефон K3
  (или `frost` до приёмки, `mobile: 'frost'`).
- Зонд в режиме `liquid` считает интервалы rAF и время своего JS в кадре. **Период берём из медианы
  интервалов**, а не 16,7 мс: в режиме энергосбережения iOS rAF может идти на 30 Гц, а Safari по
  умолчанию держит около 60 Гц даже на ProMotion
  ([MacRumors](https://www.macrumors.com/how-to/enable-smoother-120hz-browsing-in-safari/)) [Safari ?].
- Если 2 секунды подряд p95 > 1,25 × период или есть кадр > 50 мс, спускаемся на ступень. Наверх в
  пределах сессии не поднимаемся (иначе качели). Решение кладём в `sessionStorage` в `try/catch`;
  без него просто стартуем со ступени по умолчанию.
- GPU-таймеров в Safari нет, `navigator.deviceMemory` тоже, поэтому меряем только интервалы [ист.].

---

## 7. Уровни деградации по браузерам

Ожидание по проекту. **Ни одна строка ещё не проверена прототипом.** Всё про Safari и iOS — [Safari ?].

| Браузер / настройка | Шапка над фото героя | Подпись и пауза на фото, кнопки ▶ | Шапка ниже, над текстом | Основание |
|---|---|---|---|---|
| Safari 26–27, Mac (Apple Silicon) | `liquid`, K5, `core` по A/B; на очень быстрой прокрутке `frost` (если `lens`) | `liquid`, рисуется один раз | `frost` | WebGL2 и `backdrop-filter` есть [ист.]; матовое [S27] |
| Safari 15–25, Mac (Intel тоже) | `liquid`, регулятор может снизить K | `liquid` | `frost` | WebGL2 с Safari 15 [ист.] |
| Safari iOS / iPadOS 15–27 и **все браузеры на iPhone** (это WebKit) | до приёмки — `frost`; после — `liquid` K3, DPR ≤ 2 | то же; под ▶ постер | `frost` | [browsers.md](research/browsers.md) п. 6 |
| iPhone в режиме «Блокировка» (Lockdown) | вероятно `frost` (WebGL может быть выключен) | `frost` | `frost` | [Safari ?] |
| Встроенные браузеры iOS (Telegram, VK, Яндекс) | как Safari iOS; без WebGL2 — `frost` | то же | `frost` | [Safari ?] |
| Chrome / Edge, Mac и Windows | `liquid` K5, тот же вид, что в Safari | `liquid` | `frost` | WebGL2 [ист.] |
| Chrome с заблокированной видеокартой | `frost` (`failIfMajorPerformanceCaveat`) | `frost` | `frost` | — |
| Chrome Android, Samsung Internet | `liquid` K3 по регулятору; слабые — `frost` | то же | `frost` | [ист.], не мерили |
| Firefox десктоп | `liquid` K3–5 | `liquid` | `frost` | WebGL2 [ист.] |
| Firefox Android | `liquid` K1, если тянет; иначе `solid` (`backdrop-filter` там тормозит, [bug 1732817](https://bugzilla.mozilla.org/show_bug.cgi?id=1732817)) | то же | `frost` с blur 8 px или `solid` | [ист.] |
| Нет WebGL2 / контекст потерян | `frost` | `frost` | `frost` | — |
| Без JS или JS упал | `frost` из CSS (L1) | `frost` | `frost` | плагин только повышает уровень |
| Нет `backdrop-filter` (очень старые) | `solid`, заливка 85–90 % | `solid` | `solid` | — |
| «Увеличить контраст» (`prefers-contrast: more`) | `solid` с рамкой `currentColor`, текст чёрный или белый | `solid` | `solid` | есть в Safari, Chrome, Firefox [Safari ?] |
| «Уменьшить прозрачность» в Chromium | `solid` | `solid` | `solid` | Chromium 118+ ([Chrome](https://developer.chrome.com/blog/css-prefers-reduced-transparency)) |
| «Уменьшить прозрачность» в Safari и Firefox | **сайт не узнаёт**: стекло остаётся, лечим выключателем «Без прозрачности» | — | — | [WebKit 175497](https://bugs.webkit.org/show_bug.cgi?id=175497) |
| «Уменьшить движение» | `liquid`, но без анимаций стекла (8.2) | то же | `frost` | — |
| Windows «Контрастные темы» (`forced-colors`) | `off`, системные цвета | `off` | `off` | — |
| Печать | `off` | `off` | `off` | — |

Распознавание движка — **по признакам, не по `@supports`**. Firefox и Safari на
`backdrop-filter: url()` отвечают «да» и ничего не рисуют ([browsers.md](research/browsers.md), §2;
[dev.to](https://dev.to/devyatov/liquid-glass-on-the-web-6-ways-to-build-it-with-css-and-svg-3m07)).
WebKit: `'webkitConvertPointFromNodeToPage' in window` (приём Amir-Abushanab) или `'GestureEvent' in window`.
Сигналов берём несколько: Safari 27 убрал часть старых интерфейсов, живы ли эти, надо проверить
[Safari ?]. Телефон: `pointer: coarse` **или** WebKit + `navigator.maxTouchPoints > 1` (iPad с
трекпадом отдаёт `pointer: fine`, аудит). Для основного пути движок почти не нужен: WebGL2-шейдер один
на всех. Он нужен для поправок (Firefox Android) и для модуля `domRefraction` в v2.

Все медиазапросы слушаются через `matchMedia(...).addEventListener('change')` (G10 аудита).

---

## 8. Доступность: «Уменьшить прозрачность» и «Уменьшить движение»

### 8.1 Прозрачность и контраст

- `@media (prefers-reduced-transparency: reduce)` → `solid`. Работает только в Chromium.
- **Safari и Firefox этот запрос не отдают** (caniuse на 30.10.2026, в том числе Safari 27 и iOS 27.2
  [ист.]). WebKit держит баг 175497 открытым с 2017 года из-за приватности. Поэтому:
  1. на сайте выключатель «Без прозрачности» в подвале (кнопка `aria-pressed`). Он ставит
     `glass.configure({ user: 'off' })`, сохраняется в `localStorage` в `try/catch`. Это выбор самого
     посетителя, а не настройка лаборатории, поэтому G14 его не касается;
  2. `?glass=off` для ссылок и поддержки;
  3. **текст на стекле должен читаться и без стекла.** Над фото (Clear по Apple) — локальное
     затемнение около 35 % только под надписями (`radial-gradient` на `.lg-rim::after`, HIG
     [Materials](https://developer.apple.com/design/human-interface-guidelines/materials)), а не
     заливка всей капсулы. Контраст 4,5 : 1 проверять на самом светлом и самом пёстром слайде.
- `@media (prefers-contrast: more)` → `solid` с рамкой 1,5 px `currentColor`, текст и иконки чёрные
  или белые. Так делает Apple при Increase Contrast.
- `@media (forced-colors: active)` → `off`: никаких своих цветов, системные.
- Фокус и клавиатура не меняются: стекло — это только `aria-hidden` слои внутри элемента сайта.

### 8.2 Движение

`prefers-reduced-motion: reduce` (работает везде):
- нет нарастания `uLens` при появлении, нет перехода `opacity` canvas: всё мгновенно;
- блик не следует за курсором, угол постоянный;
- нет размытия по скорости;
- слайды без кроссфейда (CSS сайта уже ставит `transition: none`, `uMix` прыгает сам);
- автосмену слайдов `site.js` уже останавливает (аудит: «хорошо сделано»).

Само преломление при прокрутке — не анимация, а следствие прокрутки, его оставляем. Упреждение
тоже: оно уменьшает рассинхрон, а не добавляет движение.

---

## 9. Встраивание в сайт-пример

Всё делается копией в `glass-rnd/site-next/` (как в `CONTEXT.md`), с отчётом «было/стало». Живой
сайт не трогаем. Логика, завязанная на сайт, живёт в `сайт-пример-glass.js`, а не в плагине (G16 аудита).

### 9.1 Шапка-капсула над слайдами

Сейчас: `.nav` липкая (`position: sticky; top: 0`, `margin-bottom: -var(--nav-h)`), капсула
`.nav__row` с матовым `backdrop-filter` (`page.css` строки 45–49). Жидкое стекло — только по
`?glass=liquid`.

Станет:
- `.nav__row` — host: `data-glass="auto" data-glass-preset="bar" data-glass-over=".hero__photo"`.
  Фон и `backdrop-filter` с самой `.nav__row` переезжают в `.lg-frost` (1ar.io). Без JS CSS плагина
  держит матовое на `.lg-frost`, а если JS не запустился вовсе, остаётся нынешнее правило сайта
  (оно же L1);
- `sync` выходит `viewport` автоматически (предок `sticky`);
- `.hero__panel` получает `data-glass-occluder`: она налезает на фото на 152 px и занимает 9 колонок;
- тон текста шапки (`is-dark`): по `data-glass-tone` слайда из build.py и положению шапки, с
  гистерезисом 0,42/0,58 (как в нынешнем `glass.js`). Плагин ставит `data-glass-tone` на host, CSS
  сайта меняет цвета (переход 1,2 с у ссылок уже есть, строка 440). `brightness()` с `drawImage` из
  прокрутки уходит (G7, S3);
- ниже фото шапка матовая (Regular по Apple), слушатель прокрутки снят;
- на телефоне до приёмки (раздел 12) `mobile: 'frost'`; после — одна строка в `сайт-пример-glass.js`.

### 9.2 Подпись и пауза на фото (`.hero__ctl`)

- `figcaption` → `data-glass="auto" data-glass-preset="pill"`; `.hero__pause` →
  `data-glass="circle" data-glass-preset="dot"`. Медиа — та же стопка `.hero__photo`.
- `sync: content`: кадр рисуется один раз и на каждой смене слайда (кроссфейд 900 мс в шейдере).
  При прокрутке — ноль работы.
- `.hero__pause:hover { transform: scale(1.06) }` (C4 аудита) больше не дорогой: фильтра нет, canvas
  просто масштабируется композитором.
- Два стекла рядом — это «стекло рядом со стеклом», а не «стекло на стекле», HIG это допускает.

### 9.3 Слайды первого экрана (`site.js`, `build.py`)

- `site.js` `show()`: `await img.decode()` перед `classList.add('is-on')` (S1). Сразу после смены —
  `hero.prepare(следующий)`. Вместо события `slide` (или вместе с ним) — `hero.show(img)`.
  Запасной путь плагина — MutationObserver на `class`, поэтому сайт работает и без правки.
- Слайды кроме первого держат URL в `data-src`/`data-srcset` и получают их за один слайд до показа
  (S2): сейчас все 6 (≈ 580 КБ) грузятся сразу.
- `build.py` добавляет:
  - `<имя>-768.webp` для текстуры стекла → `data-glass-src` (память GPU ~1,5 МБ вместо ~15 МБ у
    2000 px, [performance.md](research/performance.md) §5.1);
  - `data-glass-tone="…"`: 8–10 чисел средней яркости полос по высоте кадра (с учётом `object-fit:
    cover` при типичных соотношениях сторон экрана);
  - `data-top` для `topColor()` (S3).
- `?glass=liquid` из нынешнего кода убирается, вместо него `?glass=...` плагина.

### 9.4 Кнопки ▶ на видео

- `.video__btn` (60×60, сейчас жёлтый круг, `page.css` строка 151) → `data-glass="circle"
  data-glass-preset="dot" data-glass-over="poster"`. Источник — соседний `<img>` постера внутри
  `.video__play` (`video-company.webp`, `video-m5.webp`, 640×360).
- `sync: content`, рисуется один раз. Видео открывается в плеере Rutube, живого `<video>` под стеклом
  нет, поэтому rVFC в v1 не нужен.
- Контекст создаётся при первом пересечении; `loading="lazy"` у постера плагин не трогает (G8). Пока
  постер не загружен, кнопка матовая.
- Иконка в стекле — жёлтая (`--brand-yellow`) с лёгкой тенью, как сейчас в `.has-glass .video__btn
  svg` (строка 400). Её контраст проверить на светлом постере.
- Лимит: на главной 1 шапка + 2 стекла `.hero__ctl` + 1 кнопка ▶ = 4 контекста, но одновременно
  видны обычно 3. Остальные страницы (`projects`, `company`) — шапка и 1–2 кнопки.

### 9.5 Что убрать из нынешнего кода

`glass.js` (SVG-генератор остаётся только в лаборатории для сравнения), `.glass-lens/.glass-clip/
.glass-copy/.glass-layer`, `.glass-page { will-change }` (C1, мёртвый код), фиксированные id
`glass-bar/glass-dot`, `localStorage('dioGlass')` на живых страницах, условие «на телефонах стекло
выключено» (`max-width: 60rem`, `pointer: coarse`): его заменяет `mobile` в настройках плагина.

### 9.6 Промежуточная правка нынешнего сайта (по желанию, до плагина)

Если плагин задержится, нынешний SVG в Safari можно удешевить (идеи из svg и аудита, все
[Safari ?]): область фильтра под кромку (`pad = 3·rim + 2` px вместо `-0.2/1.4` и `-0.5/2`, −44 %
пикселей), один проход смещения вместо трёх, `feBlend screen` или `feComposite lighter` вместо
`arithmetic`, `await img.decode()` перед сменой слайда, IntersectionObserver вместо `update()` на
каждой прокрутке. По оценке это в 3–4 раза меньше работы на кадр, но процессор и отставание
остаются. Каждую правку проверить A/B в настоящем Safari: новый приём может молча рисовать пусто [S27].

---

## 10. Бюджет скорости

### 10.1 Цели приёмки (из [performance.md](research/performance.md) §6.5)

| | Mac (Safari 27, Chrome) | iPhone (Safari) |
|---|---|---|
| Интервал кадра при прокрутке | p95 ≤ 16,7 мс, худший ≤ 25 мс, 0 кадров > 50 мс | p95 ≤ 17 мс при 60 Гц, худший ≤ 33 мс |
| Смена слайда | ни одного кадра > 33 мс | то же |
| Отставание линзы шапки | p95 ≤ 1 кадра на медленной прокрутке; на записи 240 fps не видно глазом | то же |
| Память | — | WebContent не растёт от прогона к прогону, без вылетов вкладки |
| Нагрев | — | минута прокрутки не греет заметно сильнее, чем матовое |

Не проходит вариант на платформе — там ставим `frost`. Это и есть аккуратная деградация.

### 10.2 Бюджет плагина на кадр [оценка]

| Статья | Mac (капсула ~1100×60, DPR 2) | iPhone (~361×56, DPR 3 → 2) |
|---|---|---|
| Пикселей шапки | 0,26 Мп (`ring`: ~0,1 Мп) | 0,08 Мп (`ring`: ~0,04 Мп) |
| GPU на кадр | 0,1–0,3 мс; потолок 1 мс | 0,2–0,8 мс; потолок 2 мс |
| Главный поток на кадр прокрутки | 0,05–0,1 мс (uniform'ы + 1 draw); потолок 0,3 мс | 0,1–0,3 мс; потолок 0,5 мс |
| Чтений раскладки в кадре | 0 | 0 |
| Стёкла `sync: content` при прокрутке | 0 | 0 |
| Смена слайда | заливка 768 px + мипы 1–3 мс, в простое заранее; переход — uniform | 2–5 мс в простое |
| Компиляция программ | 5–30 мс один раз, в простое | 10–50 мс один раз |
| Память GPU | 2 текстуры × ~2 МБ + canvas ~0,5 МБ × 2–3 буфера на стекло | то же, canvas ~0,3 МБ |
| Вес | JS ≤ 12 КБ gz всего (ядро ~4 + GL ~5–7), CSS ~2 КБ | то же |

Опора: m2-md, WebGL2-стекло 960×540 на M2 Pro: 1/3/8 выборок = 0,131/0,164/0,217 мс GPU (Chrome)
[ист.]. Пикселей у нашей шапки вдвое меньше. GPU iPhone слабее M2 Pro в 3–6 раз, но пикселей в 6 раз
меньше [оценка].

Для сравнения: сейчас SVG в Safari ≈ 17 программных проходов по 0,56–0,83 Мп на каждом кадре
прокрутки, худший кадр 33 мс [S27]; Chrome — жидкое 18 мс против 10 мс у матового [Chrome]. Если
оценки подтвердятся, шейдер займёт меньше 5 % бюджета кадра, и прокрутка с жидким стеклом не будет
отличаться от прокрутки с матовым. Тогда остаётся только вопрос отставания (раздел 6).

### 10.3 Как мерить

Зонд `?glass-debug=1` (на основе [performance.md](research/performance.md) §6.2): интервалы rAF
(p50/p95/p99, худший, пропущенные, > 50 мс), время JS плагина в кадре, отставание
`|scrollY − scrollY, по которому нарисован кадр|`. В Safari вместе с ним Web Inspector → Timelines →
Rendering Frames и Memory, на iPhone по кабелю. Прогоны с открытым Web Inspector и без него не
смешивать. Энергосбережение выключено, телефон на зарядке и не перегрет; записывать, какой режим
частоты был (60 Гц по умолчанию или ProMotion). Отставание — запись экрана 120/240 fps (QuickTime на
Mac, замедленная съёмка вторым телефоном для iPhone) на полосатой линейке.

---

## 11. Риски

| # | Риск | Вероятность / вред | Что делаем |
|---|---|---|---|
| R1 | Картинка в линзе шапки отстаёт от фото на кадр | высокая / средний | упреждение, размытие по скорости, A/B `lens`/`ring`, `frost` выше 1500 px/с; мерить первым |
| R2 | Шов середины и кольца в `ring` (размытие, цвет, цветовое пространство `backdrop-filter` и шейдера) | средняя / высокий («наклейка») | общий тон на `.lg-frost`, `clearBlur` подбирать под `frost`, мягкий край 4–6 px; проверка решёткой. Виден шов — остаётся `lens` |
| R3 | Центр линзы `lens` не совпадает с фото по цвету или резкости | средняя / высокий | `srgb` по умолчанию, `lodBias`, решётка и P3-картинка (4.5) |
| R4 | Забытый окклюдер: фото «сквозь текст» | средняя / высокий | явные окклюдеры, подсветка в HUD, автопоиск в v2 |
| R5 | Рывок при заливке текстуры на смене слайда | средняя / средний | `prepare()` в простое, `decode()` до `is-on` |
| R6 | Потеря контекста и память на iOS | средняя / низкий | ≤ 4 контекста, 768 px, ленивое создание, `width = 0`, `frost` по `contextlost` |
| R7 | Тонировка панелей Safari 26 от липкой шапки | средняя / низкий | прозрачный host, матовость на дочернем слое; проверить на iPhone |
| R8 | Safari не сообщает «Уменьшить прозрачность» | точно / средний | выключатель на сайте, затемнение под текстом, `prefers-contrast` |
| R9 | Энергосбережение iOS: 30 Гц, регулятор зря уходит в `frost` | средняя / низкий | период из медианы интервалов |
| R10 | Выборка за краем фото на выходе из героя | высокая / низкий | `MIRRORED_REPEAT` у верха, гашение изгиба у края, ранний `frost` |
| R11 | Новые пресеты не дают «того самого» вида владелец сайтаа | средняя / средний | лаборатория: старое и новое рядом на решётке |
| R12 | iOS 26: fixed/sticky прыгает на ~10 px при сворачивании адресной строки | средняя / низкий | геометрия от `visualViewport`, пересчёт на его `resize`/`scroll` ([WebKit 297779](https://bugs.webkit.org/show_bug.cgi?id=297779)) |
| R13 | `backdrop-filter` и canvas-потомок в одном host ведут себя в Safari неожиданно (backdrop root, порядок слоёв) | низкая–средняя | первый A/B в прототипе; запасной вариант — canvas соседом host |
| R14 | Продуктовый: над текстом стекло никогда не жидкое | — | так у Apple (Regular); при желании v2 `domRefraction` (только Chromium) |
| R15 | WebKit ведёт себя иначе, чем Chrome (как было с SVG) | неизвестно | прототип сразу в настоящем Safari и на iPhone |

---

## 12. Первый шаг: прототип шапки и приёмка

Всё в `glass-rnd/proto/`, сайт не трогаем. Отдаётся `python3 -I -m http.server <порт> --bind
127.0.0.1` (для iPhone — на адресе локальной сети) и открывается **в настоящем Safari** на Mac и на
iPhone.

### 12.1 Страница `proto/header.html` (~300–400 строк, без сборки)

Копия героя: одно-два фото (одно с полосатой линейкой и решёткой поверх), липкая капсула, плашка как
`.hero__panel`, круглая кнопка на фото. Переключатели:
- `?mode=lens|ring|svg|frost|solid` (`svg` — нынешний фильтр для сравнения);
- `?k=1|3|5`, `?predict=0|1`, `?fast=600|1500|off`, `?dpr=1|1.5|2`;
- встроенный зонд (10.3) и HUD.

### 12.2 Порядок проверок

1. **Скорость.** Safari Mac, затем iPhone: p95 и худший кадр при прокрутке трекпадом и пальцем,
   `lens` против `ring` против `svg` против `frost`. Цели — 10.1.
2. **Отставание.** Запись 120/240 fps медленной (≈ 300 px/с) и быстрой (≈ 1500 px/с) прокрутки,
   `lens` ± `predict` против `ring`. Решение по `core` для шапки:
   отставание середины `lens` видно, а шва `ring` на решётке нет → шапка на `ring`; иначе `lens`.
3. **Шов и цвет.** Решётка и P3-фото под стеклом: центр линзы против фото рядом (`lens`), стык
   середины и кольца (`ring`), одинаковость в Safari, Chrome и Firefox.
4. **Переходы.** `frost ↔ liquid` с `uLens`: нет ли вспышки или скачка кромки.
5. **Окклюдер.** Шапка над стыком фото и плашки.
6. **Кнопка на постере** на iPhone: рисуется один раз, при прокрутке ноль работы (Timelines).
7. **CSS-мелочи в Safari:** `mask-composite: exclude` на `::before` (запасной путь — три `inset
   box-shadow`, работает на сайте [S27]), `@property` для угла блика, `prefers-contrast: more`.
8. **Тонировка панелей Safari 26** на iPhone в обоих режимах нижней панели.
9. Для справки (5 минут): флаг «Разработка → Флаги функций → Accelerated Filter Rendering» вкл/выкл
   на режиме `svg`. Он подтверждает, что тормозит именно программный фильтр
   ([UnifiedWebPreferences.yaml](https://github.com/WebKit/WebKit/blob/main/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml):
   `AcceleratedFiltersEnabled` выключен). Заодно видно, стоит ли ждать WebKit PR 68613.
10. Lockdown Mode на iPhone: есть ли WebGL2.

### 12.3 Что дальше по результату

- Всё прошло → `lg.js`, `lg-gl.js`, `lg.css`, `сайт-пример-glass.js` в `glass-rnd/site-next/` с отчётом
  «было/стало», лаборатория с ползунками нового пути рядом со старым, владелец сайта подбирает `bar/pill/dot`.
- iPhone не прошёл, Mac прошёл → `mobile: 'frost'` остаётся, на телефоне матовое с CSS-кромкой и
  бликом (по [apple.md](research/apple.md) §11 это около 70 % узнаваемости).
- Не прошёл и Mac → шапка `frost` везде, жидкое только на стёклах `sync: content` (они дешёвые в
  любом случае), а для шапки — промежуточная правка SVG (9.6) на Mac.

---

## 13. v2 (не входит в первую версию)

- Автопоиск окклюдеров (позиционированные потомки медиа-контейнера) и больше 4 окклюдеров.
- Один `OffscreenCanvas` + `bitmaprenderer` на страницу, когда стёкол станет больше 4.
- Живое видео под стеклом (rVFC, 30 Гц, 640 px), только по замеру на iPhone; при проблемах —
  WebGPU-бэкенд с `importExternalTexture` ([webgpufundamentals](https://webgpufundamentals.org/webgpu/lessons/webgpu-textures-external-video.html), там же описаны баги Safari).
- Модуль `domRefraction: 'chromium'`: `backdrop-filter: url()` с картой из canvas через `feImage`
  (альфа карты 255, [emit-solution](https://emit-solution.com/en/blog/recreate-apple-liquid-glass-css))
  для стекла над живым DOM, только Chromium, по движку. Вид в Chrome будет отличаться от Safari, по
  умолчанию выключен.
- Подвижный блик от гироскопа на iPhone (нужен запрос разрешения).
- Следить: WebKit PR [68613](https://github.com/WebKit/WebKit/pull/68613) (ускоренные фильтры) и
  [68614](https://github.com/WebKit/WebKit/pull/68614) (`backdrop-filter: url()`, тоже программный);
  [w3c/svgwg#1142](https://github.com/w3c/svgwg/issues/1142) (стандарт «пикселей под элементом»);
  HTML-in-Canvas в Chrome ([origin trial](https://developer.chrome.com/blog/html-in-canvas-origin-trial)).

---

## Источники

Наши отчёты (там полные списки): `design/hybrid.md`, `design/gpu.md`, `design/free.md`,
`design/svg.md`, `research/apple.md`, `audit.md`, `browsers.md`, `fresh.md`, `graphics.md`,
`implementations.md`, `performance.md`.

Ключевые первоисточники:
- Apple: [WWDC25 219](https://developer.apple.com/videos/play/wwdc2025/219/), [HIG Materials](https://developer.apple.com/design/human-interface-guidelines/materials)
- Оптика и шейдер: [kube.io](https://kube.io/blog/liquid-glass-css-svg/), [Inigo Quilez, SDF с градиентом](https://iquilezles.org/articles/distgradfunctions2d), [Charles Grassi](https://charlesgrassi.dev/blog/apple-liquid-glass/), [m2-md (MIT, замеры GPU)](https://github.com/m2-md/liquid-glass-refraction-shader/blob/main/README.md), [Epic, Pixel Normal Offset](https://dev.epicgames.com/documentation/unreal-engine/refraction-using-pixel-normal-offset-in-unreal-engine)
- Прокрутка и отставание: [Mozilla, scroll-linked effects](https://firefox-source-docs.mozilla.org/performance/scroll-linked_effects.html), [joyco](https://hub.joyco.studio/logs/08-webgl-scroll-sync), [Lusion WebGL-Scroll-Sync (MIT)](https://github.com/lusionltd/WebGL-Scroll-Sync), [w3c/svgwg#1142](https://github.com/w3c/svgwg/issues/1142), [`scrollend` в Safari 26.2](https://www.infoq.com/news/2026/04/safari-scrollend-support), [60 Гц в Safari](https://www.macrumors.com/how-to/enable-smoother-120hz-browsing-in-safari/), [Lenis](https://www.edoardolunardi.dev/blog/building-smooth-scroll-in-2025-with-lenis)
- WebKit и Safari: [UnifiedWebPreferences.yaml](https://github.com/WebKit/WebKit/blob/main/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml), [WebKit 175497](https://bugs.webkit.org/show_bug.cgi?id=175497), [WebKit 236699](https://bugs.webkit.org/show_bug.cgi?id=236699), [WebKit 231031](https://bugs.webkit.org/show_bug.cgi?id=231031), [WebKit 297779](https://bugs.webkit.org/show_bug.cgi?id=297779), [WebKit 180301](https://bugs.webkit.org/show_bug.cgi?id=180301), [Safari 27.0](https://webkit.org/blog/18325/webkit-features-for-safari-27-0/), [1ar.io, тонировка панелей](https://1ar.io/updates/safari-26-liquid-glass-web/)
- Видео в WebGL: [web.dev, rVFC](https://web.dev/articles/requestvideoframecallback-rvfc), [MDN rVFC](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback), [media-mock#81](https://github.com/eatsjobs/media-mock/issues/81), [orktes/jsui#74](https://github.com/orktes/jsui/pull/74)
- Цвет WebGL: [MDN unpackColorSpace](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/unpackColorSpace), [MDN drawingBufferColorSpace](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/drawingBufferColorSpace), [web-features: WebGL color management](https://web-platform-dx.github.io/web-features-explorer/features/webgl-color-management/), [Genzo#24](https://github.com/GabrielBG0/Genzo/pull/24)
- Доступность: [caniuse prefers-reduced-transparency](https://caniuse.com/wf-prefers-reduced-transparency), [Chrome о prefers-reduced-transparency](https://developer.chrome.com/blog/css-prefers-reduced-transparency)
- Холсты и контексты: [pqina, память холстов iOS](https://pqina.nl/blog/total-canvas-memory-use-exceeds-the-maximum-limit/), [ashk.au](https://ashk.au/2024/02/07/dev-log-debugging-safari-an-ogre-with-layers/), [MDN transferToImageBitmap](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas/transferToImageBitmap), [whatwg/html#7833](https://github.com/whatwg/html/issues/7833)
- Реализации: [Amir-Abushanab/liquid-glass-js](https://github.com/Amir-Abushanab/liquid-glass-js), [naughtyduk/liquidGL](https://github.com/naughtyduk/liquidGL), [ybouane/liquidglass](https://github.com/ybouane/liquidglass), [emit-solution](https://emit-solution.com/en/blog/recreate-apple-liquid-glass-css), [dev.to, 6 способов](https://dev.to/devyatov/liquid-glass-on-the-web-6-ways-to-build-it-with-css-and-svg-3m07)
- Firefox: [bug 1732817](https://bugzilla.mozilla.org/show_bug.cgi?id=1732817)
