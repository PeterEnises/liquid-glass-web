# Стекло и преломление: как это делают в графике и играх и как перенести в браузер

*Ночное исследование 30.10.2026. Пометка «[Safari ?]» значит, что в настоящем Safari это не проверено:
либо данные из документации и чужих отчётов, либо из Chromium. Проверенное нами в Safari 27 описано в `../CONTEXT.md`.*

## Коротко

1. Игры не трассируют настоящее стекло. Они берут **уже отрисованную картинку того, что за стеклом**
   (scene color, grab pass, opaque texture) и **сдвигают координаты выборки** по нормали поверхности.
   Это и есть screen-space refraction. Поверх добавляют Френеля (Шлик), блик и иногда размытие по шероховатости.
   Наш SVG-фильтр делает то же самое, только на CPU и с картой изгиба, которую каждый кадр заново
   считает Собель по SourceAlpha.
2. У нас под стеклом шапки всегда **одна картинка** (слайд первого экрана). Это ровно тот случай, где
   WebGL проще и надёжнее SVG: картинка своего домена → `texImage2D(img)` → шейдер. Захват DOM не нужен,
   а Safari-баги с `feImage`, `userSpaceOnUse` и композитными слоями (`../CONTEXT.md`) нас больше не касаются.
3. По опубликованным замерам шейдер стекла стоит **~0,1–0,2 мс GPU на кадр** (M2 Pro, панель 960×540,
   Chrome/ANGLE-Metal). Это на порядок дешевле CPU-фильтра. Для iPhone чужих цифр нет [Safari ?].
4. Главный риск WebGL — **не скорость, а синхронизация с прокруткой** (см. ниже). Его нужно мерить
   в настоящем Safari первым делом.
5. HTML-in-Canvas — только Chromium, origin trial до Chrome 160, API ещё меняется. У WebKit позиции нет,
   у Mozilla её нет или она отрицательная. Для нас это дополнительный путь в Chrome, не основа.
6. WASM для стекла не нужен: работа попиксельная и идёт на GPU. Карту изгиба один раз считает JS
   за доли миллисекунды.

---

## 1. Как это устроено в графике

### 1.1 Screen-space refraction (SSR-преломление)
- Сначала рендерят непрозрачную сцену в текстуру. Потом стекло читает её по экранным UV со смещением
  `uv + offset(normal, view, IOR)`.
