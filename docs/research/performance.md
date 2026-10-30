# Скорость жидкого стекла: что стоит дорого и как сделать быстро

Черновик ночного исследования 30.10.2026. Живой сайт не трогал.
Метки в тексте:
- **[исходники]** — прочитал код движка (WebKit `main` на GitHub, 30.10.2026);
- **[источник]** — статья, баг или документация, ссылка в конце раздела;
- **[проверено в Safari]** — из CONTEXT.md, владелец сайта проверял в настоящем Safari 27;
- **[не проверено в Safari]** — вывод или гипотеза, на реальном Safari/iPhone ещё не мерили.

---

## 0. Коротко

1. **В Safari SVG-фильтр считает процессор, и это видно в коде.** В WebKit есть два набора «исполнителей» фильтров: программный (`filters/software/*SoftwareApplier`) и на Core Image (`coreimage/*CoreImageApplier`, там есть и feDisplacementMap, и feConvolveMatrix). Но настройка `AcceleratedFiltersEnabled` («Accelerated CSS and SVG filter rendering») помечена `status: unstable, defaultValue: false`. `Page::preferredFilterRenderingModes()` без неё отдаёт только `Software` (плюс `GraphicsContext` для простых blur/drop-shadow). Значит, в обычном Safari наша цепочка feConvolveMatrix → feDisplacementMap ×3 идёт на CPU **[исходники]**. Это совпадает с тем, что пишет Outpace Studios **[источник]**.
2. **Фильтр пересчитывается целиком на каждом кадре, где под ним что-то сдвинулось.** У фильтра, который двигает пиксели (`hasFilterThatMovesPixels`), WebKit перерисовывает всю область фильтра, а не только изменившийся кусок **[исходники]**. Копия фона под шапкой сдвигается на каждом кадре прокрутки, поэтому на каждом кадре идёт полный пересчёт.
3. **Chrome считает те же фильтры на GPU** (Skia), поэтому там «почти бесплатно» **[источник]**. **Firefox** с версии 132 ускоряет на GPU только 9 примитивов (blend, colorMatrix, componentTransfer, composite, dropShadow, flood, gaussianBlur, merge, offset). feDisplacementMap и feConvolveMatrix в этот список не входят, то есть идут на CPU **[источник]**.
4. **Самое дорогое у нас — площадь, умноженная на число примитивов.** Сейчас область фильтра в 2,8 раза больше самой шапки (`x=-0.2 width=1.4`, `y=-0.5 height=2`), а в цепочке ~17 примитивов. Без потери вида это можно урезать в 3–6 раз (раздел 3).
5. **Над картинкой и видео лучше всего подходит WebGL.** Текстура грузится один раз, кадр стоит копейки на GPU, одинаково во всех движках. SVG-цепочку стоит оставить как запасной путь и для стекла над живым DOM.
6. **Во время быстрой прокрутки эффект ставим на паузу:** матовое `backdrop-filter` идёт на GPU, жидкое возвращаем по `scrollend` (Safari 26.2+).
7. **Замер:** свой rAF-зонд (p50/p95/p99 и худший кадр, доля пропущенных кадров, отставание стекла от прокрутки) во всех браузерах. К нему Web Inspector → Timelines → Rendering Frames и Memory в Safari и на iPhone по кабелю, а в Chrome ещё LoAF и трассировка. Раздел 6.

---

## 1. Где фильтры считаются на CPU, а где на GPU (по движкам)

