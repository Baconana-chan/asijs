# TODO.md — MiyoCSS Roadmap

> **Статус**: концепция · **Runtime**: Bun + Node.js · **Версия**: 0.1.0-pre · **npm**: `miyocss`
>
> SSR-first CSS + SVG фреймворк. Утилиты собираются **во время рендеринга**, а не сканированием файлов; SVG — first-class, а не «добавка».
> Имя нейтральное намеренно: пакет применим к любому SSR-фреймворку (AsiJS, Hono, Elysia, Fastify, plain Node) — это не «AsiCSS».
> Факты на старт: 0 тестов, 0 строк кода, репо — `packages/MiyoCSS/`.

---

## Почему не «ещё один Tailwind»

| | Tailwind | UnoCSS | MiyoCSS |
|---|---|---|---|
| Как собирается CSS | статический скан файлов | скан + presets | **во время `renderToString`** |
| Динамические классы (`clsx(cond && "md:flex")`) | false negatives | частично | ✅ реально отрендеренное |
| Отдельный build-шаг | да (CLI/plugin) | да | **нет** — по-запросу, опционально кэш в файл |
| JS-зависимость на клиенте | 0 (после билда) | 0 | **0 всегда** |
| SVG | нет | нет | **first-class** (иконки, градиенты, фильтры, chart) |
| Нейтральность | framework-agnostic | framework-agnostic | framework-agnostic (в отличие от `asijs-*` пакетов) |

Ключевой принцип: **не конкурировать вширь (у Tailwind тысячи утилит), а выигрывать архитектурой** — точная сборка, ноль build-шага, SVG-модуль, которого нет ни у кого.

---

## Актуальное состояние

| Аспект | Состояние |
|--------|-----------|
| Пакет / каркас | 🔴 Нет (этот TODO — первая артефакт) |
| Движок генерации | 🔴 Нет |
| SSR-сборка | 🔴 Нет (ключевая фича) |
| SVG-модуль | 🔴 Нет |
| Адаптеры | 🔴 Нет |
| Тесты | 🔴 0 |

---

## P0 🔴 — MVP: движок (v0.1)

*Цель: пакет можно накатить на AsiJS и получить рабочие утилиты с SSR-сборкой. Без SVG.*

### 0.1 — Каркас пакета ✅
- [x] `package.json` (name: `miyocss`, exports: `.` / `./asi` / `./svg`, ESM-only, optional peerDep `asijs`), `tsconfig.json` (strict, declaration), `bun test`
- [x] Структура: `src/core/` (движок), `src/asi/` (адаптер — типизирован через `AsiPlugin`, заглушка), `src/svg/` (P1, заглушка), `test/`
- [x] README (видение + позиционирование vs Tailwind + структура) и этот TODO как документация развития
- [x] CI-воркфлоу `.github/workflows/miyocss-ci.yml`: typecheck + тесты + build на push/PR по `packages/MiyoCSS/**`
- [x] Проверка: `npm install` (asijs из корня через `file:../..`), typecheck чистый, 4/4 smoke-теста, `tsc` build → dist с типами, runtime-импорт собранного пакета работает

### 0.2 — Токены и конфиг ✅
- [x] Design tokens: colors (палитра Tailwind-совместимая, 18 цветов × 10 оттенков + base), spacing (4px-база, 0–96), typography (fontFamily/fontSize/fontWeight/lineHeight/letterSpacing), radius, shadows, opacity, zIndex, breakpoints (sm–2xl)
- [x] Валидация конфига через **TypeBox** (паттерн AsiJS): strict-схемы, `additionalProperties: false`, ошибки с путём (`/theme/colors/blue: Expected union value`)
- [x] Типизированный `defineConfig()` — типы через `Type.Static`, возвращает нормализованный конфиг (options заполняются дефолтами)
- [x] `resolveConfig()` — семантика Tailwind: `theme.*` заменяет группу целиком, `extend.theme.*` deep-мержит поверх (в т.ч. поверх пользовательского `theme`); результат не мутирует дефолты
- [x] Цвета: вложенные палитры флаттятся в `blue-500`; вложенный `DEFAULT` → имя родителя (`primary`)
- [x] `flattenColors()` / `deepMerge()` экспортируются (пригодятся SVG-модулю и генератору)
- [x] Dark-mode токены — отложено: вариант «значения» решается вместе с вариантами `dark:` (0.4), когда появится стратегия селектора

