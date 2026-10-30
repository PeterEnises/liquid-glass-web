# Матрица возможностей браузеров для «жидкого стекла» (конец октября 2026)

Составлено 30.10.2026. Источники — ссылками в конце каждого раздела.

Метки:
- **[S27]** — проверено нами в настоящем Safari 27 на macOS (факты из `CONTEXT.md`);
- **[ист.]** — по источникам в интернете, нами не проверено;
- **[?]** — источники противоречат друг другу или их нет, нужна проверка.

Всё про Safari, что помечено [ист.], **требует проверки в настоящем Safari**. Playwright-WebKit
доказательством не считаем (он уже рисовал пустоту там, где настоящий Safari рисует).

---

## 1. Сводная матрица

| Возможность | Safari macOS 27 | Safari iOS 27 (и все браузеры iOS) | Chrome / Edge (десктоп и Android) | Firefox (десктоп / Android) | Samsung Internet |
|---|---|---|---|---|---|
| `backdrop-filter` (blur, saturate и др.) | да, без префикса с 18 [ист.]; матовое стекло на сайте работает [S27] | да [ист.] | да | да с 103; на Android прокрутка под ним заметно тормозит [ист.] | да (Chromium) [ист.] |
| `backdrop-filter: url(#svg)` | **нет** [S27]. В WebKit открыты PR 68613/68614 (июль–сент. 2026), не выпущены [ист.] | нет [ист.] | **да**, SVG-фильтры считаются на GPU [ист.] | **нет**: молча игнорируется, а `CSS.supports()` при этом отвечает «да» [ист.] | вероятно да (Chromium) [?] |
| CSS `filter: url(#svg)` на HTML-элементе | да, но считается на CPU на каждом кадре [S27 + ист.] | да, но тот же CPU-путь, на iPhone «очень плохо» [S27 по ощущениям, не мерили] | да, на GPU (Skia) [ист.] | да; часть примитивов на GPU (WebRender), часть — CPU-откат [ист.] | да [ист.] |
| — feGaussianBlur | да [S27] | [ист.] да | да | да, на GPU | да |
| — feConvolveMatrix | да [S27] | [?] | да | да (путь — [?]) | да |
| — feDisplacementMap | да, несколько проходов [S27] | [?] предположительно да, дорого | да | да, но через CPU («blob»-путь), не ускорен [ист.] | да |
| — feTurbulence | да [S27] | [?] | да | да | да |
| — feFlood / feMerge / feComposite arithmetic | да; но размытие склеенных feFlood+feMerge — пусто [S27] | [?] | да | да | да |
| — feImage с картой (`data:` / `blob:`) | **нет, оба — пусто** [S27]. Outpace пишет, что `blob:` работает, — у нас в Safari 27 не подтвердилось | [?] считать «нет» | да | да; но feImage+feDisplacementMap в backdrop-filter — тихий отказ [ист.] | да [ист.] |
| — `color-interpolation-filters="sRGB"` на `<filter>` | **нет, ломает элемент** [S27] | [?] считать «нет» | да | да | да |
| — `filterUnits="userSpaceOnUse"` | **нет** [S27]; только доли элемента | [?] | да | да | да |
| CSS `element()` | нет [ист.] | нет | нет | **да, только `-moz-element()`**; Mozilla обсуждала удаление [ист.] | нет |
| HTML-in-Canvas (`drawElementImage`, `texElementSubImage2D`, `drawElementImageToTexture`) | нет | нет | **только origin trial** (пробный режим с токеном), продлён до Chrome 160; атрибут `layoutsubtree` в Chrome 155 переименован в `content="drawable"` [ист.] | нет | нет [?] |
| WebGL2 | да | да | да | да | да |
| WebGPU | да, с Safari 26.0 (macOS, iOS, iPadOS, visionOS) [ист.] | да, с iOS 26 [ист.] | да; Android — с Chrome 121, Android 12+, GPU Qualcomm/ARM [ист.] | Windows с 141; Mac Apple Silicon с 145/147; Linux и Android — нет (только Nightly / флаг) [ист.] | да с 24 по caniuse, но зависит от устройства [ист.] |
| View Transitions (в пределах страницы) | да с 18 [ист.] | да | да | да с 144 [ист.] | да |
| View Transitions (между страницами) | да с 18.2 [ист.] | да | да с 126 | нет [ист., caniuse противоречит] | да [?] |
| OffscreenCanvas 2D / WebGL | 2D с 16.4, WebGL с 17; в воркере WebGL зависит от ОС, есть баги [ист.] | то же, баги на iOS 17.4 [ист.] | да | да | да |
| Houdini Paint API (`paint()`) | частично/нет [ист.] | нет | да с 65 | нет [ист.] | да |
| Houdini Properties (`@property`) | да [ист.] | да | да | да [ист.] | да |

