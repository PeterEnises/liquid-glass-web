# Свободный поиск: что свежего и почему у нас лагает

Дата: 30.10.2026. Пометки: **[S27]** проверено в настоящем Safari 27 (из CONTEXT.md);
**[код WebKit]** прочитано в исходниках WebKit `main` на GitHub, в Safari не проверялось;
**[?]** гипотеза, требует проверки в настоящем Safari; **[вторично]** пересказ блогов, первоисточник не найден.
Здесь только то, чего нет в CONTEXT.md и мало в соседних файлах (`browsers.md`, `apple.md`, `graphics.md`).

---

## 1. Главное: почему у других быстро, а у нас лагает

### 1.1. В Safari SVG-фильтры считает процессор, и это видно прямо в коде WebKit

- В WebKit есть ускоренный путь фильтров через Core Image (видеокарта): для каждого нашего примитива
  есть свой `*CoreImageApplier` (feDisplacementMap, feGaussianBlur, feConvolveMatrix, feComposite,
  feColorMatrix, feMerge, feFlood, feTurbulence, feImage, feOffset и др.) — файлы в
  [`Source/WebCore/platform/graphics/coreimage/`](https://github.com/WebKit/WebKit/tree/main/Source/WebCore/platform/graphics/coreimage).
- **Но он выключен.** В [`UnifiedWebPreferences.yaml`](https://github.com/WebKit/WebKit/blob/main/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml)
  настройка `AcceleratedFiltersEnabled` («Accelerated Filter Rendering») имеет `status: unstable`,
  `defaultValue: false` [код WebKit]. Значит, у посетителей SVG-фильтр из CSS `filter: url()` идёт
  программным путём. На видеокарте (через CoreGraphics) считаются только простые `blur()`/`drop-shadow()`
  (`GraphicsContextFiltersEnabled: true`).
- Программный feDisplacementMap ([`FEDisplacementMapSoftwareApplier.cpp`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/graphics/filters/software/FEDisplacementMapSoftwareApplier.cpp))
  — это два вложенных цикла по всем пикселям в одном потоке. Источник берётся **ближайшим пикселем**
  (`static_cast<int>`, без сглаживания), а всё, что выходит за область фильтра, становится прозрачным.
  Перед циклом входы копируются в pixel buffer: `in` с премультипликацией, `in2` без неё [код WebKit].
  Размытие хотя бы распараллелено и идёт через vImage (Accelerate), свёртка (feConvolveMatrix) —
  через ParallelJobs только на областях больше 100×100 [код WebKit].
- Кроме того, между примитивами по умолчанию стоит перевод sRGB ↔ linearRGB
  (`FilterEffect::transformInputsColorSpace`), ещё один проход по пикселям на каждом шаге [код WebKit].

**Отсюда и разница с Chrome.** В Chromium SVG-фильтры растеризует Skia, обычно на видеокарте
(в таблице `browsers.md` это уже отмечено). Поэтому демо kube.io и Aave «летают» в Chrome:
там тот же фильтр считает GPU. Ближайший пиксель против сглаженной выборки — вероятная причина того,
что «в Chrome выглядит иначе» (в Safari кромка зубчатее и «ступенчатее») [?].

**Как подтвердить за 2 минуты (владелец сайтау):** Safari → меню «Разработка» → «Флаги функций» → найти
«Accelerated Filter Rendering», включить, перезапустить вкладку с `?glass=liquid` и прокрутить.
Если лаги почти пропали, узкое место точно процессорный фильтр [?]. Посетителям это не поможет
(флаг у них выключен), но тогда понятно, что чинить: число пикселей и проходов, а не JS.
Заодно стоит посмотреть, не начнёт ли с флагом работать `feImage`: см. п. 3.1.

### 1.2. Сколько пикселей мы реально гоняем

Наш фильтр (`site/assets/glass.js`) — около 17 примитивов на кадр: 2 feColorMatrix + feGaussianBlur +
**2 feConvolveMatrix** (Собель) + 2 feColorMatrix + feComposite (карта), потом **3 feDisplacementMap**
(аберрация) + 3 feColorMatrix + 2 feComposite, потом ещё feGaussianBlur и feComposite.
Область фильтра `x=-0.2 width=1.4, y=-0.5 height=2` даёт **2,8 площади элемента**.
Капсула ≈ 900×56 CSS px на Mac (DPR 2) → область ≈ 1260×112 CSS px → ≈ 2520×224 ≈ **0,56 Мп** на каждый
из ~17 проходов, плюс переводы цветового пространства. Это ~10 Мп-операций на кадр в одном-двух потоках.
На iPhone (DPR 3, капсула ~360×56) получается ≈ 0,5 Мп, но процессор слабее и есть лимит памяти [?].
При кроссфейде слайдов внутри линзы два слоя-копии (и два «зеркала»), фильтр всё так же один, но
перерисовывается каждый кадр анимации прозрачности.

**Половина этой работы на каждом кадре одинаковая.** Карта изгиба (блюр SourceAlpha + две свёртки +
сложение) зависит только от формы капсулы, а пересчитывается при каждом сдвиге картинки, потому что
WebKit не кэширует промежуточные результаты между перерисовками (`FilterResults` живёт один `apply`) [код WebKit].

### 1.3. Вторая причина: копия обновляется в основном потоке, а прокрутка идёт в композиторе

На каждый `scroll` у нас в `requestAnimationFrame` вызываются `getBoundingClientRect()` у фото и
шапки (принудительный layout), меняется `transform` у копии и зеркала, и Safari перерисовывает слой
с фильтром. Прокрутка в Safari на Mac и iPhone асинхронная (композитор), поэтому копия под стеклом
отстаёт на кадр и больше. Это описано как общая беда всех «клонов фона» в свежем запросе к W3C:
[w3c/svgwg#1142](https://github.com/w3c/svgwg/issues/1142) (июнь 2026): клон обновляется в главном
потоке, страница прокручивается в потоке композитора, отсюда «visible lag/jitter». То есть «не успевает
за прокруткой» лечится не только ускорением фильтра, но и тем, чтобы JS вообще не участвовал в
сдвиге картинки (п. 2.2–2.3).

### 1.4. Почему у «быстрых» библиотек быстро

- **WebGL-библиотеки** ([liquidGL](https://github.com/naughtyduk/liquidGL), MIT;
  [ybouane/liquidglass](https://github.com/ybouane/liquidglass);
  [Zqysl/liquid-glass-webgl](https://github.com/Zqysl/liquid-glass-webgl), MIT) один раз делают
  текстуру фона и дальше каждый кадр рисуют квадрат шейдером на GPU. Цена кадра — доли миллисекунды.
  Дорого у них только снятие снимка DOM (100–500 мс, см. `graphics.md`), но для нас это не нужно:
  под стеклом шапки и так одна картинка-слайд, это готовая текстура.
- **Свежие предостережения liquidGL** (README): «Safari can be unstable when the liquid element(s) are
  more than 50% of the viewport width or height», фиксированные элементы в снимок не попадают, очень
  длинные страницы упираются в лимит размера текстуры. Для шапки-капсулы ширина больше 50 % экрана —
  значит, у нас был бы именно рискованный случай [вторично, в Safari не проверено].
- **kube.io и Aave** быстры только в Chrome: там `backdrop-filter: url()` и фильтр на GPU, карта
  изгиба посчитана заранее и подана через `feImage` ([kube.io](https://kube.io/blog/liquid-glass-css-svg/)).
  Ни то, ни другое в Safari 27 у нас не работает [S27].

**Вывод.** Пока фильтр считает процессор Safari, «60 fps на iPhone» SVG-путём не получить.
Реалистичные пути: (а) WebGL/WebGPU-линза с картинкой слайда как текстурой; (б) сильно облегчённый
SVG-фильтр (без Собеля на каждом кадре, без трёх проходов аберрации, с меньшей областью) только для Mac;
(в) матовое стекло во время прокрутки и жидкое в покое.

---

## 2. Неожиданные приёмы, которых нет в других файлах

### 2.1. Карта изгиба как часть SourceGraphic, а не feImage [?]
`feImage` в Safari 27 рисует пустоту [S27], а Собель на каждом кадре дорог. Обход: положить готовую
карту (PNG из build-шага или div с CSS-градиентами) **внутрь** элемента с фильтром, в ту часть области
фильтра, которую не видно (например, под капсулой: область фильтра у нас уходит на 50 % вниз).
В фильтре: `feOffset dy="-H"` поднимает карту на место, `feComposite operator="in"` обрезает её по
форме, и этот результат идёт в `in2` feDisplacementMap. Картинку под стеклом отдельно обрезать по
SourceAlpha капсулы. В итоге вместо feGaussianBlur + 2 feConvolveMatrix + 3 feColorMatrix — один
feOffset и пара feComposite. Всё из уже проверенных примитивов, кроме feOffset (его в Safari 27 ещё
не проверяли). Карта к тому же может быть «правильной» (профиль squircle из kube.io), а не Собелем
от размытой маски.

### 2.2. Аберрация одним проходом вместо трёх [?]
Три feDisplacementMap — самая тяжёлая часть. Видна аберрация только в узкой полосе у кромки. Вариант:
один feDisplacementMap, а цветная кайма — два feOffset на ±1 px с feColorMatrix (R и B) по маске кромки.
Либо в Safari аберрацию выключить совсем (настройка `chroma: false` у нас уже есть).

### 2.3. Перевод цветового пространства на каждом примитиве [?]
`color-interpolation-filters="sRGB"` на `<filter>` в Safari 27 ломает фильтр [S27]. Стоит проверить
тот же атрибут **на каждом примитиве** (`<feGaussianBlur color-interpolation-filters="sRGB">` и т. д.).
По коду WebKit у каждого FilterEffect свой `operatingColorSpace`, и если все в sRGB, переводы между
ними не нужны. Экономия — несколько проходов по пикселям на кадр.

### 2.4. WebGL-линза только над слайдом
Текстура — уже загруженный `<img>` текущего слайда (`texImage2D`, один раз на слайд), canvas внутри
шапки. Шейдер: SDF скруглённого прямоугольника → нормаль → смещение UV, аберрация как три выборки
со сдвигом, лёгкое размытие через `textureLod` по мипмапам. На кадр один квадрат ≈ 0,1 Мп — для GPU
это ничто, и так в Safari и на iPhone (WebGL2 есть с iOS 15, WebGPU — с Safari 26
([WebKit, Safari 26](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/))).
Сдвиг текстуры по-прежнему из JS по `scrollY`, поэтому возможна задержка на кадр относительно
композитора (как в п. 1.3), но цена кадра падает в десятки раз [?]. Подробности шейдеров — в `graphics.md`.

### 2.5. Scroll-driven animations — осторожно
В Safari 26 появились CSS scroll-driven animations ([WebKit, Safari 26](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)),
по вторичным данным в 26.4 их вынесли в отдельный поток
([buildmvpfast, 2026](https://www.buildmvpfast.com/blog/css-scroll-driven-animations-replace-js-2026)) [вторично].
Заманчиво двигать копию под стеклом через `animation-timeline: scroll()` без JS. Но анимация
`transform` в отдельном потоке — это композитный слой, а мы уже знаем, что потомок в отдельном слое
пропадает из фильтра [S27]. Для SVG-линзы это, скорее всего, ломает преломление [?]. Безопасно
использовать для остального сайта (параллакс, появление блоков) вместо `scroll`-слушателей.

### 2.6. Матовое на ходу, жидкое в покое [?]
Пока идёт прокрутка (scroll не утих 120–150 мс), показывать матовое `backdrop-filter`
(оно на GPU), а жидкое включать в покое плавным переходом за 200 мс. Пользователь видит стекло
красивым тогда, когда смотрит на него, а на прокрутке не платит за CPU-фильтр.

---

## 3. Гипотезы для проверки в настоящем Safari

### 3.1. Почему feImage пустой: возможно, ошибка WebKit, а не запрет
В открытом [PR 68613](https://github.com/WebKit/WebKit/pull/68613) (июль–сент. 2026) описано:
если источник фильтра пришёл из ускоренного пути Core Image, `FilterImage::create()` возвращает
пустоту, и следующий примитив получает «ничего». В [PR 68614](https://github.com/WebKit/WebKit/pull/68614)
отдельно сказано, что `SVGFEImageElement::notifyFinished()` раньше не уведомлял CSS-клиентов и
`filter: url()` с feImage оставался устаревшим после асинхронной загрузки картинки. Это очень похоже
на наш «feImage рисуется пустым». Проверить [?]:
1) вставить фильтр с feImage, дождаться загрузки картинки (`new Image().decode()` того же data/blob URL),
   и **после этого** переприменить фильтр под новым id (Safari кэширует по id [S27]);
2) feImage, указывающий на `href` внешнего файла с того же сайта, а не data:/blob:;
3) то же с флагом «Accelerated Filter Rendering» вкл/выкл.
Если 1) сработает, вернётся путь kube.io с готовой картой (лучше по виду и в разы дешевле Собеля).

### 3.2. `-apple-visual-effect` — источники спорят
Это приватное свойство WebKit с материалом Liquid Glass (`-apple-system-glass-material`).
По [разбору Alastair Hogarth](https://alastair.is/apple-has-a-private-css-property-to-add-liquid-glass-effects-to-web-content/)
оно работает только во WebView с приватной настройкой `useSystemAppearance` и в вебе не работает.
[Статья на dev.to (2026)](https://dev.to/devyatov/liquid-glass-on-the-web-6-ways-to-build-it-with-css-and-svg-3m07)
пишет, что это «путь для iOS 26 Safari». Проверка — одна строка CSS на iPhone и Mac [?]. Скорее всего
не работает, но если работает — это системное стекло Apple бесплатно, с `@supports` и запасным путём.

### 3.3. Тонировка панелей Safari 26 от нашей шапки
Safari 26 (iOS и macOS) игнорирует `theme-color` и красит свои панели по `background-color` и
`backdrop-filter` **фиксированных/липких элементов у верхнего и нижнего края**, даже невидимых
(`opacity: 0`) ([разбор 1ar.io](https://1ar.io/updates/safari-26-liquid-glass-web/); WebKit закрыл
баг как «так задумано»). Наша фиксированная шапка с `backdrop-filter` как раз такой элемент.
Советы оттуда: сам фиксированный контейнер шапки прозрачный, стекло — на абсолютном дочернем слое
с `aria-hidden`, закрытые оверлеи — `display: none`, у `html`/`body` явный фон, `viewport-fit=cover`.
Проверить на настоящем iPhone, в обоих режимах нижней панели [?].

---

## 4. Свежие новости по стандартам и браузерам (кратко)

- **[w3c/svgwg#1142](https://github.com/w3c/svgwg/issues/1142)** (25.06.2026, открыт): просьба
  стандартизовать «пиксели под элементом» как вход фильтра (условно `BackdropGraphic`) и, возможно,
  отдельный примитив преломления (`feRefraction`). Позиции браузеров нет. Через год-два может
  появиться штатный путь, сейчас — нет.
- **WebKit PR 68614** (`backdrop-filter: url()`): открыт, «changes requested», и важно — это
  **программный** путь (перерисовка корня страницы в буфер на CPU). Даже если его примут, в Safari это
  будет не быстрее нашего фильтра по копии. Не ждать его как спасения.
- **Safari 27** ([WebKit, Safari 27.0](https://webkit.org/blog/18325/webkit-features-for-safari-27-0/)):
  про SVG-фильтры отдельных пунктов нет; полезное — исправлено «2D canvas больше не создаёт лишний
  композитный слой», «большие радиусы blur больше не тормозят загрузку на iPhone», новые цветовые
  пространства `srgb-linear`/`display-p3-linear` для canvas и WebGL.
- **HTML-in-Canvas** (Chrome): всё ещё origin trial; по вторичному источнику продлён до Chrome 160,
  а в Chrome 155 `copyElementImageToTexture` переименован в `drawElementImageToTexture`
  ([byteiota](https://byteiota.com/html-in-canvas-api-draw-live-dom-inside-webgl-chrome-2026/) [вторично];
  первоисточник — [Chrome for Developers](https://developer.chrome.com/blog/html-in-canvas-origin-trial)).
  Для Safari/Firefox неприменимо. Свежие демо: [html-in-canvas.dev/demos/liquid-glass](https://html-in-canvas.dev/demos/liquid-glass/),
  [jeantimex/glass-effect-webgpu](https://github.com/jeantimex/glass-effect-webgpu).
- **Подводные камни из [emit-solution (10.07.2026)](https://emit-solution.com/en/blog/recreate-apple-liquid-glass-css)**:
  карта с alpha 0 в Chromium даёт сдвиг вместо преломления (премультипликация) — карта должна быть
  с alpha 255; линейный профиль кромки выглядит как «сдвинутая копия», нужен монотонный профиль со
  «складкой»; замер — полосатая линейка под стеклом и скриншоты с шагом в пиксель.
- **Гоча с `@supports`**: Safari парсит `backdrop-filter: url()` без ошибки, `CSS.supports()` говорит
  «да», а ничего не рисует; определять надо по движку ([dev.to](https://dev.to/devyatov/liquid-glass-on-the-web-6-ways-to-build-it-with-css-and-svg-3m07)).
- **Отклик людей**: в обсуждении kube.io на [Hacker News](https://news.ycombinator.com/item?id=45174297)
  жалобы на дёрганую прокрутку даже на M-маках, автор признаёт, что Safari медленно рисует SVG;
  у Netflix подобное стекло жалуются на расход батареи. То есть лаги в Safari — не наша личная беда.

---

## 5. Что из этого делать (по приоритету)

1. **Диагностика за 5 минут**: флаг «Accelerated Filter Rendering» в Safari (п. 1.1) и тест feImage
   с переприменением после загрузки (п. 3.1). Оба ответа меняют дальнейший план.
2. **Для Mac-Safari, если остаёмся на SVG**: убрать Собель из кадра (карта в SourceGraphic, п. 2.1),
   одна выборка вместо трёх (п. 2.2), область фильтра меньше (по высоте `-0.2…1.4` вместо `-0.5…2`,
   если хватит запаса для изгиба у прямых краёв), sRGB на примитивах (п. 2.3), матовое на ходу (п. 2.6).
   Ожидание: в 3–5 раз меньше пикселей-проходов [?].
3. **Для iPhone и вообще «везде быстро»**: WebGL-линза только над слайдом (п. 2.4); запасной путь —
   матовое `backdrop-filter`.
4. **Шапка и панели Safari 26** — перестроить слои шапки по п. 3.3 независимо от выбора стекла.

## Источники

- WebKit, исходники: [coreimage/](https://github.com/WebKit/WebKit/tree/main/Source/WebCore/platform/graphics/coreimage),
  [UnifiedWebPreferences.yaml](https://github.com/WebKit/WebKit/blob/main/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml),
  [FEDisplacementMapSoftwareApplier.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/graphics/filters/software/FEDisplacementMapSoftwareApplier.cpp),
  [FEDisplacementMap.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/graphics/filters/FEDisplacementMap.cpp),
  [FilterEffect.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/graphics/filters/FilterEffect.cpp)
- WebKit PR: [68613](https://github.com/WebKit/WebKit/pull/68613), [68614](https://github.com/WebKit/WebKit/pull/68614), баг [245510](https://bugs.webkit.org/show_bug.cgi?id=245510)
- [w3c/svgwg#1142](https://github.com/w3c/svgwg/issues/1142)
- [WebKit: Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/), [Safari 27.0](https://webkit.org/blog/18325/webkit-features-for-safari-27-0/)
- [liquidGL](https://github.com/naughtyduk/liquidGL), [ybouane/liquidglass](https://github.com/ybouane/liquidglass), [Zqysl/liquid-glass-webgl](https://github.com/Zqysl/liquid-glass-webgl)
- [kube.io: Liquid Glass in the Browser](https://kube.io/blog/liquid-glass-css-svg/), [обсуждение на HN](https://news.ycombinator.com/item?id=45174297)
- [emit-solution, 2026](https://emit-solution.com/en/blog/recreate-apple-liquid-glass-css), [dev.to: 6 Ways](https://dev.to/devyatov/liquid-glass-on-the-web-6-ways-to-build-it-with-css-and-svg-3m07)
- [1ar.io: Safari 26 Liquid Glass toolbar tinting](https://1ar.io/updates/safari-26-liquid-glass-web/)
- [alastair.is: -apple-visual-effect](https://alastair.is/apple-has-a-private-css-property-to-add-liquid-glass-effects-to-web-content/)
- [Chrome: HTML-in-Canvas origin trial](https://developer.chrome.com/blog/html-in-canvas-origin-trial), [byteiota](https://byteiota.com/html-in-canvas-api-draw-live-dom-inside-webgl-chrome-2026/), [html-in-canvas.dev](https://html-in-canvas.dev/demos/liquid-glass/)
- [buildmvpfast: scroll-driven animations 2026](https://www.buildmvpfast.com/blog/css-scroll-driven-animations-replace-js-2026)