| Что | Safari / WebKit (macOS, iOS) | Chrome / Chromium | Firefox / Gecko |
|---|---|---|---|
| `filter: blur() brightness() saturate()…` (CSS-функции) на композитном слое | GPU: Core Animation `CAFilter`. Список функций в `PlatformCAFiltersCocoa.mm`: blur, drop-shadow, grayscale, sepia, saturate, hue-rotate, invert, opacity, brightness, contrast **[исходники]** | GPU (cc/viz) | GPU (WebRender) |
| То же на некомпозитном элементе | Рисуется через CoreGraphics (`GraphicsContextFilters`, включено) или программно **[исходники]** | GPU-растр | GPU |
| `backdrop-filter: blur() saturate()` | GPU (CABackdropLayer), дёшево **[источник: практика, Apple]** | GPU | GPU |
| `backdrop-filter: url(#svg)` | **Не поддерживается** **[проверено в Safari]** | Есть, GPU | Нет |
| `filter: url(#svg)` на HTML: feGaussianBlur, feColorMatrix, feComposite, feOffset, feFlood, feMerge | **CPU** (Software applier). Core Image есть в коде, но выключен по умолчанию **[исходники]** | GPU (Skia image filters) **[источник]** | GPU с 132 **[источник]** |
| feDisplacementMap, feConvolveMatrix, feTurbulence, feImage | **CPU** **[исходники]** (feImage с картой в Safari вообще не работает **[проверено в Safari]**) | GPU (Skia) **[источник]** | **CPU** (вне списка WebRender) **[источник]** |
| `<video>` под SVG-фильтром | Safari не применяет SVG-фильтр к живому `<video>` **[источник: Aave]**, **[не проверено в Safari 27]** | Работает | Работает |
| WebGL / WebGPU | GPU. WebGPU есть с Safari 26 (macOS/iOS) **[источник]** | GPU | GPU |