---

## 2. Что это значит для нашего стекла

1. **Единственный кроссбраузерный путь честного преломления — тот, что у нас уже есть:** обычный
   `filter: url()` на копии картинки под стеклом. `backdrop-filter: url()` работает только в Chromium
   (Chrome, Edge, Samsung Internet). В Safari его нет [S27]. Firefox тоже не умеет, и это хуже, чем
   просто «нет»: `@supports` отвечает «да», а стекло получается прозрачным. Распознавать Firefox через
   `@supports` нельзя: только по движку, либо пробным рендером.
2. **Почему Safari тормозит:** в WebKit SVG-фильтры на HTML считаются в софте, и при движении
   подложки фильтр пересчитывается каждый кадр [ист.: Outpace]. Это сходится с нашим замером:
   худший кадр 33 мс, нагрузка на CPU. В Chrome те же фильтры идут на GPU и почти бесплатны.
   Поэтому шапка и выглядит по-разному. Outpace в Safari оставляет **один** проход смещения вместо
   трёх (без цветной аберрации), чтобы уложиться в бюджет кадра.
3. **Вывод про WebGL/WebGPU:** это единственный способ получить GPU-преломление в Safari и на iPhone.
   WebGL2 есть везде, WebGPU — везде, кроме Firefox на Linux и Android. Ограничение: шейдер не видит
   пиксели DOM. Ему нужно отдать **картинку**, которая лежит под стеклом. У нас это и так одна фото-слайд,
   поэтому вариант «canvas + шейдер поверх своей же текстуры слайда» реален во всех браузерах.
   Для произвольного содержимого страницы он не подходит.
4. **HTML-in-Canvas** позволяет отдать в WebGL/WebGPU живой DOM, но только в Chrome по
   токену origin trial. API за 2026 год переименовывали дважды. Есть ограничения приватности: чужие
   (cross-origin) картинки, `url()`, посещённые ссылки и т. п. не рисуются. Для сайт-пример годится разве
   что как эксперимент на Chrome, в основу не годится.
5. **`-moz-element()` в Firefox** может дать живую копию подложки без дублирования DOM (стекло над
   любым содержимым). Работает только в Firefox, есть риск, что функцию уберут. Это необязательное
   улучшение, не основа.
6. **iOS:** все браузеры на iPhone (Chrome, Firefox, Edge, Samsung) — это WebKit. В ЕС с iOS 17.4 можно
   ставить свои движки, но на середину 2026 этого никто не сделал [ист.]. Значит, для iPhone и iPad
   матрица = столбец Safari iOS. Стекло на SVG-фильтрах там дорого считается на CPU, поэтому для iPhone
   есть два честных варианта: шейдер (WebGL/WebGPU) или матовый `backdrop-filter`.
7. **Android:** Chrome и Samsung Internet — Chromium, `backdrop-filter: url()` и GPU-фильтры там
   есть [ист.]. Firefox на Android: SVG-стекло работает только через `filter`, а простой
   `backdrop-filter: blur()` при прокрутке подтормаживает (баг 1732817 открыт). На слабых
   Android-устройствах большой радиус размытия дорог.
8. **Грабли Safari 27, подтверждённые нами** и не найденные в источниках (или противоречащие им):
   - `feImage` с `blob:` в Safari 27 тоже рисует пусто, хотя Outpace советует именно `blob:`;
   - `color-interpolation-filters="sRGB"` ломает элемент, хотя Outpace «форсирует sRGB»;
   - `filterUnits="userSpaceOnUse"` ломает элемент;
   - `translate3d`/`will-change` внутри фильтруемого элемента выносит потомка в отдельный слой, и
     преломление исчезает целиком;
   - Safari кэширует результат фильтра по `id`, это подтверждает и Outpace.
   В Safari 27 исправили «фильтр по `url(#id)` не обновлялся при изменении содержимого фильтра»
   (WebKit 101870430) [ист.]. Возможно, трюк с новым `id` больше не нужен — **проверить в настоящем
   Safari**.
9. **Что следить:** WebKit PR 68614 (`backdrop-filter: url()`) и PR 68613 (ускоренный путь фильтров).
   Если их примут, в Safari 27.x/28 появится `backdrop-filter: url()`. Сейчас открыт и
   svgwg #1142, предложение стандартизировать «преломление подложки» (июнь 2026).

---

## 3. Рекомендация по ветвлению (для проектирования плагина)