### 0.2a — CLI `miyocss info` (smoke поверх 0.2) ✅
- [x] `bin: miyocss → dist/cli.js` (shebang, ESM, работает из Bun и Node для .js/.json конфигов)
- [x] `miyocss info` — резолв конфига (`miyocss.config.{ts,js,mjs,cjs,json}`, флаги `--config` / `--cwd` / `--json` / `--help`)
- [x] Валидация конфига теми же TypeBox-схемами (определённый fail-fast + фолбэк на дефолты, exit 1)
- [x] Статистика: все токен-группы + breakpoints, статические утилиты, **estimated utility surface** (реальная генерация по формулам: цвета×3, spacing×семейства, дроби, grid — на дефолтах 2354)
- [x] 16 тестов (юнит: findConfigFile/validateConfig/collectInfo/countUtilitySurface/formatInfo + e2e через spawn)

### 0.3 — Генератор утилит ✅
- [x] Layout: display (13), position (5), overflow (15, включая x/y/clip), z-index из токенов, box-sizing, visibility, float, `sr-only`
- [x] Flex/Grid: direction/wrap/item (grow/shrink), align-items/content/self, justify (content/items/self), gap/gap-x/gap-y из spacing, grid-cols/rows (1–12), col-span/row-span (+ full)
- [x] Spacing: p/m/px/py/pt/pr/pb/pl + mx/my/…, **отрицательные** (`-m-4`, `-mt-2`), inset/top/right/bottom/left (+ негативы, `auto`)
- [x] Typography: font-family vs font-weight (дизaмбигвация), font-size, leading, tracking, text-align, whitespace, text-wrap, truncate/ellipsis/clip, italic, transform, vertical-align
- [x] Colors: text/bg/border из флаттенных токенов + **slash-opacity** (`bg-red-500/50` → `color-mix`) из opacity-токенов и arbitrary
- [x] Borders/Effects: width (вкл. стороны и x/y), style, radius (вкл. DEFAULT и стороны/углы), shadow (вкл. DEFAULT), opacity
- [x] Sizing: w/h из spacing + full/screen/svh/lvh/dvh/min/max/fit/auto, **дроби** (`w-1/3` → 33.3333%), min/max-w/h
- [x] **Arbitrary values**: `w-[17px]`, `bg-[#f00]`, `text-[13px]` (цвет vs размер), `grid-cols-[200px_1fr]`, `_` → пробел; валидация (отказ на `;{}!<>`), числовые семейства (z/opacity/font) — только цифры
- [x] API: `generateUtility(class, config)` → `{ className, declarations } | null`, `generateCSS(classes, config, { unknown })` (дедуп + сортировка), `escapeSelector` (leading digits, `\:`), `renderRule`
- [x] 39 тестов генератора: снапшоты по каждой группе, инъекции, кастомные токены, рендер полного CSS

### 0.4 — Варианты (первая версия) ✅
- [x] **Псевдоклассы** (24): hover, focus, focus-visible, focus-within, active, visited, disabled, checked, required, read-only, placeholder (`::placeholder`), first/last/odd/even/first-of-type/last-of-type, empty, target, valid, invalid, optional, in-range, out-of-range — чистые CSS-селекторы, ноль JS
- [x] **Breakpoints**: любой ключ `theme.breakpoints` (sm–2xl + кастомные через extend) → `@media (min-width: …)`
- [x] **`dark:`** из `options.darkMode`: `media` → `@media (prefers-color-scheme: dark)`, `class` → `.dark .dark\:bg-…` (селектор-потомок, как Tailwind)
- [x] **Композиция** любого числа вариантов: `hover:md:bg-red-500`, `md:dark:hover:text-white`; media-стек склеивается через `and` (`min-width: 768px and prefers-color-scheme: dark`)
- [x] **Каскадная сортировка** `generateCSS`: base → pseudo → dark(media) → breakpoints по возрастанию min-width — `md:p-4` всегда перекрывает `p-4`, порядок детерминирован независимо от входа
- [x] API: `parseVariants()` (разделение на base+префиксы), `generateRule()` (единая точка — варианты или plain), `generateCSS` теперь гоняет через `generateRule`; `VariantRule` = UtilityResult + `selectorPrefix/selectorSuffix/media`
- [x] 25 тестов (парсер, каждый тип варианта, кастомные breakpoints, обе dark-стратегии, композиция, порядок, детерминизм)

### 0.5 — SSR-сборка (ключевое отличие, без неё пакет не выпускать)
- [x] **Сбор использованных классов — tree-walk по JSX-дереву до рендера** в обёртках `miyocss.render()` / `miyocss.stream()` (решение №1, ядро AsiJS не трогаем)
- [x] Дедипликация + порядок генерации (каскад: утилиты → варианты → media) — через `generateCSS`
- [x] Инжект `<style>` в `<head>`: пост-инжект **после** рендера (см. «Отклонение от решения №4» ниже); работает и для строки, и для стрима
- [x] **Ноль false positives**: в CSS попадает только реально отрендеренное; условные классы работают честно (тест `cond && "hidden"`)
- [x] Опция `collect: "auto"` — сбор по умолчанию; `collect: false` — полностью статический CSS из конфига (`generateFullCSS`)

