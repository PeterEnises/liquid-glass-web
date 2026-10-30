# Веб-реализации «жидкого стекла»: обзор

Дата: 30.10.2026. Исходники библиотек склонированы и прочитаны (shallow clone, последний коммит указан).
Пометка **[не проверено в Safari]** означает, что утверждение взято у автора или из Playwright и в настоящем Safari 27 мы его не проверяли.

## Коротко

Все известные реализации делятся на пять приёмов:

| Приём | Как получают картинку за стеклом | Где работает преломление | Примеры |
|---|---|---|---|
| A. `backdrop-filter: url(#svg)` | браузер сам отдаёт фон | только Chromium | kube.io, shuding, rizroze, kwlck, большинство CodePen |
| B. `filter: url(#svg)` **на контенте или его копии** | преломляют сам контент или выровненную копию фона | Chromium, Safari, Firefox | Aave, Outpace, PallavAg, Amir-Abushanab, gentpan/tfdmendes (liquidglass.dev), lore-glass, glass-of-web, **наш glass.js** |
| C. WebGL/WebGPU + снимок DOM | растеризация DOM в текстуру (html2canvas, html-to-image/foreignObject, свой растеризатор) | везде, где есть WebGL, но снимок статичный | liquidGL, ybouane, dashersw |
| D. WebGL по `<img>/<canvas>/<video>` | `drawImage`/текстура из медиа | везде | Aave (видео, QR), Amir (`/webgl`), lore-glass (авто на Safari), Codrops/three.js |
| E. HTML-in-Canvas | `drawElementImage()` / текстура из живого DOM | только Chromium за флагом | html-in-canvas.dev, jeantimex |
| (F) `-moz-element()` | живое изображение элемента | только Firefox | Amir-Abushanab (путь `behind`) |

Для сайт-пример (статика, Safari важен, шапка над фото) реально подходит только приём **B**, а для видео или canvas — **D**. Наша схема уже относится к B. Отличие в том, что лучшие библиотеки строят карту смещения **картинкой** (canvas → PNG → `feImage`), а мы собираем её внутри фильтра через Собеля.

## Главная находка: почему у нас «не работало» в Safari

В CONTEXT.md записано, что в Safari 27 элемент рисуется пустым при `feImage` (и с `data:`, и с `blob:`), при `color-interpolation-filters="sRGB"` и при `userSpaceOnUse`. Но несколько свежих библиотек утверждают, что всё это работает в Safari, если обойти три бага WebKit. Каждый из них даёт ровно такой симптом:

1. **`feImage` с `data:` грузится асинхронно, и WebKit кэширует пустой результат фильтра** до смены id. Обход из tfdmendes/liquidglass (`lib/liquid-glass.js`): сначала декодировать PNG через `<img>` (`img.decode()`), только потом ставить `href`; после подмены карты ещё дважды переназначить id фильтра, через 60 и 250 мс («WebKit loads its own copy of the data URL and does not repaint the filter when that load lands»). Сайт liquidglass.dev пишет, что проверял именно на Safari 27 **[не проверено в Safari]**.
2. **`userSpaceOnUse` у HTML-элемента WebKit считает от начала страницы, а не от элемента.** Подробный разбор с замерами есть в Amir-Abushanab/liquid-glass-js, `packages/core/src/filter-origin.ts`: подобласть `feImage` уезжает туда, где элемент лежит на странице, и цепочка с `operator="in"` обрезает всё в пустоту. Обход: дать отфильтрованному элементу любое свойство семейства transform, например `rotate: 0deg` (2D, без композитного слоя). `perspective` не помогает **[не проверено в Safari]**. У PallavAg другой путь: на iOS он, наоборот, переходит на `userSpaceOnUse`, потому что «iOS WebKit misplaces filter primitive subregions expressed in objectBoundingBox units».
3. **Кэш по id фильтра.** Мы это уже знаем, и все пишут то же самое.

Плюс две общие ловушки:
- `color-interpolation-filters="sRGB"` нужен **обязательно**, если карта — картинка. Иначе в linearRGB нейтральный серый 128 перестаёт быть нулём и появляется постоянный сдвиг. Все библиотеки с `feImage` его ставят. Возможно, наш провал с sRGB — следствие пунктов 1–2, а не самого sRGB.
- Outpace пишет обратное нашему: «WebKit refuses `data:` in feImage» и поэтому берёт `blob:`. У tfdmendes и PallavAg `data:` работает. Противоречие, скорее всего, тоже объясняется пунктом 1.