| Среда | Основной путь | Запасной |
|---|---|---|
| Chromium (Chrome, Edge, Samsung, Android Chrome) | `backdrop-filter: url()` с полным фильтром (3 прохода, аберрация) или текущая схема с копией | матовый `backdrop-filter` |
| Safari macOS | WebGL2/WebGPU-шейдер над текстурой слайда **или** текущий SVG с 1 проходом | матовый `backdrop-filter` |
| iOS (все браузеры) | WebGL2-шейдер над текстурой слайда (замерить на iPhone!) | матовый `backdrop-filter` (как сейчас) |
| Firefox десктоп | текущая схема (`filter: url()` на копии); опционально `-moz-element()` | матовый `backdrop-filter` |
| Firefox Android | матовый `backdrop-filter` с малым радиусом | сплошная полупрозрачная заливка |
| «Уменьшить прозрачность» | непрозрачная подложка | — |
| «Уменьшить движение» | без анимаций преломления | — |

Распознавание: **не по `@supports`** для `backdrop-filter: url()` (Firefox врёт). Лучше по движку
плюс пробный рендер в канвас, где это возможно.

---

## Источники

Safari / WebKit:
- WebKit в Safari 26.0 (WebGPU на всех платформах Apple, исправления фильтров): https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
- Safari 26.1: https://webkit.org/blog/17541/webkit-features-for-safari-26-1/ ; Safari 26.2: https://webkit.org/blog/17640/webkit-features-for-safari-26-2/
- WWDC26, Safari 27 beta (исправления `filter: url()`, view transitions, canvas): https://webkit.org/blog/17967/news-from-wwdc26-webkit-in-safari-27-beta/
- WebKit bug 245510 `backdrop-filter: url()` (открыт, PR 68613/68614 от 2026): https://bugs.webkit.org/show_bug.cgi?id=245510
- OffscreenCanvas WebGL в Safari: https://bugs.webkit.org/show_bug.cgi?id=183720 , https://lists.webkit.org/pipermail/webkit-unassigned/2024-May/1165881.html

Firefox:
- Bug 1961378 (backdrop-filter игнорируется при SVG `url()`): https://bugzilla.mozilla.org/show_bug.cgi?id=1961378
- Bug 1995195 (дубликат): https://bugzilla.mozilla.org/show_bug.cgi?id=1995195
- Ускорение SVG-фильтров в WebRender (intent to ship): https://groups.google.com/a/mozilla.org/g/dev-platform/c/-M0HVkCWjx0 ; feImage+feDisplacementMap: https://bugzilla.mozilla.org/show_bug.cgi?id=1972363
- Тормоза backdrop-filter на Android: https://bugzilla.mozilla.org/show_bug.cgi?id=1732817
- `-moz-element`: https://developer.mozilla.org/en-US/docs/Web/CSS/-moz-element , https://caniuse.com/css-element-function
- Ложное `@supports` в Firefox: https://github.com/AceGuru-bjx/GlassLab/issues/33
- Идея на Mozilla Connect: https://connect.mozilla.org/t5/ideas/support-svg-filters-in-backdrop-filter-for-advanced-glass/idi-p/98453

Chrome / Chromium:
- HTML-in-Canvas, изменения в origin trial: https://developer.chrome.com/blog/html-in-canvas-ot-changes
- Intent to Experiment: https://groups.google.com/a/chromium.org/g/blink-dev/c/t_nGEmJ_v4s
- Спецификация и приватность: https://wicg.github.io/html-in-canvas/ , https://github.com/WICG/html-in-canvas/blob/main/security-privacy-questionnaire.md
- SVG-фильтры в Chromium (GPU через Skia): https://www.chromium.org/developers/design-documents/image-filters/
- WebGPU на Android: https://developer.chrome.com/blog/new-in-webgpu-121

Общее:
- Статус WebGPU по движкам: https://github.com/gpuweb/gpuweb/wiki/Implementation-Status , https://caniuse.com/webgpu
- View Transitions между страницами: https://caniuse.com/cross-document-view-transitions
- CSS Paint API: https://developer.mozilla.org/docs/Web/API/CSS_Painting_API , https://web.dev/articles/houdini-how
- svgwg #1142, стандарт «преломления подложки»: https://github.com/w3c/svgwg/issues/1142
- Outpace Studios, «Liquid glass for the web» (Safari считает фильтры на CPU, 1 проход, `blob:`): https://glass.outpacestudios.com/
- Samsung Internet (версии и движок): https://browsercalendar.com/browsers/samsung-internet , https://en.wikipedia.org/wiki/Samsung_Internet
- Чужие движки на iOS: https://macrumors.com/2026/06/17/webkit-rule-costs-ios-users-browser-performance