> **Отклонение от решения №4 (зафиксировано при реализации):** инжект «прямо в дереве» невозможен — AsiJS `renderToString` HTML-экранирует children-строки (`>` в media-запросах стал бы `&gt;`), а `raw()` в AsiJS фактически не работает (рендерится как `<raw html=…>`, обработки `type === "raw"` в рендере нет). Поэтому: строка — пост-инжект через `injectStyleIntoHtml` (replace перед `</head>`); стрим — буфер **только до `</head>`** (head маленький, TTFB-штраф пренебрежим), дальше всё стримится без буферизации. Функционально результат идентичен решению №4, реализация другая.

> **Ограничение tree-walk (как и задумано в решениях):** async-компоненты не раскрываются (их тело неизвестно до рендера) — классы внутри них собираются через escape-hatch `collectClass()` (P2). Синхронные компоненты раскрываются. Тест: `async component` → `async-only` не собирается, sync → собирается.

### 0.6 — Адаптер AsiJS
- [ ] `miyocss/asi` — плагин: `app.use(miyocss({ tokens, darkMode }))`
- [ ] `html()`-обёртка: рендер + автоинжект стилей в head
- [ ] Хелпер `ctx.styles()` / `<StyleSheet />` для ручного контроля
- [ ] Пример: компонент страницы на утилитах, тест на рендер HTML со стилями

### 0.7 — Тесты MVP
- [ ] Генерация каждой группы утилит (снапшоты)
- [ ] Варианты: hover/md/dark компилируются в правильные селекторы
- [ ] SSR-сбор: страница с 30 классами → в `<style>` ровно 30 (+ варианты), без мусора
- [ ] Конфиг: валидация TypeBox, кастомные токены
- [ ] Arbitrary values: валидные и невалидные (XSS-попытки в значении)

---

## P1 🟠 — v0.5: полезный

*Цель: реально использовать в проде; SVG-ядро; другие SSR-фреймворки.*

### 1.1 — Расширение движка
- [ ] `defineUtility()` — кастомные утилиты пользователя
- [ ] Групповые варианты: `group-hover:`, `group-focus:`, `peer-`
- [ ] `first:`, `last:`, `odd:`, `even:` (structural)
- [ ] `before:`/`after:` (pseudo-element утилиты)
- [ ] Динамические значения: `calc()`, `clamp()`, `min()/max()` из токенов
- [ ] Статические утилиты без значений (`hidden`, `block`, `sr-only`)
- [ ] Утилиты-шорткаты: `center` → flex+align+justify

### 1.2 — purge-to-file (кэш для CDN/файлообменника)
- [ ] Сборка использованных классов за N запросов → статический `miyocss.css`
- [ ] Хэш-имя файла (content hash), инвалидация
- [ ] Интеграция с SSG AsiJS (`asi build --ssg` → один CSS на выходе)
- [ ] `miyocss build <dir>` CLI: сборка без SSR (для SPA/чистого статики)

### 1.3 — SVG-ядро (first-class)
- [ ] `svg()`-хелперы: `<svg>`, path, circle, rect, line, polyline, polygon, g, defs
- [ ] **Контракт CSS vs presentation attributes (решение №2)**: атрибуты из токенов = дефолты (работают через `<use>`-спрайты), утилиты `svg-fill-*`/`svg-stroke-*` = CSS-оверрайды для inline-SVG, `currentColor` — оба пути
- [ ] Градиенты: linear/radial через токены, `fill="url(#...)"` генерация
- [ ] Фильтры: blur, shadow, drop-shadow — утилиты `svg-fill-*`, `svg-stroke-*`
- [ ] Атрибуты: viewBox, preserveAspectRatio, role/aria (a11y), классы поверх утилит
- [ ] Responsive: масштабирование через CSS (width/height из токенов)
- [ ] **Иконки**: набор базовых (arrow, check, close, menu, search, user, settings, heart, star), размер через токены, `currentColor`
- [ ] **Chart-примитивы**: `<BarChart data />`, `<LineChart />`, `<PieChart />` — чистый SVG, без D3, SSR-совместимы
- [ ] **Анимированный SVG**: `<animate>`, `<animateTransform>` (CSS-анимации не всегда работают в SVG)

### 1.4 — Адаптеры (framework-agnostic)
- [ ] **Ядро standalone**: `collectStyles(html: string, { config })` → `{ html, css }` — работает с любым SSR, который отдаёт строку
- [ ] Адаптер Hono (middleware, автоинжект)
- [ ] Адаптер Elysia (middleware)
- [ ] Адаптер Fastify (hook `onSend`)
- [ ] plain Node (пример без фреймворка)
- [ ] Тест: один и тот же HTML → одинаковый CSS на всех адаптерах