**Что сделать первым делом:** A/B-страница в настоящем Safari: `feImage` + `data:` + `img.decode()` + обновление id через 60/250 мс + `rotate: 0deg` на элементе + sRGB. Если это заработает, карту можно строить один раз в canvas (честный профиль squircle по Снеллиусу, блик в синем канале), а фильтр становится короче: без feConvolveMatrix и без двух размытий. Тогда Safari считает меньше на каждом кадре.

## Подробно по каждой реализации

### 1. Aave Labs — «Building Glass for the Web» (июнь 2026)
- Ссылка: https://aave.com/design/building-glass-for-the-web ; анонс: https://x.com/aave/status/2062999708738441624
- **Приём B:** «Nothing is sampled from underneath the glass». Фильтр бьёт по собственным пикселям контента, текст остаётся выделяемым.
- **Карта:** маленький PNG, генерируется под форму. R/G — смещение X/Y, вне линзы нейтраль. Считают только верхний левый квадрант и зеркалят с инверсией знака (в 4 раза быстрее). Карту пересчитывают только при смене **формы**. При движении сдвигают лишь область фильтра (x/y примитивов).
- **Цепочка:** `feDisplacementMap` + отдельные проходы цветной каймы (Chroma) и блика. В Safari блик считают только по области линзы (дешевле), в Chromium по всей области (иначе мерцает край).
- **Safari:** кэш по id → новый id. Есть потолок размера SourceGraphic: при превышении эффект разваливается на блоки или пропадает, поэтому преломляемый DOM держат маленьким. На живой `<video>` Safari SVG-фильтр не накладывает, поэтому видео идёт через WebGL с той же картой.
- **Поддержка (по словам авторов):** Chromium, Safari, Firefox, десктоп и мобильные, без флагов.
- **Лицензия:** код не опубликован. Его реконструировали glass-of-web и PallavAg.

### 2. Outpace Studios — https://glass.outpacestudios.com
- **Приём B с копией фона:** фон отрисован второй раз (`GlassScene`), а `GlassLens` кладёт внутрь линзы противоположно сдвинутую копию и искажает её. Живой интерфейс не фильтруется. Это ровно наша схема.
- **Карта:** выпуклый squircle-купол, Снеллиус с n = 1,5, поле высот по SDF формы, смещение = градиент (нет заломов в углах). Профиль ограничен, чтобы кромка сжимала фон, а не заворачивала. B-канал — направленный блик кромки.
- **По браузерам:** Chromium — 3 прохода смещения (аберрация) + блик, фильтры на GPU. **Safari — один проход смещения + блик, без цветного расщепления**: «Safari runs SVG filters in software», а постоянно сдвигающаяся копия делает второй проход слишком дорогим. Это совпадает с нашим замером «лагает шапка».
- Карта идёт через `blob:` (по их словам, WebKit отвергает `data:`). Стоит sRGB, новый id при пересборке, копия обрезана по линзе из-за потолка размера в Safari.
- Учитывают «Уменьшить движение» (прыжок вместо анимации) и «Уменьшить прозрачность» (вместо стекла непрозрачная панель).
- **Лицензия:** не указана, репозитория нет.

### 3. kube.io — «Liquid Glass in the Browser: Refraction with CSS and SVG»
- Ссылка: https://kube.io/blog/liquid-glass-css-svg
- **Приём A (`backdrop-filter: url()`), интерактив только в Chrome.** Safari и Firefox видят статичные демо на обычном `filter`.
- Самый понятный разбор оптики: Снеллиус (n₁ = 1, n₂ = 1,5), функция высоты кромки, четыре профиля (выпуклая окружность, **выпуклый squircle — лучший**, вогнутый, «губа»). Смещение считают по одному радиусу (127 лучей) и вращают. Нормировка на максимум, `scale` = максимальное смещение в px; анимировать `scale` дёшево, а размер или форма требуют пересборки карты.
- 8-битные каналы дают предел примерно ±128 px. Вогнутые профили берут пиксели за краем элемента, их лучше избегать.
- Блик — отдельный `feImage`, накладывается через `feBlend`. Карты должны совпадать с размером элемента, сами они не тянутся.
- **Лицензия:** код не выложен («experimental»).

### 4. PallavAg/liquid-glass-web-react (MIT, ~5 kB gz, коммит 2026-06-10)
- https://github.com/PallavAg/liquid-glass-web-react , npm `liquid-glass-web-react`. Есть ванильный `LiquidGlassEngine`.
- **Приём B**, вдохновлён Aave. Прочитан `src/core/engine.ts`:
  `feFlood(128) → feImage(карта, только в подобласти линзы) → over`; 3× `feDisplacementMap` (масштабы s·(1+0,2c), s·(1+0,1c), s) → `feColorMatrix` выделяет по каналу → сложение `arithmetic`; блик из B-канала карты; альфа карты = точная форма линзы; в исходнике линза вырезается (`out`), результат вклеивается (`over`).