- В Unity это Opaque Texture / Scene Color, сдвиг считают через `refract()` с IOR и переводят в экранное
  пространство ([80.lv, Unity](https://80.lv/articles/making-stunning-glass-refraction-effects-in-unity)).
  Мирза Бейг советует переводить вектор преломления в касательное пространство и только потом прибавлять
  к UV; IOR стекла ≈ 1,54 ([X, Mirza Beig](https://x.com/TheMirzaBeig/status/1944634252571660514)).
- В Unreal два режима ([Epic: Pixel Normal Offset](https://dev.epicgames.com/documentation/unreal-engine/refraction-using-pixel-normal-offset-in-unreal-engine)):
  - **Index of Refraction** — физический. На больших плоских поверхностях даёт постоянный сдвиг и
    «читает за краем экрана», отсюда артефакты.
  - **Pixel Normal Offset** — нефизический: сдвиг пропорционален разнице между нормалью пикселя и
    нормалью вершины. Плоская часть не сдвигается вообще, изгиб есть только там, где кривится нормаль.
  **Для UI-стекла правильный именно второй режим**: в центре капсулы картинка не сдвинута, у кромки
  загибается. Так ведёт себя и Apple Liquid Glass.
- Ограничение метода: за краем текстуры данных нет. Поэтому `CLAMP_TO_EDGE` или запас текстуры
  ([m2-md README](https://github.com/m2-md/liquid-glass-refraction-shader/blob/main/README.md)).
  У нас та же история, отсюда расширенная область SVG-фильтра.

### 1.2 Откуда берётся нормаль: normal map, height map, SDF
- В играх нормаль обычно берут из **normal map** (текстура RGB = xyz). Для UI-стекла её удобнее
  **вычислять по форме**:
  - **SDF скруглённого прямоугольника или сквиркла** (signed distance: расстояние до края со знаком);
  - **профиль высоты кромки** h(d) по этому расстоянию;
  - нормаль = градиент высоты: `n = normalize(-dh/dd · grad(sdf), 1)`.
- Профили кромки у kube.io ([kube.io, «Liquid Glass in the Browser»](https://kube.io/blog/liquid-glass-css-svg/)):
  - выпуклая дуга `y = √(1−(1−x)²)` — резкий переход к плоскому центру;
  - **выпуклый сквиркл `y = ⁴√(1−(1−x)⁴)`** — мягкий переход, не рвётся при растяжении (ближе всего к Apple);
  - вогнутый `1 − convex` — уводит лучи наружу, не нужен;
  - «губа» — смесь двух профилей.
- Чарльз Грасси строит сквиркл-SDF (n = 4, непрерывная кривизна, как у Apple) и бевел
  `1 − smoothstep(−w, 0, sdf)`. Нормаль у него `normalize(vec3(dir·bevel, 1 − bevel·0.5))`
  ([charlesgrassi.dev](https://charlesgrassi.dev/blog/apple-liquid-glass/)).
- **Сравнение с нами:** мы получаем нормаль Собелем по размытой SourceAlpha. Это та же height map
  (размытие = профиль), только профиль задан гауссом, а не формулой, и пересчитывается каждый кадр.
  Аналитический SDF в шейдере точнее, позволяет менять профиль и ничего не стоит при прокрутке.

### 1.3 Закон Снеллиуса и величина сдвига
- `n₁·sinθ₁ = n₂·sinθ₂`, воздух → стекло: n = 1 → 1,5. Луч падает на фон перпендикулярно;
  сдвиг — насколько дальше он упадёт на подложку на толщине t:
  `offset = t · tan(θ₁ − θ₂)`, где θ₁ — угол между лучом и нормалью.
  В GLSL проще: `vec3 r = refract(vec3(0,0,-1), n, 1.0/ior); offset = r.xy / -r.z * thickness`.
- kube.io заранее считает сдвиг вдоль одного радиуса (127 лучей), нормирует и разворачивает в карту.
  Ход дешёвый: менять `scale` можно без пересборки карты; карту пересобирает только смена формы
  ([kube.io](https://kube.io/blog/liquid-glass-css-svg/)). В шейдере тот же расчёт идёт прямо
  попиксельно, карта не нужна.

### 1.4 Дисперсия (цветная аберрация)
Три способа, по возрастанию цены:
1. **Три выборки R/G/B со сдвигами `uv ∓ dir·k`** вдоль градиента кромки, где k ∝ силе изгиба
   ([Grassi](https://charlesgrassi.dev/blog/apple-liquid-glass/)). Так же устроен наш фильтр с тремя
   feDisplacementMap.
2. **Свой IOR на каждый канал** и три `refract()`
   ([Codrops 2026, TSL/WebGPU](https://tympanus.net/codrops/2026/09/08/building-an-infinite-liquid-glass-grid-with-three-js-webgpu-and-tsl/),
   three.js `MeshPhysicalMaterial.dispersion`, с r164, [docs](https://threejs.org/docs/pages/MeshPhysicalMaterial.html)).
3. **Спектральная развёртка** на N выборок с весами по длинам волн. У m2-md 1/3/8 выборок стоят
   0,131/0,164/0,217 мс GPU, ≈0,012 мс на выборку
   ([README](https://github.com/m2-md/liquid-glass-refraction-shader/blob/main/README.md)).
   Мягкая «радуга» без трёх резких контуров. Для «оптики сайт-пример» это, пожалуй, красивее всего,
   а по цене почти бесплатно.

### 1.5 Френель и френелевский блик
- Шлик: `F = F0 + (1−F0)(1−cosθ)^5`, для стекла F0 ≈ 0,04 (4 % отражения в лоб, у скользящих углов
  почти зеркало). Цвет `mix(refracted, reflected, F)`, сверху блик Блинна–Фонга
  ([Grassi](https://charlesgrassi.dev/blog/apple-liquid-glass/)).
- В UI «отражать» нечего, поэтому F берут как **маску светлой кромки**: у края cosθ мал → кромка
  светлеет сама. Это физически правильная замена нашему «кромка 40 %».
- **Направленный блик**: `pow(max(dot(n, L), 0), k)` с источником сверху-слева даёт яркую дугу
  у верхней кромки и тусклую у нижней, как у Apple. У kube.io это `feImage` со спекуляром поверх
  ([kube.io](https://kube.io/blog/liquid-glass-css-svg/)); в Safari `feImage` у нас не работает,
  а в шейдере это одна строка.

### 1.6 Размытие (матовость)
- Дёшево: уменьшить подложку вдвое (размытие в 2 раза шире) + разделяемый гаусс по X и Y;
  билинейная выборка между текселями сокращает 9 выборок до 5
  ([Grassi](https://charlesgrassi.dev/blog/apple-liquid-glass/)).
- Ещё дешевле для статичной картинки: **mip-карты**. `generateMipmap` один раз на слайд, потом
  `textureLod(tex, uv, lod)` с lod по шероховатости. Блочно, но при lod ≤ 2 и лёгком размытии
  незаметно. Для drei MeshTransmissionMaterial советуют вообще 32×32 при шероховатости
  ([drei](https://drei.docs.pmnd.rs/shaders/mesh-transmission-material)).
- Kawase/dual-filter blur из игр (2–4 прохода на уменьшенных копиях) — если нужно сильное размытие.

### 1.7 Чего в UI-стекле не нужно
Raymarching толщи, поглощение Бера–Ламберта, каустики, многократное преломление
([Codrops 2019](https://tympanus.net/codrops/2019/10/29/real-time-multiside-refraction-in-three-steps/),
[glass-optics-shader](https://github.com/Jinkieyz/glass-optics-shader)) — это для 3D-объектов.
Для плоской капсулы хватает одного преломления по SDF.

---

## 2. Как перенести в браузер

### 2.1 Главная проблема: текстура «того, что за стеклом»
WebGL не умеет читать пиксели страницы. Варианты:

| Источник | Как | Safari | Цена | Для нас |
|---|---|---|---|---|
| `<img>` своего домена | `texImage2D(img)` один раз на слайд | да (стандарт WebGL) | загрузка 1 раз, потом 0 | **основной путь для шапки над героем** |
| `<video>` | `texImage2D(video)` каждый кадр, `requestVideoFrameCallback` | исторически медленно и с регрессиями (iOS 14, 15.4: ×20) ([WebKit 236699](https://bugs.webkit.org/show_bug.cgi?id=236699), [216250](https://bugs.webkit.org/show_bug.cgi?id=216250)) [Safari ?] | 2–3 мс на кадр в хорошем случае | если герой станет видео — мерить отдельно |
| `<canvas>` | текстура из canvas | да | копия кадра | если фон рисуем сами |
| Снимок DOM (html-to-image / foreignObject) | клон DOM → SVG foreignObject → canvas | WebKit раньше «отравлял» canvas с foreignObject ([WebKit 180301](https://bugs.webkit.org/show_bug.cgi?id=180301)); свежий отчёт: html-to-image в WebKit теряет `url()`-фоны и тени ([PR, 10.2026](https://github.com/sykrwasd/uitmgettable/pull/31)) [Safari ?] | 100–500 мс на снимок ([liquidglass](https://github.com/ybouane/liquidglass)) | нет: медленно, ненадёжно в Safari |
| HTML-in-Canvas | `drawElementImage` / `texElementSubImage2D` / `drawElementImageToTexture` | **нет** | см. 2.4 | только Chrome, как улучшение |

Вывод совпадает с нашим решением от 29.10: копия всей страницы под стеклом не нужна. Под капсулой
только слайд, и шейдер берёт его как текстуру.

### 2.2 WebGL2-шейдер (рекомендуемый путь)
Схема:
- Один `<canvas>` размером с капсулу шапки, внутри элемента шапки. Текст и ссылки шапки остаются
  DOM поверх canvas.
- Текстура = текущий слайд (и следующий на время кроссфейда: `mix(texA, texB, t)` — кроссфейд тоже
  уходит в шейдер).
- Uniform'ы: прямоугольник капсулы в координатах картинки (из `getBoundingClientRect` героя и шапки),
  радиус, rim/bend/spread/soft, тон, свет, кромка.
- Фрагментный шейдер: SDF сквиркла → профиль кромки → нормаль → `refract` → 3 или N выборок
  дисперсии → `textureLod` для матовости → тон → Френель-кромка → направленный блик.
- Рисовать только при изменении (прокрутка, слайд, ресайз), без вечного rAF-цикла.
- При `prefers-reduced-transparency` / `prefers-reduced-motion`, потере контекста (`webglcontextlost`),
  отсутствии WebGL2 и т. п. — текущее матовое `backdrop-filter`.

Набросок ядра (GLSL ES 3.0):
```glsl
float sdRoundBox(vec2 p, vec2 b, float r){            // Inigo Quilez
  vec2 q = abs(p) - b + r; return length(max(q,0.)) + min(max(q.x,q.y),0.) - r; }
// сквиркл: length() заменить на pow(dot(q*q,q*q), .25) для q>0 (норма L4)
// d < 0 внутри; x = clamp(-d / rim, 0, 1) — доля бевела
float h(float x){ return pow(1. - pow(1. - x, 4.), .25); }       // выпуклый сквиркл (kube.io)
vec2  g = normalize(gradSdf(p));                                   // направление наружу
float dh = (h(x+1e-3) - h(x-1e-3)) / 2e-3;
vec3  n = normalize(vec3(-g * dh * bend, 1.));
vec3  r = refract(vec3(0,0,-1), n, 1./1.5);
vec2  off = r.xy / -r.z * thickness;                               // Pixel-Normal-Offset: в центре 0
vec3 col; for (int i=0;i<N;i++){ float w=float(i)/float(N-1);      // спектр
  col += spectrum(w) * textureLod(img, uv + off*(1.+spread*(w-.5)), lod).rgb; }
float F = .04 + .96*pow(1. - n.z, 5.);                             // Шлик, cosθ = n·v = n.z
col = mix(col, vec3(1), F*rimLight) + spec*pow(max(dot(n,L),0.), 24.);
```
Аналитический SDF скруглённого прямоугольника — у Inigo Quilez
([iquilezles.org, 2D distance functions](https://iquilezles.org/articles/distfunctions2d/)).

**Сравнение с SVG-фильтром:**
- SVG: Собель + 3 смещения + 2 гаусса на CPU в Safari, каждый кадр прокрутки. Отсюда худший кадр
  33 мс (наш замер) и отставание от прокрутки.
- WebGL: один проход на GPU. ~0,16 мс на M2 Pro при 960×540 (m2-md); наша капсула примерно
  1000×64 CSS px × DPR 2 ≈ 0,26 Мпикс, то есть меньше их панели. На iPhone GPU слабее в разы, но
  запас в 50–100 раз до бюджета кадра [Safari ?, iPhone не мерили].
- Одинаково выглядит в Safari, Chrome и Firefox (свой шейдер, а не разные реализации SVG-фильтров).
  Это лечит «в Chrome выглядит иначе».
- Нет запрета на `translate3d`/`will-change`: canvas — обычный слой.

**Риск: синхронизация с прокруткой.** Прокрутка в Safari и Chrome идёт на композиторе, а canvas
перерисовывается из JS по `scroll`/rAF. Возможно отставание на кадр: картинка в линзе «плывёт»
относительно настоящего фото вокруг (при 2000 px/с это до ~33 px за кадр). Варианты:
- (а) canvas в фиксированной шапке и сдвиг текстуры по `scrollY` — мерить в Safari, насколько видно;
- (б) рисовать в одном canvas и героя, и линзу — тогда они всегда совпадают, а отставать может
  только DOM-текст героя;
- (в) как liquidGL: подключать прокрутку через smooth-scroll-библиотеку (Lenis и т. п.), чтобы
  прокрутка шла из JS ([liquidGL `syncWith`](https://github.com/naughtyduk/liquidGL)). Но это ломает
  нативное ощущение прокрутки на iPhone; я бы не стал;
- (г) пока герой не под шапкой — WebGL не рисуем вообще (матовое стекло), как сейчас.
Это надо первым делом проверить прототипом в настоящем Safari.

### 2.3 WebGPU
- В Safari 26+ (macOS Tahoe, iOS/iPadOS 26) WebGPU включён по умолчанию; к ноябрю 2025 он есть во
  всех основных браузерах ([gpuweb wiki](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status),
  [webgpu.com](https://webgpu.com/news/webgpu-hits-critical-mass-all-major-browsers/)). На старых macOS
  Safari 26 может работать без WebGPU [Safari ?].
- Для одного полноэкранного прохода выигрыша над WebGL2 почти нет: узкое место — заливка пикселей,
  а не вызовы API. Минусы: асинхронная инициализация (`requestAdapter`), больше кода, у части
  посетителей (старые iOS) его нет.
- Вывод: **WebGL2 как основа** (iOS 15+), WebGPU — только если понадобятся compute-проходы
  (например, Kawase-размытие большого радиуса). Один и тот же шейдер можно держать на GLSL и WGSL,
  либо взять three.js TSL, который собирает оба
  ([Codrops 2026](https://tympanus.net/codrops/2026/09/08/building-an-infinite-liquid-glass-grid-with-three-js-webgpu-and-tsl/)).
  three.js ради одного квадрата — лишние ~150 КБ gzip, свой код на 200–300 строк лучше.

### 2.4 HTML-in-Canvas (Chromium)
- `<canvas layoutsubtree>` (с Chrome 155 — `content="drawable"`) рисует **живой DOM-потомок** в canvas:
  2D `drawElementImage`, WebGL `texElementImage2D` → `texElementSubImage2D` (с 155), WebGPU
  `copyElementImageToTexture` → `drawElementImageToTexture` (с 155). Событие `paint` — когда потомок
  перерисовался ([Chrome blog, OT](https://developer.chrome.com/blog/html-in-canvas-origin-trial),
  [изменения API](https://developer.chrome.com/blog/html-in-canvas-ot-changes),
  [WICG spec](https://wicg.github.io/html-in-canvas/)).
- Статус: origin trial Chrome 148–150, продлён до Chrome 160 с обновлением токена. Edge — триал
  до 20.10.2026 ([Edge OT](https://developer.microsoft.com/en-us/microsoft-edge/origin-trials/trials/a297467e-0030-4c4c-8739-48e130026c03)).
  WebKit — без сигнала, Mozilla — позиции нет или отрицательная (источники расходятся,
  [mozilla/standards-positions#1076](https://github.com/mozilla/standards-positions/issues/1076)).
- Ограничения: нет кросс-доменных iframe; содержимое рисуется из JS на главном потоке, поэтому
  прокрутка внутри canvas теряет композиторную плавность
  ([Chrome blog](https://developer.chrome.com/blog/html-in-canvas-origin-trial)).
- Для нас: это единственный честный способ преломлять **произвольный** DOM (текст, карточки), но
  только в Chrome и под токеном, а API меняется каждые несколько версий. **Не основа.** Можно держать
  как эксперимент в лаборатории (`glass-lab`), за feature-detect.

### 2.5 WASM
Стекло — попиксельная работа, место ей на GPU. На CPU (WASM SIMD) это та же беда, что у SVG-фильтра
в Safari: 0,5–1 Мпикс × 10+ выборок на кадр. Карта изгиба (если вдруг нужна для SVG-запаса) считается
JS-ом за ~1 мс один раз на форму, как у kube.io. **WASM не нужен.**

### 2.6 Что можно взять для SVG-запаса (Firefox/без WebGL)
**Заранее посчитанная карта по Снеллиусу** (kube.io) вместо Собеля по SourceAlpha в рантайме убрала бы
из фильтра feGaussianBlur+feConvolveMatrix. Но для этого нужен `feImage`, а он в Safari 27 у нас рисует
пустоту (`../CONTEXT.md`). Значит, это путь только для Chrome/Firefox, в Safari — WebGL.

---

## 3. Готовые реализации (что посмотреть)

| Проект | Подход | Лицензия | Чем полезен | Минусы для нас |
|---|---|---|---|---|
| [m2-md/liquid-glass-refraction-shader](https://github.com/m2-md/liquid-glass-refraction-shader/blob/main/README.md) | WebGL2: FBO подложки → квад панели, rounded-box SDF, четвертькруг-бевел, `refract`, спектральная дисперсия, Шлик; есть парный SVG-путь | MIT | **лучший учебный образец + замеры GPU** | подложка — свой узор, не DOM |
| [TiHxdvt/liquid-glass-webgl](https://github.com/TiHxdvt/liquid-glass-webgl) | WebGL2, Snell · Schlick · SDF, один файл без зависимостей | не проверял | компактный старт | не проверено |
| [naughtyduk/liquidGL](https://github.com/naughtyduk/liquidGL) | WebGPU с запасом на WebGL, свой растеризатор снимка страницы, `syncWith` под smooth-scroll | MIT | общий canvas на все линзы (до 30) | fixed-элементы игнорирует, анимации CSS не преломляет, Safari «нестабилен» при линзе > 50 % экрана — шапка как раз такая |
| [ybouane/liquidglass](https://github.com/ybouane/liquidglass) | WebGL1 + снимок DOM через html-to-image | MIT | конфиг на элемент | контекст на каждый элемент (лимит ~16), init 100–500 мс, foreignObject в Safari ненадёжен |
| [kube.io: Liquid Glass CSS/SVG](https://kube.io/blog/liquid-glass-css-svg/) | SVG `backdrop-filter`, карта по Снеллиусу | — | **профили кромки и расчёт сдвига** | только Chrome |
| [Charles Grassi](https://charlesgrassi.dev/blog/apple-liquid-glass/) | WebGL, сквиркл-SDF, Шлик, Блинн–Фонг, размытие на ½ | — | понятные формулы | без замеров |
| [Codrops: Liquid Glass grid, TSL/WebGPU](https://tympanus.net/codrops/2026/09/08/building-an-infinite-liquid-glass-grid-with-three-js-webgpu-and-tsl/) | three.js TSL, IOR на канал | — | WebGPU-вариант | тяжёлая зависимость |
| [Jinkieyz/glass-optics-shader](https://github.com/Jinkieyz/glass-optics-shader) | raymarching, Бер–Ламберт | — | физика 3D-стекла | избыточно |
| [Godot: screen-space refraction](https://godotshaders.com/shader/screen-space-refraction-shader/) | normal map + сила | — | игровой эталон | Godot 4 с ошибками |

Лицензии, кроме явно MIT, я не открывал. Если что-то брать — проверить.
Реалистично берём не библиотеку, а **формулы**: шейдер на 100–150 строк плюс обвязка на 150 строк — это
меньше и понятнее любой из библиотек, и под нашу задачу (одна текстура-слайд) они не заточены.

---

## 4. Скорость: что известно и что мерить

| Путь | Данные | Источник |
|---|---|---|
| SVG-фильтр над фото, Safari Mac | 60 fps, худший кадр 33 мс, отстаёт от прокрутки | наш замер (`../CONTEXT.md`) |
| WebGL2 стекло 960×540, M2 Pro, Chrome | GPU 0,16 мс (база 0,11), кадр 8,3 мс по vsync 120 Гц, p95 ≈ 9 мс, 0 пропусков | [m2-md](https://github.com/m2-md/liquid-glass-refraction-shader/blob/main/README.md) |
| Дисперсия 1/3/8 выборок | 0,131 / 0,164 / 0,217 мс | там же |
| Снимок DOM для подложки | 100–500 мс | [liquidglass](https://github.com/ybouane/liquidglass) |
| video → texImage2D, Safari | 2–3 мс в лучшем случае, были регрессии ×20 | WebKit-баги выше [Safari ?] |
| iPhone, любой WebGL-вариант | **нет данных** | [Safari ?] |

План замеров для прототипа (Safari Mac, iPhone, Chrome, Firefox):
1. Время кадра и худший кадр при прокрутке героя — WebGL против SVG против матового.
2. Отставание линзы от прокрутки: запись экрана 120/240 fps, смещение картинки в линзе против фото рядом.
3. GPU-время шейдера (`EXT_disjoint_timer_query_webgl2` в Chrome; в Safari этого расширения нет [Safari ?],
   там — по кадрам).
4. Смена слайда: кроссфейд в шейдере против текущего.
5. Батарея и нагрев iPhone за минуту прокрутки.

## 5. Рекомендация
1. Шапка над героем — **WebGL2-линза по текстуре слайда** со сквиркл-SDF, профилем kube.io,
   Pixel-Normal-Offset-сдвигом, спектральной дисперсией на 3–5 выборок, Френель-кромкой и
   направленным бликом. Рисовать только по событию. Кроссфейд слайдов — в том же шейдере.
2. Запасной путь: нет WebGL2, потерян контекст, «Уменьшить прозрачность» или слабое устройство по
   замеру — текущее матовое `backdrop-filter`. SVG-фильтр оставить только для лаборатории или Firefox,
   если он там лучше.
3. Первый эксперимент — синхронизация с прокруткой в настоящем Safari (варианты а/б из 2.2).
   Если отставание заметно, вариант (б): герой целиком рисуется в canvas.
4. HTML-in-Canvas — эксперимент в лаборатории за feature-detect. WebGPU и WASM не нужны.
