# liquid-glass-web

Жидкое стекло в духе Apple Liquid Glass (iOS / macOS 26) для обычных сайтов: преломление у скруглённой кромки, радужная кайма, блик по Френелю, тень. Без зависимостей и сборки, один ES-модуль.

*Liquid-glass effect for plain websites: edge refraction (Snell's law, n = 1.5), chromatic dispersion, Fresnel highlight. Zero dependencies. Docs are in Russian; the code comments too. Works in Safari, Chrome, Edge, Firefox.*

**Демо:** откройте `demo/index.html` через локальный сервер (`python3 -m http.server` в корне репозитория → `http://localhost:8000/demo/`).

## Как это работает

| Слой | Что делает | Чем считается |
|---|---|---|
| `src/liquid-glass.js` | Над **фото, видео и canvas** — настоящее преломление: WebGL2-шейдер берёт картинку текстурой прямо из `<img>`/`<video>`, преломляет её у кромки по Снеллиусу, раскладывает на 3–5 «цветов спектра» и добавляет блик по Френелю. Где WebGL нет — матовое стекло на `backdrop-filter`. | видеокарта |
| `src/dom-glass.js` | Над **текстом и вёрсткой** — только в Chromium (Chrome, Edge, Яндекс Браузер): `backdrop-filter: url(#svg)` с картой смещения, построенной по форме элемента. Браузер сам гнёт живую страницу под элементом. В Chromium этот путь используется везде, а WebGL-линза прячется. | видеокарта |

Почему над текстом в Safari и Firefox стекло матовое: браузер не отдаёт пиксели страницы под элементом. Варианты «скопировать страницу под стекло» и «снимок DOM в текстуру» мы пробовали — это лагает при прокрутке (подробности ниже). Когда в браузерах появится HTML-in-Canvas, это можно будет сделать честно.

## Подключение

```html
<script type="module" src="/liquid-glass.js"></script>
<script type="module" src="/dom-glass.js"></script> <!-- необязательно: стекло над текстом в Chromium -->

<figure class="hero" data-glass-media="stack">            <!-- откуда брать картинку -->
  <img class="is-on" src="photo.webp" data-glass-src="photo-1000.webp" alt="">
</figure>
<div class="hero__panel" data-glass-occluder>…</div>      <!-- вёрстка поверх фото: тут не преломлять -->

<nav class="bar" data-glass data-glass-preset="bar" data-glass-over=".hero">…</nav>
<button data-glass="circle" data-glass-preset="dot">▶</button>
```

Все атрибуты, параметры, пресеты и API — в [docs/API.md](docs/API.md). Архитектура и обоснования — в [docs/SPEC.md](docs/SPEC.md).

Без JavaScript, при «Уменьшить прозрачность» и в режиме высокой контрастности остаётся матовое стекло или сплошная плашка. При «Уменьшить движение» стекло не анимируется.

## Подводные камни, которые мы нашли (проверено в настоящем Safari 27 на Mac)

Это главное, ради чего стоит читать репозиторий. Многое из этого нигде не описано.

**SVG-фильтры в Safari**
- `filter: url(#svg)` на элементе Safari рисует **на процессоре** — каждый кадр прокрутки. Отсюда лаги любого «стекла на SVG-фильтрах» в Safari. Поэтому преломление здесь в WebGL.
- `backdrop-filter: url()` Safari не поддерживает совсем (только Chromium).
- `feImage` с картой смещения Safari не грузит ни по `data:`, ни по `blob:` — элемент молча рисуется пустым.
- `color-interpolation-filters="sRGB"` и `filterUnits="userSpaceOnUse"` (область фильтра в пикселях) — в Safari тоже пустота. Работает область в долях элемента.
- **`translate3d` / `will-change` у потомка элемента с SVG-фильтром** — Safari выносит потомка в отдельный слой, фильтр его не видит, и эффект пропадает целиком. Только 2D `translate`.
- Safari кэширует результат фильтра по `id`: при пересборке фильтра давайте новый `id`.
- То, что работает: `feTurbulence`, `feFlood` с подобластями, `feMerge`, `feGaussianBlur`, `feConvolveMatrix` (оператор Собеля по `SourceAlpha` даёт карту изгиба по форме элемента без картинки), `feDisplacementMap`, `feComposite arithmetic`.

**Chrome**
- **`view-transition-name` на предке делает его «корнем подложки»** (backdrop root): `backdrop-filter` внутри видит пустоту, и размытие/преломление не работают. Мы долго искали, почему в Chrome «стекло старое».

**Инструменты**
- WebKit из Playwright **не совпадает** с настоящим Safari: рисует пустоту там, где Safari рисует, и наоборот. Стекло проверяйте только в настоящем Safari.
- Долгий кэш CSS + `@import` без версии → браузер смешивает старые и новые стили только на боевом домене. Склеивайте CSS в один файл с хэшем в адресе.

**Скорость**
- «Копия страницы под стеклом + SVG-фильтр» — 60 кадров на Mac, но с рывками до 33 мс и плохо на iPhone. Копия одной картинки вместо страницы — лучше, но фильтр всё равно на процессоре.
- WebGL-шейдер по текстуре из `<img>` — плавно; перерисовка на каждом кадре нужна только «липкой» шапке, остальное стекло рисуется один раз.

## Что внутри `docs/`

- `SPEC.md` — итоговая архитектура, уровни деградации по браузерам, бюджет скорости.
- `design/` — четыре независимых проекта (SVG, GPU, гибрид, свободный) и почему выбран гибрид.
- `research/` — как Apple делает Liquid Glass, все найденные веб-реализации, матрица возможностей браузеров, графика и шейдеры, скорость.

## Статус

Черновик, октябрь 2026. Проверено: Safari 27 и Chrome на Mac. **На iPhone жидкое стекло по умолчанию выключено** (матовое) до проверки на устройствах.

Идеи взяты из открытых разборов: Aave «Building Glass for the Web», Outpace Studios (glass.outpacestudios.com), kube.io и др. — ссылки в `docs/research/implementations.md`.

## Лицензия

MIT