- Все примитивы ограничены подобластью линзы (атрибут `data-lens`), поэтому цена фильтра зависит от размера линзы, а не контейнера.
- Хитрости: `objectBoundingBox` везде, кроме iOS (там `userSpaceOnUse` + пересчёт `scale`). В oBB-единицах браузер переводит `scale` в px как s·√(W²+H²)/√2. Новый id только на Safari, в остальных браузерах атрибуты меняются на месте. Предупреждение, если W·H > 2,5 Мп (потолок Safari). Карта — `canvas.toDataURL()`, квадрантная симметрия.

### 5. Amir-Abushanab/liquid-glass-js (`@liquidglassjs/core`, MIT, коммит 2026-10-28) — самая продуманная
- https://github.com/Amir-Abushanab/liquid-glass-js , витрина https://amir-abushanab.github.io/liquid-glass-js/
- Автовыбор пути: (1) `refract` → SVG-фильтр по живому DOM; (2) `<canvas>/<video>/<img>` + WebGL2 → WebGL (лениво подгружается); (3) `behind` → в Firefox фон = `-moz-element()` от живого элемента; (4) CSS-фон → фильтр по копии с `background-attachment: fixed`; (5) иначе матовый `backdrop-filter`.
- Прочитаны `mount.ts`, `filter-origin.ts`, `mount-alpha-glass.ts`. Много выстраданных граблей, все с комментариями:
  - баг начала координат `userSpaceOnUse` в WebKit и обход через `rotate` (см. выше);
  - движок WebKit определяют по `'webkitConvertPointFromNodeToPage' in window`, потому что UA может врать;
  - рамку `objectBoundingBox` браузеры считают по-разному (ink bbox: 272×100 против 270×99), поэтому точную по пикселям карту задают в `userSpaceOnUse`;
  - ставят `href` и `xlink:href` для старых WebKit/Gecko;
  - в Firefox WebGL-canvas как композитный слой не обрезается скруглением, лечат `clip-path` + непрозрачной `mask-image`;
  - **слияние капель** (`mountGlassGroup`): одна карта, прямоугольники сливаются через smooth-min. Это слияние самих полей преломления, а не «gooey»-трюк по альфе;
  - элементы, которые двигаются, держат **над** фильтруемым слоем, а не внутри, поэтому transform безопасен в Safari. Это то же правило про композитного потомка, что у нас.
- Подтверждает: Safari и Firefox парсят `backdrop-filter: url()`, но ничего не рисуют.

### 6. gentpan/liquidglass → форк tfdmendes/liquidglass (MIT, коммит 2026-10-26), сайт https://liquidglass.dev
- https://github.com/gentpan/liquidglass , https://github.com/tfdmendes/liquidglass
- **Приём B.** Над фото отмечают `data-lg-backdrop="img"`, и стекло преломляет выровненную копию. Над произвольным контентом в Safari и Firefox ставят матовое стекло. Проверено скриншотами в Chrome 153, **Safari 27**, Firefox 156 (по их словам).
- Комментарии в `lib/liquid-glass.js`: «primitiveUnits=objectBoundingBox — the only units WebKit renders — userSpaceOnUse turns the whole element blank» (совпадает с нашим наблюдением). `scale` в oBB браузеры переводят по-разному (замер): Blink — x и y по ширине; **WebKit — x по ширине, y по высоте**; Gecko — по √((w²+h²)/2). Компенсируют сжатием R/G каналов карты. Обход асинхронной загрузки `data:`: `img.decode()` + обновление id через 60/250 мс. Кэш карт по форме.
- Есть веб-компоненты (`lg-button`, `lg-switch`, `lg-slider`, `lg-segmented`) поверх нативных input. Фокус, клавиатура и скринридеры работают.

### 7. anubhavaanand/glass-of-web (коммит 2026-09-29, **без лицензии**)
- https://github.com/anubhavaanand/glass-of-web — «реверс-инжиниринг» прод-DOM Aave, цепочка из 17 примитивов, `primitiveUnits="userSpaceOnUse"` + доли oBB у `feImage`, квадрантная симметрия, WebGL с несколькими линзами для видео. Полезно как справочник по параметрам Aave. **Брать код нельзя:** нет LICENSE.