Что ещё видно в исходниках WebKit (`RenderLayerFilters.cpp`, `ImageBuffer.cpp`, `Filter.cpp`):
- **Пересборка цепочки.** Если меняется опорный прямоугольник (размер элемента) или масштаб, фильтр собирается заново (`CSSFilterRenderer::create`, там же FIXME «rebuilds the entire effects chain even if the filter style didn't change»). Значит, менять размер стекла на каждом кадре дорого вдвойне.
- **Область перерисовки.** Для фильтра, двигающего пиксели: `m_repaintRect = filterRegion` после обновления буфера, иначе `dirtyRect ∪ layerRepaintRect ∩ filterRegion`. Копия под стеклом сдвинулась — грязной становится вся область.
- **Предел площади.** Буфер фильтра ограничен `MaxClampedLength = 4096`, `MaxClampedArea = 4096²` в пикселях устройства. Больше — WebKit уменьшает масштаб фильтра (`clampFilterRegionIfNeeded`). Отсюда «Safari ограничивает размер исходной картинки», о чём пишут Aave и Outpace, и пустота при копии всей страницы.
- **Цветовое пространство.** Для SVG-фильтров по умолчанию `linearRGB`: на входе и на выходе каждого прохода sRGB↔linear, это лишняя работа на каждом пикселе. Отключить её (`color-interpolation-filters="sRGB"`) в Safari нельзя: элемент рисуется пустым **[проверено в Safari]**.

**Вывод.** В Safari и Firefox цена SVG-стекла ≈ (пиксели области фильтра в пикселях устройства) × (число проходов) × (кадры, на которых что-то сдвинулось). Все приёмы ниже уменьшают один из этих трёх множителей.

---

## 2. Цена копии DOM, композитинг и `will-change`

**Копия DOM.** Копия всей страницы под стеклом удваивает стиль, раскладку и отрисовку того, что копируется. В Safari она ещё и упирается в предел 4096² и не повторяет sticky и анимации (от неё уже отказались). Копия одной `<img>` почти бесплатна: декодированная картинка общая для оригинала и копии, если `src` одинаковый **[не проверено в Safari]**. Дорого другое: каждая копия **внутри фильтра** увеличивает работу фильтра. Сейчас в линзе две копии (прямая и зеркальная `scaleY(-1)`), а во время смены слайда — четыре.

**Композитинг.** Слой стоит w × h × dpr² × 4 байта. На iPhone (dpr 3) полноэкранный слой 393×852 — это 1179×2556×4 ≈ **12 МБ**. Слои создают 3D-transform, `will-change`, canvas, video, fixed и sticky, а также соседи, которые на них налезают («каскад перекрытий»). Из-за этого известны вылеты WebContent на iOS по памяти **[источник: Ash Kyd, Ionic, Apple Forums]**.

**`will-change` и стекло.** Внутри элемента с SVG-фильтром нельзя `translate3d` и `will-change`: потомок уходит в свой слой, и фильтр его не видит **[проверено в Safari]**. В `page.css` осталось `.glass-page { will-change: transform; }` от старой схемы с копией страницы. Если `.glass-page` вернётся внутрь линзы, будет та же поломка: правило надо убрать. Сам элемент с фильтром (`.glass-lens`) можно вынести в слой, и тогда его `opacity` анимирует GPU без пересчёта фильтра **[не проверено в Safari]**.

**Смена слайда.** Сейчас новый слой копии плавно проявляется **внутри** линзы (`.glass-layer { transition: opacity 900ms }`). Каждый кадр перехода меняет содержимое под фильтром, и за 900 мс выходит ~54 полных пересчёта на CPU. Отсюда «небольшой пролаг при смене слайда». Лучше держать две линзы, каждую со своей статичной картинкой, и анимировать `opacity` самих линз: фильтр посчитается по разу на каждую **[не проверено в Safari]**. Ещё лучше в WebGL: смешивать две текстуры одним uniform.

**Текст первого экрана.** `.hero__panel .swap` анимирует `filter: blur(4px)` вместе с opacity. Если элемент не композитный, Safari размывает его через CoreGraphics на каждом кадре. Это дёшево, но совпадает по времени с пересчётом стекла. Можно оставить только opacity и translate или вынести `.swap` в слой на время перехода.

---

## 3. Масштаб области фильтра: как урезать работу SVG-пути в 3–6 раз

Оценка для шапки на Mac: капсула ~1100×60 CSS-px, dpr 2.

| Вариант | Область (CSS-px) | Пикселей устройства | Примитивов | Относит. работа |
|---|---|---|---|---|
| Сейчас: `x=-0.2 w=1.4`, `y=-0.5 h=2`, 3 канала аберрации | 1540×120 | ~739 тыс. | ~17 | 100 % |
| Поля только под кромку: ±(3·rim) ≈ ±14 px по обеим осям | 1128×88 | ~397 тыс. | ~17 | ~54 % |
| + один проход смещения в Safari (без аберрации, как у Outpace) | 1128×88 | ~397 тыс. | ~10 | ~32 % |
| + готовая карта изгиба вместо blur+Собеля (см. ниже) | 1128×88 | ~397 тыс. | ~4 | ~13 % |

Как это сделать:
1. **Поля области фильтра считать в JS от размера элемента**, а не брать «на глаз» 20 % и 50 %. Безопасный отступ — около 3σ размытия маски: `pad = 3·rim + |bend|·k`. Перевести в доли (`x = -pad/w`, `width = 1 + 2·pad/w`) и пересобирать фильтр с новым id при изменении размера. Сейчас по X лишние ~200 px с каждой стороны. Это всё прямые края, где по смыслу изгиба почти нет.
2. **Аберрацию в Safari и Firefox (CPU) выключать или делать дешевле.** Outpace так и делает: в Safari один проход смещения, «тот же купол и блик» **[источник]**. В Chrome (GPU) три прохода можно оставить.
3. **Карта изгиба без `feImage`** **[гипотеза, не проверено в Safari]**. Карта зависит только от формы, но сейчас её строят заново на каждом кадре (colorMatrix → blur → 2× convolve → 2× colorMatrix → composite, 7 проходов). `feImage` в Safari не работает. Обходной путь: положить заранее посчитанную карту (PNG или canvas с R/G-смещениями) **внутрь самой линзы** рядом с копией, за видимой частью области фильтра. Достать её из `SourceGraphic` через `feOffset` и обрезку `feComposite`, а копию отделить так же. feOffset и feComposite в Safari работают **[проверено в Safari]**. Сочетание с выносом за край надо проверить на настоящем Safari. Дополнительный плюс: карту можно рисовать честно (SDF скругления, профиль купола, как у Apple), а не из Собеля по размытию.
4. **Понизить разрешение фильтра** **[гипотеза, не проверено ни в одном движке]**. Сделать линзу вдвое меньше и растянуть родителю `transform: scale(2)` (2D, не 3D). Если движок считает фильтр в локальных координатах при device scale, работа уменьшится в 4 раза ценой мягкости, которая стеклу и так нужна (`soft 1.3`). В WebKit масштаб фильтра задаёт `m_filterScale` у RenderLayer, поэтому эффект нужно замерить, а не предполагать.
5. **Не фильтровать середину.** Преломление заметно только у кромки. Середину можно закрыть обычным `backdrop-filter: blur()` (GPU), а SVG-фильтр оставить только на «кольце» шириной ~rim·3. Для шапки высотой 60 px кольцо — почти вся площадь, выигрыш мал. Для больших карточек и кнопок над видео он заметен.

---

## 4. Частота перерисовки при прокрутке

Что происходит сейчас (`glass.js`): `scroll` → rAF → `getBoundingClientRect()` ×2–3 → новый `transform` у копий → пересчёт фильтра на CPU, на каждом кадре.

Две разные проблемы:
- **Стоимость кадра.** Пересчёт фильтра на CPU, раздел 3. Замер владелец сайтаа в Safari: средний 60 fps, худший кадр 33 мс **[проверено в Safari]**.
- **Отставание от прокрутки** («не успевает»). В Safari, Chrome и Firefox прокрутка асинхронная: её двигает поток композитора, а JS узнаёт о новом положении с опозданием. Копия, которую сдвигает JS, отстаёт от реальной картинки на кадр, при нагрузке на 2–3. Фиксированная шапка при этом стоит на месте (её держит композитор), поэтому рассинхрон заметен **[общая архитектура браузеров; величину в Safari не мерили]**.

Что помогает:
1. **Пауза эффекта во время быстрой прокрутки** (ниже, раздел 5.4). Снимает и стоимость, и отставание.
2. **Не читать раскладку на каждом кадре.** Положение `fig` относительно документа и высоту шапки посчитать один раз (и по `ResizeObserver`), а в кадре брать только `scrollY`. Тогда кадр не дёргает layout, а положение копии = константа − scrollY.
3. **Режим «без отставания» для DOM-копии** **[не проверено в Safari]**. Двигать копию CSS-анимацией по шкале прокрутки (`animation-timeline: scroll()`, Safari 26+, в 26.4 появились анимации в потоке композитора **[источник]**). Копия поедет синхронно с прокруткой. Но в Safari это **не сделает фильтр дешевле**: фильтр всё равно пересчитается на CPU. Выигрыш только в синхронности, и только если CPU успевает.
4. **Дискретизировать частоту.** В Safari по умолчанию rAF около 60 Гц даже на ProMotion (флаг «Prefer Page Rendering Updates near 60fps») **[источник]**. Заметное преломление при прокрутке можно обновлять через кадр (30 Гц), а между обновлениями держать копию на месте. При бликах и размытии разница почти не видна, а нагрузка падает вдвое. Это компромисс, выбирать по замеру.
5. **Не делать работу, когда стекла не видно.** Сейчас `update()` идёт на каждой прокрутке всей страницы. Хватит `IntersectionObserver` (раздел 5.5).

---

## 5. Приёмы

### 5.1 Уменьшенная копия фона
- **Для SVG-пути** это почти ничего не даёт. Работа фильтра считается в пикселях устройства **области фильтра**, а не исходной картинки: копия 600 px, растянутая на 1100, стоит фильтру столько же. Выигрыш только в декодировании и памяти. Чтобы уменьшить работу фильтра, нужно уменьшать **разрешение самой линзы** (3.4).
- **Для WebGL** уменьшенная копия даёт много. Текстуру можно брать вдвое-вчетверо меньше (или mip-уровень): размытие стекла всё равно съест детали. Шейдер с mipmap'ами получает размытие почти даром: `textureLod` в WebGL2 или bias в WebGL1.
- **Для iPhone** брать для текстуры отдельную маленькую webp (например, 512–768 px по ширине), а не `currentSrc` героя на 2400 px. Экономия памяти GPU: 2400×1600×4 ≈ 15 МБ против 768×512×4 ≈ 1,5 МБ (плюс ~33 % на mipmaps).

### 5.2 Кэш статичного фона
- **Когда ничего не движется, Safari уже кэширует.** Результат фильтра лежит в бэкинге слоя, пока слой не испачкан (поэтому для пересборки нужен новый id **[проверено в Safari]**). Цель — меньше кадров, где под стеклом что-то меняется.
- **Карта изгиба зависит только от формы**, её надо считать один раз (3.3). Aave делают так же: пересчитывают карту только при изменении формы и считают одну четверть с зеркалированием **[источник]**.
- **В WebGL кэш естественный.** Текстура слайда грузится один раз (`texImage2D` при `load`), при смене слайда держим две текстуры и смешиваем. Карту изгиба можно считать прямо в шейдере аналитически по SDF скруглённого прямоугольника, тогда она вовсе не хранится.

### 5.3 Стекло только над медиа (img/video) и WebGL-шейдер
Почему WebGL лучше SVG над картинкой:
- Работа на кадре — один quad размера капсулы: SDF кромки, 1–3 выборки с разным смещением (аберрация), размытие через mip. Для 1100×60 при dpr 2 это ~260 тыс. пикселей на GPU, доли миллисекунды **[оценка, не мерили]**. CPU только ставит uniform со сдвигом.
- Одинаково в Safari, Chrome и Firefox: не зависит от того, какой примитив SVG где ускорен.
- Над `<video>` это **единственный** путь в Safari (SVG-фильтр к живому видео не применяется **[источник]**). Aave так и делают для видеоплеера.

Чего стоит и где грабли:
- **Видео.** Кадр видео надо загружать в текстуру. Загружать только на новом кадре через `requestVideoFrameCallback` (есть в Safari 15.4+ и Chrome; в Firefox — с 132), а не на каждом rAF **[источник]**. У Safari долгая история медленного `texImage2D(video)`, с регрессиями в iOS 15.4 и ×20 замедлением **[источник: WebKit bugs]**: мерить на реальном iPhone обязательно. В WebGPU есть `importExternalTexture` (без копии), но у Safari там баги с 10-битным видео и поворотом **[источник]**. Для кнопок ▶ можно не брать живое видео, а брать постер или кадр, сохранённый раз в N кадров в маленький canvas.
- **Лимит контекстов.** В Chrome и Safari около 16 активных WebGL-контекстов на страницу, лишние теряют старые **[источник]**. Для 1 шапки + 3–5 кнопок можно отдельные canvas, но правильнее **один** контекст на всё стекло страницы: рисовать в скрытый canvas и раздавать результат через `transferToImageBitmap` или `drawImage` в маленькие canvas, либо один `position: fixed` canvas поверх (на iPhone это ~12 МБ слоя, см. 5.6).
- **Потеря контекста.** Обработать `webglcontextlost` и `webglcontextrestored`: при потере откатываться на матовое стекло.
- **CORS.** Картинки и видео с того же домена, проблем нет. С чужого — `crossorigin`, иначе текстура «грязная».
- **Отставание от прокрутки** то же, что у DOM-копии (рисуем по `scrollY` в rAF), но кадр дешёвый и не пропадает.
- **Над текстом и живым DOM** WebGL не помогает: DOM в текстуру штатно не попадает. Для такого стекла остаётся SVG-путь или матовое `backdrop-filter`. HTML-in-Canvas (рисование DOM в canvas) пока экспериментальный и не во всех движках: не рассчитывать **[не проверено в Safari]**.
- **Вес.** Свой шейдер на чистом WebGL1/2 — это 3–6 КБ JS, библиотека не нужна. three.js (~150 КБ min+gz) ради одного quad'а избыточен.

### 5.4 Пауза эффекта во время быстрой прокрутки
- В обработчике `scroll` (passive) считать скорость |ΔscrollY|/Δt. Выше порога (подобрать, например 1200–2000 px/с) или при любой прокрутке на CPU-движках → класс `is-fast`: жидкая линза `opacity: 0`, включается матовое `backdrop-filter: blur(20px) saturate(1.8)` (GPU).
- Возврат — по событию `scrollend` (Safari 26.2+, Chrome 114+, Firefox 109+) **[источник]**. Запасной вариант — таймер 120–150 мс без `scroll`. Переход 150–250 мс по opacity самой линзы, не того, что внутри.
- Глаз при быстрой прокрутке преломление всё равно не разглядит, а матовое стекло прокрутку не тормозит. Для WebGL пауза не обязательна, но можно снижать число выборок.
- При «Уменьшить движение» переход мгновенный, при «Уменьшить прозрачность» стекла нет совсем (уже так).

### 5.5 IntersectionObserver
- Наблюдать героя (`fig`) с `rootMargin: "-${высота шапки}px 0px 0px 0px"`: как только фото ушло из-под шапки, жидкое стекло выключается целиком (линза `hidden`, rAF-цикл и слушатель прокрутки сняты). Сейчас `update()` с `getBoundingClientRect()` крутится на любой прокрутке страницы.
- Для кнопок ▶ и подписей: стекло (и WebGL-цикл, `requestVideoFrameCallback`) запускать, только пока элемент в зоне видимости с запасом `rootMargin: "200px"`.
- `document.visibilityState === 'hidden'` → остановить всё.
- Ленивая инициализация: шейдер и текстуры создавать при первом входе в зону видимости, а не на загрузке (Ash Kyd так лечил вылеты Safari **[источник]**).

### 5.6 Ограничения памяти iOS
- Предел памяти процесса WebContent не документирован, зависит от модели и версии iOS. При превышении — «A problem repeatedly occurred», jetsam highwater **[источник]**.
- Общий предел памяти canvas в iOS Safari — ~224–384 МБ в зависимости от версии и устройства. При превышении `getContext` возвращает `null` **[источник]**. Canvas без ссылок освобождаются не сразу; помогает явное `canvas.width = canvas.height = 0`.
- Прикидка для iPhone (dpr 3), шапка 361×56 CSS-px:
  - слой canvas/линзы: 1083×168×4 ≈ 0,7 МБ (×2–3 буфера у WebGL) — мелочь;
  - SVG-фильтр со старой областью 1.4×2: 505×112 CSS → 1515×336 ≈ 0,5 млн пикселей ≈ 2 МБ на каждый промежуточный результат, ×~17 = до ~35 МБ временных буферов **на каждом кадре** **[оценка по коду, не мерили]**;
  - декодированное фото героя 2400×1600 ≈ 15 МБ, плюс копии слайдов, которые держат декодированными.
- Правила: не плодить слои (`will-change` только точечно и временно), полноэкранный fixed canvas — только один, текстуры маленькие, неактивные слайды не держать декодированными, `visibility: hidden` вместо `opacity: 0` для спрятанных слоёв.

### 5.7 Что делать по платформам (предложение)
| Платформа | Шапка над фото | Кнопки ▶ над видео | Стекло над DOM |
|---|---|---|---|
| Chrome / Edge (десктоп, Android) | WebGL. SVG-цепочка на GPU тоже годится как запасной путь | WebGL + rVFC | SVG `filter`/`backdrop-filter: url()` (GPU) |
| Safari macOS | WebGL. SVG — урезанная цепочка (раздел 3) с паузой при прокрутке | WebGL + rVFC (замерить `texImage2D`) | урезанный SVG или матовое |
| Safari iOS | WebGL с маленькой текстурой, 60 Гц; при `webglcontextlost` — матовое | постер/кадр в canvas, без живого видео | матовое |
| Firefox | WebGL (displacement в Firefox на CPU) | WebGL + rVFC | урезанный SVG или матовое |
| Без WebGL / «Уменьшить прозрачность» | матовое `backdrop-filter` или сплошной фон | сплошная плашка | сплошной фон |

---

## 6. Методика замера

### 6.1 Что меряем
- **Интервалы кадров** по rAF во время прокрутки: p50, p95, p99, **худший кадр**. Доля кадров длиннее 1,5 × период обновления (пропущенные), число кадров > 50 мс.
- **Долгие задачи главного потока:** Chrome — `PerformanceObserver` с `long-animation-frame` (LoAF, Chrome 123+) и `longtask`. В Safari и Firefox нет ни того ни другого **[источник]**, поэтому там сам зонд считает время работы внутри rAF и интервалы.
- **Отставание стекла:** в каждом кадре — разница между `scrollY`, по которому поставлена копия, и `scrollY` на момент следующего rAF (в пикселях). Плюс визуально: запись экрана 120/240 fps (QuickTime на Mac, запись экрана или замедленная съёмка вторым телефоном на iPhone).
- **Память:** Safari Web Inspector → Timelines → Memory (по кабелю для iPhone) и вкладка Layers (число слоёв, их память). В Chrome — `performance.measureUserAgentSpecificMemory()` или вкладка Memory, Layers.
- **Стоимость смены слайда:** то же, но окно 1,5 с вокруг события `slide`.

### 6.2 Зонд (вставлять в страницу через `?perf=1`, один файл без зависимостей)
```js
// perf-probe: интервалы кадров + работа в rAF + отставание стекла, итог в console.table
(() => {
  const iv = [], work = [], lag = [];
  let last = performance.now(), lastY = scrollY, run = true;
  const tick = (t) => {
    const s = performance.now();
    iv.push(t - last); last = t;
    lag.push(Math.abs(scrollY - (window.__glassY ?? scrollY))); // __glassY ставит glass.js при place()
    lastY = scrollY;
    work.push(performance.now() - s);
    if (run) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const q = (a, p) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };
  window.perfStop = () => {
    run = false; const a = iv.slice(5); // первые кадры отбросить
    const hz = 1000 / q(a, 0.5);
    console.table({ кадров: a.length, p50: q(a, .5), p95: q(a, .95), p99: q(a, .99), худший: Math.max(...a),
      пропущено: a.filter(x => x > 1.5 * 1000 / hz).length, 'больше 50 мс': a.filter(x => x > 50).length,
      'отставание p95, px': q(lag, .95) });
  };
})();
```

### 6.3 Сценарии прокрутки (каждый — 5 прогонов, берём медиану, отдельно худший)
1. **Скриптовая, повторяемая:** rAF-цикл `scrollBy(0, v·dt)` с постоянной скоростью 1500 px/с, вниз 3 с и обратно. Минус: такая прокрутка идёт через главный поток, а не через композитор, поэтому подходит только для сравнения вариантов между собой.
2. **Настоящая:** в Chrome — Playwright + CDP `Input.synthesizeScrollGesture` (настоящая прокрутка композитора) и трассировка (`Tracing.start` с категориями `devtools.timeline,viz,cc`). В Safari (Mac) — трекпад рукой, зонд + Timelines → Rendering Frames. На iPhone — палец, Web Inspector по кабелю (Разработка → iPhone).
3. **Смена слайда:** стоим на месте, ждём 3 смены слайда.

Важно:
- **Playwright-WebKit как доказательство для Safari не годится** **[проверено в Safari]**. Safari — только настоящий.
- Открытый Web Inspector сам добавляет нагрузку: прогоны с ним и без него не смешивать.
- В Safari rAF по умолчанию ~60 Гц даже на ProMotion (флаг «Prefer Page Rendering Updates near 60fps») **[источник]**. Записывать, какой режим был. В режиме энергосбережения iOS частота может падать до 30 Гц **[не проверено]**: мерить с выключенным энергосбережением, на зарядке, на неперегретом телефоне, после одного прогрева.
- Устройства: Mac на Apple Silicon (Safari 27, Chrome, Firefox), iPhone, по возможности старый (12–13) и новый, один Android средней руки.

### 6.4 Матрица вариантов (A/B, одна и та же страница)
1. без стекла (сплошная шапка) — нижняя планка;
2. матовое `backdrop-filter`;
3. SVG как сейчас;
4. SVG урезанный (поля под кромку + 1 проход в Safari/Firefox);
5. SVG урезанный + готовая карта (если 3.3 заработает в Safari);
6. SVG урезанный + пауза при быстрой прокрутке;
7. WebGL (статичная текстура);
8. WebGL над видео (rVFC).

### 6.5 Пороги «годится»
- **Mac Safari и Chrome:** p95 ≤ 16,7 мс, худший ≤ 25 мс, 0 кадров > 50 мс, отставание p95 ≤ 1 кадр прокрутки.
- **iPhone:** p95 ≤ 17 мс при 60 Гц, худший ≤ 33 мс, без вылетов; память WebContent не растёт от прогона к прогону.
- **Смена слайда:** ни одного кадра > 33 мс.
- Если вариант не проходит порог на платформе, там ставим матовое. Это и есть «аккуратная деградация».

---

## 7. Источники

Исходники WebKit (ветка `main`, прочитаны 30.10.2026):
- Настройка `AcceleratedFiltersEnabled` (unstable, false) и `GraphicsContextFiltersEnabled` (true): https://github.com/WebKit/WebKit/blob/main/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml
- `Page::preferredFilterRenderingModes`: https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/Page.cpp
- Область перерисовки и пересборка фильтра: https://github.com/WebKit/WebKit/blob/main/Source/WebCore/rendering/RenderLayerFilters.cpp
- Предел 4096²: https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/graphics/ImageBuffer.cpp
- Какие CSS-фильтры идут в Core Animation: https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/graphics/ca/cocoa/PlatformCAFiltersCocoa.mm
- Программные и Core Image «исполнители»: https://github.com/WebKit/WebKit/tree/main/Source/WebCore/platform/graphics/filters/software , https://github.com/WebKit/WebKit/tree/main/Source/WebCore/platform/graphics/coreimage
- PR, где сказано, что ускоренные фильтры «включены по умолчанию». Противоречит настройке выше: скорее всего, речь о сборках с включённым флагом. Перепроверить в Safari 27 через Разработка → Feature Flags → «Accelerated Filter Rendering»: https://github.com/WebKit/WebKit/pull/68613
- Баги WebKit про Core Image-фильтры: https://bugs.webkit.org/show_bug.cgi?id=213672 , https://bugs.webkit.org/show_bug.cgi?id=245510

Другие движки:
- Firefox 132: WebRender ускоряет 9 примитивов: https://bugzilla.mozilla.org/show_bug.cgi?id=1906212
- USENIX Security 2024, таблица примитивов без GPU в Firefox: https://www.usenix.org/system/files/usenixsecurity24-oconnell.pdf
- Chromium, фильтры (документ старый): https://www.chromium.org/developers/design-documents/image-filters/

Веб-реализации стекла:
- Aave, «Building Glass for the Web» (стоимость по площади, карта по четверти, WebGL для видео, предел Safari): https://aave.com/design/building-glass-for-the-web
- Outpace Studios (Chromium на GPU, Safari на CPU, один проход в Safari): https://glass.outpacestudios.com/

Прокрутка, частота, замеры:
- `scrollend` в Safari 26.2: https://www.infoq.com/news/2026/04/safari-scrollend-support
- Scroll-driven animations в Safari 26: https://webkit.org/blog/17333/webkit-features-in-safari-26-0/ , https://webkit.org/blog/17101/a-guide-to-scroll-driven-animations-with-just-css/ , https://webkit.org/blog/17938/webkit-features-for-safari-26-5/
- 60 Гц по умолчанию в Safari: https://www.macrumors.com/how-to/enable-smoother-120hz-browsing-in-safari/ , https://github.com/accreleus/quasar/issues/632
- Long Animation Frames (только Chromium): https://developer.chrome.com/docs/web-platform/long-animation-frames , https://caniuse.com/wf-long-animation-frames

WebGL, видео, память:
- `requestVideoFrameCallback`: https://web.dev/articles/requestvideoframecallback-rvfc
- Медленный `texImage2D(video)` в Safari: https://bugs.webkit.org/show_bug.cgi?id=129626 , https://bugs.webkit.org/show_bug.cgi?id=236699 , https://bugs.webkit.org/show_bug.cgi?id=231031
- WebGPU во всех браузерах, Safari 26: https://web.dev/blog/webgpu-supported-major-browsers
- Внешние текстуры WebGPU и баги Safari: https://webgpufundamentals.org/webgpu/lessons/webgpu-textures-external-video.html , https://github.com/Silo-Server/silo-server/pull/2544
- Лимит 16 WebGL-контекстов: https://developer.chrome.com/docs/web-platform/webgpu/from-webgl-to-webgpu , https://groups.google.com/a/chromium.org/g/graphics-dev/c/fmNedEEAYpA
- Предел памяти canvas в iOS: https://pqina.nl/blog/total-canvas-memory-use-exceeds-the-maximum-limit/ , https://developer.apple.com/forums/thread/687866
- Слои и вылеты Safari по памяти: https://ashk.au/2024/02/07/dev-log-debugging-safari-an-ogre-with-layers/ , https://github.com/ionic-team/ionic-framework/issues/28660 , https://developer.apple.com/forums/thread/678318
- `content-visibility` в Safari (полностью с 26.0): https://caniuse.com/mdn-css_properties_content-visibility_auto