### 1.5 — Тесты P1
- [ ] Кастомные утилиты + групповые варианты
- [ ] purge-to-file: кэш корректен, инвалидация по изменению
- [ ] SVG: рендер примитивов, градиентов, chart-компонентов (снапшоты)
- [ ] Адаптеры: Hono/Elysia/Fastify/plain — интеграционные тесты

---

## P2 🟡 — v1.0: полноценный

*Цель: «достаточно хорош, чтобы советовать»; закрыть дыры против Tailwind-экосистемы.*

- [ ] Тёмная тема стратегия: `dark:` class-based + `prefers-color-scheme` + переключение без FOUC (inline script)
- [ ] RTL (`rtl:` вариант, logical properties)
- [ ] Префиксы (`tw-`-подобный) для изоляции от чужих стилей
- [ ] Browser targets: autoprefixer-логика для старых браузеров
- [ ] Плагин-система: расширение набора утилит через `definePlugin` (по образцу plugin-deps AsiJS)
- [ ] Preflight/reset: минимальный нормалайз, опциональный
- [ ] VS Code extension: инлайн-превью утилит, авто-дополнение классов (по мотивам `vscode-asijs`)
- [ ] CLI: `miyocss dev` (watch + генерация), `miyocss build`, `miyocss info` (сколько классов, размер)
- [ ] **Бенчмарки**: размер CSS (наш vs Tailwind на одном сайте), время генерации, время SSR
- [ ] Docs portal (по мотивам apiDocs AsiJS): playground, поиск утилит, live-превью

---

## P3 🟢 — Backlog

- [ ] Широта утилит до уровня Tailwind (тысячи) — **осознанно низкий приоритет**, выигрываем архитектурой, а не объёмом
- [ ] Content-API для SPA-клиентов (сбор из runtime, не только SSR)
- [ ] Type-safe классы: `<div cls={c("p-4", cond && "md:flex")} />` с автокомплитом
- [ ] Кэш на Redis (для multi-instance SSR)
- [ ] Минификация + сортировка по специфичности (lightningcss-подобная)
- [ ] MiyoCSS Playground web (отдельная страница)

---

## Конкурентное позиционирование (для README)

| Проект | Модель | Слабое место | MiyoCSS отвечает |
|---|---|---|---|
| Tailwind | сканер файлов | false negatives, build-шаг | SSR-сборка, ноль build |
| UnoCSS | скан + presets | тот же скан | точная сборка |
| Panda CSS | codegen | свой DSL, lock-in | классические классы |
| vanilla-extract | CSS-in-TS | типизация вместо классов | SSR-first |
| Open Props | CSS-переменные | нет утилит | и утилиты, и SVG |

**Ниша**: SSR-фреймворки, которым нужен zero-JS, zero-build-шаг стилинг + SVG-графика из коробки. AsiJS — первый адаптер, но не единственный.

---

## Архитектурные решения (зафиксировано)

1. **Хук в renderToString → (а) обёртка-helper `miyocss.render()` / `miyocss.stream()`.**
   Сбор классов — **синхронный tree-walk по JSX-дереву до рендера** (дерево AsiJS — чистые объекты `{ type, props }`, обходится без хуков и monkey-patching). Ядро AsiJS не трогаем — ноль breaking changes.
   Известное ограничение: классы внутри async-компонентов статический walk не видит → escape-hatch `collectClass()` / `<Collect>` позже (P2 backlog).
2. **SVG: presentation attributes = дефолты, CSS = оверрайды.**
   Правило каскада: CSS всегда побеждает presentation attributes. НО через `<use href="#id">` (спрайты) страничный CSS не достаёт до shadow-DOM — работают только атрибуты (и `currentColor`). Поэтому: база генерируется **атрибутами из токенов** (работает везде, включая спрайты), утилиты `svg-fill-*` / `svg-stroke-*` — **CSS-классы для inline-SVG**, `currentColor` поддерживается обоими путями.
3. **Размер ядра → инкрементально.**
   Стартуем с ~150 утилит по категориям, **каждую новую утилиту добавляем вместе со снапшот-тестом**. Никакого «каталога из 300 разом» — каскадные конфликты ловим по мере роста, а не в одном мега-ПРе.
4. **Streaming → решается обёрткой бесплатно.**
   Tree-walk (синхронный, микросекунды) идёт **до** старта стрима → CSS готов до первого чанка → `<style>` вставляется в `<head>` **прямо в дереве** (walk находит `head` и аппендит) → дальше обычный `renderToStream`. Никакой буферизации чанков и TTFB-штрафа. Альтернатива с двумя проходами рендера отброшена — убивает смысл streaming.