### 8. Simonstorms/lore-glass (MIT, коммит 2026-06-29)
- https://github.com/Simonstorms/lore-glass — shadcn-реестр для React 19 + Tailwind 4. Приём B по живому DOM. На Safari, если внутри один растровый элемент (video/canvas/img), сам переключается на WebGL: «WebKit cannot run feDisplacementMap over live video/canvas». Для нас стек лишний, идеи полезны.

### 9. rdev/liquid-glass-react (MIT, Max Rovensky, npm `liquid-glass-react`, коммит 2025-06-13)
- https://github.com/rdev/liquid-glass-react , демо https://liquid-glass.maxrovensky.com
- Слой с `backdrop-filter: blur() saturate()`, поверх него `filter: url(#…)`: Chromium смещает уже размытый фон. Карта — готовые картинки (`standard/polar/prominent`) или сгенерированная. 3 прохода смещения + `feBlend screen`, аберрация только по маске кромки. В Firefox фильтр выключен по UA.
- README честно пишет: «Safari and Firefox only partially support the effect (displacement will not be visible)».

### 10. shuding/liquid-glass (MIT, коммит 2026-03-25)
- https://github.com/shuding/liquid-glass — сниппет для консоли. Карта в canvas по SDF скруглённого прямоугольника, `backdrop-filter: url()` + `filterUnits=userSpaceOnUse`. Только Chromium. Вирусное демо 2025 года, с него многие начинали.

### 11. rizroze/liquid-glass (MIT) и kwlck/liquid-glass-web (MIT)
- https://github.com/rizroze/liquid-glass — canvas-карта + 3 прохода `feDisplacementMap` + `backdrop-filter: url()`. Safari и Firefox получают `blur(12px)`.
- https://github.com/kwlck/liquid-glass-web — то же самое: «SVG refraction on Chromium with a CSS glass fallback elsewhere», в Safari не тестировали.

### 12. naughtyduk/liquidGL (MIT, npm `liquid-gl`, коммит 2026-10-01)
- https://github.com/naughtyduk/liquidGL
- **Приём C:** WebGPU → WebGL2 → WebGL1 → CSS `backdrop-filter`. Фон — снимок `body` своим растеризатором (раньше был html2canvas) в текстуру; динамические элементы надо регистрировать (`registerDynamic`), видео подхватывается само; синхронизация с Lenis/Locomotive.
- Только для `fixed`/`sticky` элементов. Один общий canvas на все линзы. Вес `liquidGL.js` ~292 КБ без минификации.
- Подводные камни из README: картинки нужны с CORS; длинные страницы упираются в предел размера текстуры; «Safari can be unstable when the liquid element(s) are more than 50% of the viewport»; снимок делается после загрузки, ленивые картинки и шрифты могут не попасть.

### 13. ybouane/liquidglass (MIT, npm `@ybouane/liquidglass`, коммит 2026-09-30)
- https://github.com/ybouane/liquidglass , https://liquid-glass.ybouane.com/
- **Приём C:** соседние элементы растеризуются через `html-to-image` (клон + встроенные стили + SVG `foreignObject`), `img/canvas/video` рисуются через `drawImage`; `data-dynamic` переснимается каждый кадр. Шейдер: преломление, аберрация, Френель, блик.
- Ограничения из README: стекло только прямыми детьми корня; на каждый экземпляр свой WebGL-контекст (лимит около 16); ресайз переснимает всё. Для Safari есть риск с `foreignObject` и canvas **[не проверено в Safari]**.

### 14. dashersw/liquid-glass-js (MIT, коммит 2025-06-12)
- https://github.com/dashersw/liquid-glass-js — WebGL + `html2canvas(document.body)` одним снимком на страницу. Заявлен Safari 14+, но снимок статичный: скролл и анимации за стеклом не обновляются. Устарел. Не путать с npm `liquid-glass-js` (это другой пакет).

### 15. WebGL/WebGPU без DOM (приём D)
- Codrops, «Infinite Liquid Glass Grid» (Three.js + WebGPU + TSL, 09.2026): https://tympanus.net/codrops/2026/09/08/building-an-infinite-liquid-glass-grid-with-three-js-webgpu-and-tsl/ — SDF скруглённого бокса на плоскости, дисперсия несколькими выборками с разным n по каналам. Обходятся без MeshPhysicalMaterial transmission.
- Charles Grassi, https://charlesgrassi.dev/blog/apple-liquid-glass/ — squircle n = 4, фаска `1 − smoothstep(−w, 0, sdf)`, дисперсия по градиенту SDF только в фаске, размытие на половинном разрешении, билинейные выборки (9 → 5).
- Jinkieyz/glass-optics-shader (raymarching, Френель Шлика), CodePen jhnsnc «Refraction cursor over video»: https://codepen.io/jhnsnc/details/ByoEmoq
- Glass-HQ/liquid-glass (`@glass-sdk/liquid-glass` 0.0.2, MIT): только WebGPU, HTTPS; по их же словам, в Safari есть проблемы с отрисовкой.
- **Для нас:** это путь для первого экрана, когда под шапкой лежит только фото-слайд. Слайд как текстура в WebGL (или WebGL2) — один проход на GPU в любом браузере, включая iPhone, без программных SVG-фильтров Safari. Нужно заменить `<img>` под шапкой на canvas-рендер или держать canvas только в области шапки.

### 16. HTML-in-Canvas (приём E)
- Спецификация: https://github.com/WICG/html-in-canvas — `drawElementImage()`, `captureElementImage()`, `texElementSubImage2D` (WebGL), `drawElementImageToTexture` (WebGPU), атрибут `drawable`. Только Chromium за флагом `chrome://flags/#canvas-draw-element`. Позиций Safari и Firefox нет. Кросс-доменные картинки, `:visited` и системные цвета не отдаются.
- Демо: https://html-in-canvas.dev/demos/liquid-glass/ , https://github.com/jeantimex/liquid-glass-html-in-canvas , https://github.com/jeantimex/glass-effect-webgpu (с запасным html2canvas).
- **Для нас:** пока бесполезно, Safari нет.

### 17. CodePen и мелкие демо (почти все — приём A)
- Rahul / LogRocket: https://blog.logrocket.com/how-create-liquid-glass-effects-css-and-svg/ (`backdrop-filter`)
- ljgonzalez: https://codepen.io/ljgonzalez/details/QwjZRQN (по статье ekino: https://medium.com/ekino-france/liquid-glass-in-css-and-svg-839985fcb88d — статья отдала 403, не прочитана)
- prxju: https://codepen.io/prxju/pen/vEOjMvr (`backdrop-filter: url(#refractionFilter)`)
- archisvaze/liquid-glass: https://github.com/archisvaze/liquid-glass (по CodePen chakachuk, feTurbulence + displacement)
- WinAviation: https://winaviation.github.io/liquid-glass-demo/ (обычный `filter`, Safari сломан по словам автора)
- Подборка: https://freefrontend.com/css-liquid-glass/
- Вывод: это «шум + смещение» без честной кромки. Как источник идей бесполезны.

## Состояние браузеров (на 30.10.2026)
- `backdrop-filter: url()` в WebKit: баг 245510 открыт с 2022 года. В 07–09.2026 появились PR 68613/68614/69566 с поддержкой, но падение GPU-процесса пока не исправлено, ничего не влито. https://bugs.webkit.org/show_bug.cgi?id=245510 . Firefox парсит, но не рисует.
- `-moz-element()` — только Firefox, но живой: годится как бонус-путь (Amir так делает).
- SVG-фильтры в Safari считаются на CPU (Outpace), в Chromium — на GPU. Отсюда правило: в Safari минимум проходов и минимальная площадь.

## Что взять в наш плагин (выводы)
1. Карту — **картинкой из canvas** (squircle + Снеллиус по kube.io / Outpace, B-канал = блик, квадрантная симметрия), с кэшем по форме. Сначала проверить в настоящем Safari обходы `img.decode()` + обновление id 60/250 мс + `rotate: 0deg` + sRGB.
2. Все примитивы — в **подобласти линзы** (как PallavAg): цена зависит от размера стекла, а не всей шапки.
3. **Разные цепочки по движкам** (как Outpace): Chromium — 3 прохода (аберрация); Safari — 1 проход + блик; Firefox — 3 прохода или 1 по замеру. Движок определять по `webkitConvertPointFromNodeToPage`, а не по UA.
4. При движении сдвигать **только x/y подобласти**. Карту пересобирать только при смене размера (ResizeObserver + debounce).
5. Масштаб `scale` компенсировать по движку (таблица tfdmendes).
6. Для шапки над фото-слайдом попробовать **WebGL по картинке слайда** (приём D) и сравнить замером с SVG в Safari и на iPhone: это единственный путь, где Safari считает на GPU.
7. Доступность: «Уменьшить прозрачность» → непрозрачная панель, «Уменьшить движение» → без анимации линзы (как Outpace).
8. Библиотеку целиком не брать. По лицензии (MIT) подходят Amir-Abushanab, PallavAg, tfdmendes, но они тянут свою разметку и React или веб-компоненты. Лучше перенести 2–3 приёма в наш glass.js, сохранив MIT-копирайт в комментарии при заимствовании кода. glass-of-web без лицензии, код не копировать.
