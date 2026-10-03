# Конвейер сборки карточки слоями — веха M7

Status: ACTIVE (с 2026-08-31) · фаза A, шаги B0–B4, B6, B7.1–B7.4, B5.0–B5.3, C1 исполнены (B5.3 — код, деплой за владельцем); открыты B7.5–B7.7, B5.4–B5.11, C2–C4 · аудит `/validate-plan` 2026-10-03

> Закон дробления — `AGENTS.md` «Изоморфное дробление» и
> [ADR-T0011](../../docs/adr/T0011-isomorphic-fragmentation-of-plans.md); рубрика модели —
> `docs/SPEC.md` «Рубрика». Шаги ниже написаны под холодного исполнителя: вход — этот файл и
> названные в шаге файлы. Раскладка по сессиям — раздел «Порядок исполнения» в конце.

## Context

Карточку раньше рисовал один вызов модели изображений: и сцену, и текст. Отсюда брак текстового
блока, невозможность вывести характеристики товара и править без перерисовки. Ни один работающий
сервис этого класса (Fabula AI, PicCopilot, Neiro-Card.AI) не просит генеративную модель рисовать
текст: модель отвечает за пиксели сцены, вёрстка накладывается отдельным слоем по заготовленному
макету.

**Цель вехи:** разобранные образцы → макет как данные → детерминированная сборка слоями. Текст в
кадре — ровно тот, что задан; файл — точно в размер профиля площадки; правка текста — бесплатная
пересборка. Веха идёт **перед M6** (решение владельца 2026-08-31): M6 принимает механизм, который
M7 меняет.

Объяснение для заказчика — [V-11](../../docs/VISUALS.md#v-11).

## Решения владельца — не переоткрывать

| № | Вопрос | Решение |
| --- | --- | --- |
| 1 | Кто отбирает образцы | Владелец, по топу выдачи площадки. Стартовый набор — 31 образец Wildberries + 3 референса |
| 2 | Площадка в библиотеке | Тег образца, а не ось библиотеки |
| 3 | Подбор макета | По признакам заявки: категория (FR-03), сценарий показа (FR-08), пожелания (FR-09), наличие логотипа, число свойств |
| 4 | Характеристики товара | Текстовая модель извлекает свойства из описания продавца и ранжирует; продавец правит порядок, удаляет, дописывает. Придумывать свойства запрещено |
| 5 | Логотип | Отдельная загрузка PNG со строгой проверкой; не загрузил — слой не рисуется, продавец предупреждён |
| 6, K-2 | Фон и товар | Одна генерация сцены; вырез товара — из неё же. Раздельная генерация не нужна |
| 7, K-4 | Человек в кадре | Приоритетный сценарий; частота дефектов рук замеряется (C2); у образцов есть признак «кисти скрыты» |
| 8, 9 | Иконки и шрифты | Базы пополняются офлайн-конвейером; шрифты — только со свободной коммерческой лицензией, статические начертания |
| 10 | Что отдаём | Готовый файл. Кнопка «Редактировать» есть, но неактивна |
| 11 | Глубина правок в вехе | Только «переписать текст и пересобрать», бесплатно, плюс смена шрифта. Полные правки — отдельное приложение (B23) |
| 13 | Критерий красоты | Отложен; приёмка вехи механическая (C1) плюс вслепую (C4) |
| K-1 | Проверка нестыковок | Бесплатным превью до оплаты (сделано, B6), а не платной генерацией |
| K-3 | Нет ассета | Отсутствующий ассет снимает свой слой, а не ломает макет — правило валидатора |
| O-5 | Потолок модулей | Ёмкость выбранного макета; список свойств обрезается с хвоста, превью показывает отсечённое |
| O-7 | Бренд-ассеты в плашке | Макет объявляет возможность, содержимое решает сборка; пустая группа с привязками снимается |
| — | Порядок и число слоёв | Не фиксированы: макет — список слоёв с z-порядком |
| — | Где живут сборка и вырез | [ADR-0015](../../docs/adr/0015-card-service-on-vps-not-edge-function.md): вырез — сервис на VPS (`https://cutout.mekit.ru`, [ADR-0016](../../docs/adr/0016-cutout-service-trust-boundary.md)); **сборка пока в Edge Function**, переезд сборки и тариф — одним решением ближе к продакшену (владелец, 2026-09-09) |
| — | Модель выреза | `u2netp` ([ADR-0017](../../docs/adr/0017-cutout-model-u2netp-by-authors-consent.md)); маска — мягкая альфа 0…255, бинаризовать нельзя (B23) |
| — | Долги ADR-0012 | Закрываются **только вместе с B7** (владелец, 2026-09-02): раньше каждый даёт регресс |
| Q-1 | Тяжёлые макеты в размере профиля | До переезда сборки на коробку тяжёлые макеты (не успевают собраться в Edge Function) **временно вне подбора** платной карточки и превью (владелец, 2026-10-03) — шаг B7.7 |

## Что уже сделано

Подробности — в `git log` по этому файлу и в ADR; здесь — что существует и где.

| Шаг | Результат | Где |
| --- | --- | --- |
| A1 | Язык макета: 6 типов слоёв, эффекты, заливки, роли шрифта, 6 текстовых гнёзд, z-порядок полем | `supabase/functions/_shared/card-layout/types.ts`, `validate.ts`; [ADR-0012](../../docs/adr/0012-card-layout-is-ours-not-vendors.md) |
| A2 | Сборщик: макет + содержимое → SVG → PNG (`resvg-wasm`) | `card-layout/svg.ts`, `render.ts` |
| A3, A6 | Гейт round-trip пройден; 34 макета (31 WB + 3 референса) собираются без возражений валидатора | `tools/card-pipeline/` (`npm run cards:roundtrip`), `tools/card-pipeline/samples/` |
| A4 | Разбор образца vision-моделью через Batch API | `tools/card-pipeline/parse.mts` |
| A5, A8 | Базы иконок и шрифтов, дедуп по `sha256`; краска иконки — поле `ink` макета | миграция `20260831120000_card_assets.sql`, `tools/card-pipeline/assets.mts` |
| A7 | Витрина библиотеки | [V-12](../../docs/VISUALS.md#v-12), `docs/design/card-library/` |
| B0 | `card_layouts` и `generation_cards`; производные признаки вычисляются из макета | миграция `20260901120000_card_layouts.sql`; [ADR-0013](../../docs/adr/0013-layout-library-in-database.md) |
| B0.1 | Растеризатор в Edge Function; wasm и шрифты из приватного бакета на холодный старт | `card-layout/renderer-assets.ts` |
| B2.0 | Теги 34 макетов подтверждены владельцем | `tools/card-pipeline/layout-tags*.ts` |
| B1 | Свойства товара извлекаются, правятся, хранятся с заявкой | `supabase/functions/product-properties/`, `generations.product_properties` |
| B2 | Подбор макета: фильтр + скоринг + детерминированная ничья по вводу + универсальный макет | `card-layout/selection.ts`; снимок пишет `snapshot_generation_layout` |
| B3 | Логотип: проверка PNG на клиенте и сервере, `generations.logo_path` | `supabase/functions/_shared/logo.ts` |
| B6 | Бесплатное превью до оплаты, отсечённые свойства и переполнения названы | `supabase/functions/card-preview/`, `card-layout/preview.ts` |
| B4.0 | Оснастка замера изолята; вывод — в изолят не помещаются ни сборка в размере площадки (19–21 макет из 34), ни вырез | `supabase/functions/card-bench/`, `tools/card-pipeline/bench.mts`, `cutout.mts` |
| B4 | Шов `CutoutRunner` + HTTP-реализация к сервису; карта занятости кадра | `card-layout/cutout.ts`, `card-layout/occupancy.ts`; сервис — репозиторий `ovr58/cutout_runner` |
| B7.1–B7.4 | Сборка карточки в воркере: вендор рисует сцену без текста, сборщик кладёт слои; собранная карточка — точно в размер профиля; содержимое сборки пишется в `generation_cards` | `generation-worker/index.ts` (`assembleCard`), `card-layout/filling.ts`, `output-profile.ts` (`exact`), миграция `20261003100000_record_card_assembly.sql` |
| B5.0 | Контракт арт-директора | [ADR-0018](../../docs/adr/0018-art-director-layout-patch.md) |
| B5.1 | Пересчёт долей кадра в доли холста | `card-layout/occupancy.ts` (`frameToCanvas`, `canvasBoxToFrame`) |
| C1 | Механическая приёмка: заголовок и описание в кадре дословны, иначе генерация падает с возвратом баллов; SVG и PNG сборки детерминированы | `card-layout/text-check.ts`, `svg.test.ts` |

**Состояние воркера на сегодня** (`supabase/functions/generation-worker/index.ts`): у генерации
карточки подбирается макет и пишется снимок, вендор рисует сцену без текста, `assembleCard`
собирает карточку нашим сборщиком (`cardFilling` → `renderCard`) точно в размер профиля; кадр
вендора сверяется с профилем допуском `ASPECT_TOLERANCE` (`output-profile.ts`). После сборки
`textMismatches` роняет генерацию, если заголовок или описание легли не дословно. Вырез
(`createCutoutRunner`) зовётся, только если заведены `CUTOUT_ENDPOINT` и `CUTOUT_SECRET`; их нет —
воркер собирает без выреза. Сборку не деплоить до B7.7.

## Шаги

### Блок B7 — сборка карточки в воркере

- [x] **B7.1. Порядок операций карточки в воркере — НЕДЕЛИМ (Opus): шов между модулями
  (провайдер ↔ сборщик ↔ проверка профиля ↔ хранилище); три правки обязаны лечь одним
  изменением, иначе текст в кадре пропадает или удваивается.** Исполнено и сведено 2026-10-03 (`2f64bc1`).
  - **Целевой файл(ы):** `supabase/functions/generation-worker/index.ts`.
  - **Файлы-контракты (читать, не править):** `card-layout/render.ts` — `renderCard(layout,
    content, size, fonts)` возвращает PNG и список снятых слоёв · `card-layout/cutout.ts` —
    `createCutoutRunner({ endpoint, secret })`, любой отказ → `null` · `card-layout/features.ts` —
    `usesCutout`, `usesLogo`, `frameCount` · `supabase/functions/card-preview/index.ts` —
    `readFonts()` (карта «роль → гарнитура» из `card_font_roles`) — взять тот же способ ·
    `supabase/migrations/20260829110000_generations.sql` — `fail_generation` возвращает баллы
    полностью.
  - **Границы:** не трогать подбор (`selection.ts`), язык макета и валидатор, превью
    (`card-preview`), генерацию типа «фото». Не вводить шов `CardRenderer`: вторая реализация
    появится, когда сборка переедет на коробку (ADR-0015), тогда и заводится. Не опускать и не поднимать
    таймаут выреза.
  - **Задача:** для `generation.kind === 'card'` после `generateImages` выполнить по порядку:
    1. `frame = images[0]` (вендор отдаёт один кадр; слои второго кадра снимаются правилом K-3);
    2. если `usesCutout(layout)` и заданы секреты `CUTOUT_ENDPOINT` и `CUTOUT_SECRET` —
       `cutout = await runner(frame)`; секретов нет — `cutout = null`, без ошибки;
    3. содержимое — функцией B7.2; знак — `downloadFile('uploads', logo_path)`, если путь есть;
    4. `renderCard(snapshot.layout, content, { width: profile.width, height: profile.height },
       fonts)`;
    5. проверка профиля B7.3 по собранным байтам; несовпадение — исключение (баллы вернутся
       через `fail_generation`, как сейчас);
    6. в `results` кладутся собранная карточка (`result-1.png`) **и** исходники пересборки:
       кадр вендора `frame-1.<формат из readImageInfo>` и вырез `cutout-1.png`, если он есть;
    7. запись содержимого B7.4, затем `finish_generation` как сейчас.

    Тексты карточки (`composeCard`) по-прежнему идут в поля `title_of_card` /
    `description_of_card` — FR-07 требует их и отдельно от изображения.
  - **Известный риск, который этот шаг не лечит:** изолят, убитый супервизором рантайма
    (`WORKER_LIMIT`, `503`), не доходит до `catch` — генерация остаётся `running` без возврата.
    По замеру B4.0 так падают 13–15 макетов из 34 в размере профиля. Лечится шагом B7.7
    (тяжёлые макеты вне подбора, решение Q-1); **без B7.7 сборку не деплоить**.
  - **Критерий приёмки:** на локальном стенде (`supabase start`, заглушка провайдера, секретов
    выреза нет) генерация карточки с лёгким макетом (`jeans-comfort-style`) доходит до `done`;
    в `results/<user>/<generation>/` ровно два файла — `result-1.png` и `frame-1.*`;
    `result-1.png` — ровно `profile.width × profile.height` (`readImageInfo`); в
    `generation_cards.content` гнездо `title` равно `title_of_card`. `npm test`, `npm run lint`,
    `npm run test:db` — каждая командой отдельно, зелёные.

- [x] **B7.2. Наполнение макета реальным содержимым — чистая функция.** Исполнено и сведено 2026-10-03 (`2f64bc1`).
  - **Целевой файл(ы):** `supabase/functions/_shared/card-layout/filling.ts` (новый),
    `filling.test.ts` (новый).
  - **Файлы-контракты:** `card-layout/preview.ts` — `previewFilling` как образец формы (тот же
    разбор гнёзд и ёмкости, но без рыбы) · `card-layout/types.ts` — `CardContent`, `CardProp`,
    `ImageRef`, `TextSlot` · `card-layout/features.ts`.
  - **Границы:** без ввода-вывода (ни базы, ни хранилища, ни сети); `preview.ts` не менять —
    общие помощники из `features.ts` переиспользовать, а не копировать.
  - **Задача:** `cardFilling(layout, input) → { content: CardContent; cut: CardProp[] }`, где
    `input = { title, description, properties: {label, value}[], frame: ImageRef, cutout:
    ImageRef | null, logo: ImageRef | null }`. Гнёзда: `title ← [title]`, `body ← [description]`;
    `subtitle`, `kicker`, `sizes`, `brand` **не наполняются** (их заполнит арт-директор B5; до
    него слои снимаются K-3). Свойства — пустые отброшены, обрезка по ёмкости с хвоста, `cut` —
    хвост. `frames = [frame]`; `swatches = []`; `cutout`/`logo` — только если макет их
    использует.
    Второй экспорт — `storedContent(content, paths)`, где `paths = { frames: string[]; cutout?:
    string; logo?: string }` (бакет `results` для кадра и выреза, `uploads` для знака): то же
    содержимое, где картинки заменены записями `{ bucket, path, width, height }` (data-URI в
    базу не пишутся — мегабайты в `jsonb`). Обратная `fromStored(stored, download)` принимает
    функцию скачивания (тот же приём, что `DownloadFile` в `renderer-assets.ts`) и
    восстанавливает `CardContent` — для пересборки B7.5.
  - **Критерий приёмки:** `filling.test.ts` проверяет: ёмкость режет хвост и отдаёт его в
    `cut`; макет без логотипа не получает `logo`; ненаполненные гнёзда отсутствуют в `texts`;
    `fromStored(storedContent(x, paths), подменная загрузка)` восстанавливает `x`. Мутационная
    проверка по контракту исполнителя.

- [x] **B7.3. Долги ADR-0012: вендор рисует сцену без текста, собранная карточка — точно в размер
  профиля.** Исполнено и сведено 2026-10-03 (`2f64bc1`).
  - **Целевой файл(ы):** `supabase/functions/_shared/ai-provider/aitunnel.ts`, `aitunnel.test.ts`,
    `types.ts`, `stub.ts`, `supabase/functions/_shared/output-profile.ts` и его тест, вызов
    `generateImages` и проверка профиля в `generation-worker/index.ts`.
  - **Файлы-контракты:** [ADR-0012](../../docs/adr/0012-card-layout-is-ours-not-vendors.md) — раздел
    о долгах · миграция `20260829140000_output_profile_requirements.sql` — решение вехи M5: кадр
    вендора сверяется порогом и допуском, точный размер вендору недостижим, ресэмплер не пишем.
  - **Границы:** промпт и проверку фото-генерации не менять; модель и резерв (ADR-0011) не трогать.
  - **Задача:** удалить `cardLayoutLine` и `cardReferenceParts`; промпт карточки просит сцену без
    текста, плашек и надписей. Поле `card` из входа `generateImages` удаляется; заглушка вёрстку не
    рисует. `describeProfileMismatch(bytes, profile, { exact })`: без `exact` — прежние порог и
    `ASPECT_TOLERANCE` (кадр вендора, фото); `exact: true` — ширина и высота равны профилю; его
    включает только воркер для собранной карточки.
  - **Критерий приёмки:** `grep -rn "cardLayoutLine\|cardReferenceParts" supabase/` пуст; у
    `generateImages` во входе нет `card`; тесты профиля: фото 1536×2048 при профиле 896×1200
    проходит, карточка 896×1201 и 897×1200 с `exact` — отказ; `npm test` зелёный.

- [x] **B7.4. Запись содержимого сборки в `generation_cards`.** Исполнено и сведено 2026-10-03 (`2f64bc1`). Миграция
  `20261003100000_record_card_assembly.sql`.
  - **Целевой файл(ы):** новая миграция `supabase/migrations/<метка>_record_card_assembly.sql`,
    тест `supabase/tests/database/record_card_assembly.test.sql`, вызов в воркере (место — пункт
    7 шага B7.1).
  - **Файлы-контракты:** `20260901160000_snapshot_card_generation_only.sql` — как снимок пишется
    и почему он не перезаписывается · `20260901120000_card_layouts.sql` — RLS
    `generation_cards`.
  - **Границы:** снимок `layout` и `layout_id` не перезаписывать; RLS не ослаблять.
  - **Задача:** функция `record_card_assembly(target_generation uuid, assembled_content jsonb,
    assembled_font_map jsonb)`, `security definer`, `execute` только `service_role`; пишет
    `content` и `font_map`, обновляет `assembled_at`. Воркер передаёт `storedContent(...)` из
    B7.2 и карту шрифтов, с которой собирал.
  - **Критерий приёмки:** pgTAP: вызов service-role пишет оба поля; `authenticated` получает
    отказ; снимок `layout` после вызова не изменился. `npm run test:db` зелёный.

- [ ] **B7.5. Функция пересборки `card-rebuild` — бесплатно, без вендора.**
  - **Целевой файл(ы):** `supabase/functions/card-rebuild/index.ts` (новая), тест рядом.
  - **Файлы-контракты:** `card-preview/index.ts` — авторизация вызывающего, квота бесплатных
    операций (`consume_daily_quota`), `limitFromEnv`, `readFonts` · `filling.ts` —
    `cardFilling`, `fromStored` · `render.ts` — `renderCard`, `renderPreview` (обмер
    переполнений).
  - **Границы:** баланс и `ledger` не трогать; вендора не вызывать; снимок макета не менять.
  - **Задача:** у генерации проверить: принадлежит вызывающему (иначе 403), `kind = 'card'` и
    `status = 'done'` (иначе 400). Два режима по телу запроса:
    1. **Чтение** — `{ generationId }`: вернуть текущие тексты, свойства, `fontMap` и
       `fontOptions: Record<роль, гарнитура[]>` из `card_font_families` × `card_font_roles`
       (читает service-role: у таблиц RLS без политик). Без сборки и без квоты.
    2. **Пересборка** — `{ generationId, texts: { title, description }, properties, fontMap? }`:
       квота `rebuild:user:<id>`, потолок `REBUILD_DAILY_LIMIT` (по умолчанию 200, как у
       превью; исчерпана — 429). Кадр, вырез и знак — из `fromStored(generation_cards.content)`;
       содержимое — заново через `cardFilling(снимок, { новые тексты и свойства, кадр, вырез,
       знак })`, то есть свойства снова режутся по ёмкости, а `cut` возвращается в ответе.
       `fontMap` не задан — сохранённый; гарнитура, которой нет среди `fontOptions` своей
       роли, — 400. Сборка `renderCard` в размере снимка; переполнения — тем же обмером, что
       `renderPreview`; перезаписать `result-1.png`, `content` (через `record_card_assembly`),
       `font_map`, `title_of_card`/`description_of_card`. Ответ — подписанная ссылка на
       результат, `overflows`, `cut`.
  - **Критерий приёмки:** тест: чужая генерация — 403; генерация «фото» — 400; неизвестная
    гарнитура — 400; режим чтения отдаёт `fontOptions` по всем ролям; после пересборки баланс
    и число строк `ledger` не изменились; повтор с теми же текстами даёт побайтово тот же PNG.

- [ ] **B7.6. Экран результата: «Изменить текст», выбор шрифта, неактивная «Редактировать».**
  - **Целевой файл(ы):** `src/screens/Generation.tsx`, `src/features/generation/api.ts` (+ тесты
    рядом).
  - **Файлы-контракты:** `src/screens/Wizard.tsx` — как показаны отсечённые свойства и
    переполнения превью (тот же язык и вид предупреждений) ·
    `.github/instructions/react.instructions.md`.
  - **Границы:** артбордов под этот экран нет (модуль дизайна выключен) — новых компонентов
    дизайн-системы не заводить, собирать из существующих; каталог (`Catalog.tsx`) не трогать.
  - **Задача:** под карточкой — кнопка «Изменить текст»: форма с заголовком, описанием и списком
    свойств (тот же редактор, что в мастере), выпадающий выбор гарнитуры по каждой роли; форма
    наполняется режимом чтения `card-rebuild` (тексты, свойства, `fontMap`, `fontOptions`) —
    напрямую к таблицам шрифтов клиент не ходит. «Пересобрать» зовёт режим пересборки,
    показывает переполнения и отсечённые свойства словами и обновляет картинку. Кнопка «Редактировать» видна, `disabled`, с
    подсказкой «Редактор появится позже». Всё доступно с клавиатуры (NFR-07), работает на 360 px.
  - **Критерий приёмки:** тест экрана: форма отправляет правку и показывает переполнения из
    ответа; «Редактировать» `disabled`. Снимок экрана после пересборки — владельцу на приёмку.

- [ ] **B7.7. Тяжёлые макеты вне подбора до переезда сборки (решение Q-1, 2026-10-03).**
  - **Целевой файл(ы):** миграция `supabase/migrations/<метка>_card_layouts_edge_heavy.sql`,
    тест `supabase/tests/database/card_layouts_edge_heavy.test.sql`,
    `supabase/functions/_shared/card-layout/selection.ts` + `selection.test.ts`,
    `generation-worker/index.ts` (`selectLayout`), `card-preview/index.ts` (запросы подбора).
  - **Файлы-контракты:** `tools/card-pipeline/bench.mts` и `supabase/functions/card-bench/` —
    как гонять ряд и как выглядит отказ (`503` с пустым телом или `546` `WORKER_LIMIT`) ·
    `20260901170000_single_fallback_layout.sql` — единственный универсальный макет.
  - **Границы:** скоринг и ничью `selectCardLayout` не менять; язык макета и валидатор не
    трогать; фильтры не запрещать.
  - **Задача:** (1) прогнать `npm run cards:bench` в размере 1440×1920 три раза по всем макетам
    библиотеки; тяжёлый — макет, хоть раз давший `503` или `546`; список id с числами — в отчёт.
    (2) Миграция: `card_layouts.edge_heavy boolean not null default false` + `update` по списку
    (решение — миграцией, чтобы было в диффе), плюс `check`: универсальный макет не может быть
    тяжёлым. (3) В `selection.ts` — один построитель запросов подбора
    `layoutQueries(categoryId) → { candidates, fallback }` с фильтром `edge_heavy=is.false` в
    обоих; воркер и `card-preview` строят запросы только им — иначе превью обещает макет,
    которого платный прогон не выберет.
  - **Критерий приёмки:** pgTAP: `check` не даёт пометить универсальный макет тяжёлым;
    `selection.test.ts`: обе строки `layoutQueries` содержат `edge_heavy=is.false`; `grep -rn
    "card_layouts?" supabase/functions/generation-worker supabase/functions/card-preview` пуст
    (запросы строятся только построителем); повторный bench по нетяжёлым — 0 отказов из 3
    прогонов. Снять фильтр — одной миграцией, когда сборка переедет на коробку (ADR-0015).

### Блок B5 — арт-директор

- [x] **B5.0. Контракт арт-директора — НЕДЕЛИМ (Opus): необратимое решение (новая платная
  операция провайдера и её цена) + шов между репозиториями (откуда берётся карта занятости).**
  - **Итог:** [ADR-0018](../../docs/adr/0018-art-director-layout-patch.md) принят владельцем 2026-10-03
    по всем девяти пунктам; два — после доработки: правка принимается по частям, негодное —
    бесплатный сдвиг голого текста, и бесплатная предпроверка перед вызовом. Ветка
    `claude/m7-art-director-contract` ждёт мёрджа. Шаги B5.2–B5.11 — ниже.
  - **Целевой файл(ы):** новый ADR `docs/adr/0018-<slug>.md` (следующий свободный номер —
    проверить `ls docs/adr/`), строка в `docs/adr/README.md`, термины в `CONTEXT.md`. Тексты
    шагов B5.2… — в отчёте; план правит супервизор.
  - **Файлы-контракты:** `planning/reference/ART_DIRECTOR_BRIEF.md` (постановка владельца) ·
    `card-layout/occupancy.ts` (форма карты и `occupancyOfBox`) · `card-layout/svg.ts`
    (`overflowsOf`) · `supabase/functions/_shared/ai-provider/types.ts` (интерфейс провайдера,
    ADR-0005) · `card-layout/cutout.ts` (по сети едет вырез, а не маска) ·
    `planning/reference/UNIT_ECONOMICS.md` (себестоимость генерации).
  - **Границы:** кода не писать; язык макета не расширять; цену в баллах не менять — если
    операция меняет себестоимость заметно, это вопрос владельцу в терминах «карточка стоит
    столько-то баллов, было столько-то».
  - **Задача — решить и записать в ADR пять вещей:** (1) операция провайдера: имя, модель шлюза,
    вход (макет, свойства, тексты, карта занятости **в долях холста**) и выход (что именно
    арт-директору разрешено менять: боксы текстовых и ассет-слоёв, наполнение гнёзд
    `subtitle`/`kicker`/`brand`, выбор иконок из базы по имени); (2) проверка ответа:
    `validateLayout`, `overflowsOf`, `occupancyOfBox` для текстовых боксов, число повторов;
    (3) отказ — собирается макет библиотеки без правок, генерация не падает; (4) откуда карта
    занятости в изоляте: декодирование альфы выреза в Edge Function против ответа сервиса
    выреза с готовой картой (тогда — контракт новой операции сервиса) — с замером цены
    декодирования 1440×1920 в изоляте, если выбирается первое; (5) для каких генераций
    арт-директор зовётся (все карточки или только с товаром на кадре) и цена в рублях по
    `UNIT_ECONOMICS.md`.
  - **Критерий приёмки:** ADR со всеми пятью пунктами принят владельцем; в отчёте — тексты шагов
    B5.2… по шаблону микро-шага, каждый проходит диагностический вопрос.

- [x] **B5.1. Пересчёт «доли кадра → доли холста» — чистая функция.** Исполнено и сведено
  2026-10-03 (`79b4301`). Сигнатуры расширены размером кадра, пропорцию по сетке карты не
  восстановить: `frameToCanvas(map, frameLayer, canvas, frame)`, `canvasBoxToFrame(box,
  frameLayer, canvas, frame)`, `frameBoxToCanvas(...)`; `canvas` и `frame` — `{width, height}` в
  пикселях. `canvasBoxToFrame` не обрезает по боксу слоя `frame` — занятость текстового бокса
  проверять как `occupancyOfBox(frameToCanvas(...), box)`. `radius`/`rotate` слоя `frame` не учтены.
  - **Целевой файл(ы):** `supabase/functions/_shared/card-layout/frame-space.ts` (новый),
    `frame-space.test.ts` (новый).
  - **Файлы-контракты:** `card-layout/occupancy.ts` — `OccupancyMap` (всё в долях кадра) ·
    `card-layout/types.ts` — бокс слоя, `fit`, `focus` у слоя `frame` · `card-layout/svg.ts` —
    как `fit`/`focus` превращаются в `preserveAspectRatio` (это и есть арифметика, которую надо
    повторить).
  - **Границы:** `occupancy.ts` и `svg.ts` не менять; функция не знает про арт-директора.
  - **Задача:** `frameToCanvas(map, frameLayer, canvas) → OccupancyMap` в долях **холста**:
    учесть бокс слоя `frame`, режим `fit` (`cover` срезает часть кадра, `contain` оставляет поля)
    и `focus`; срезанные ячейки исчезают, поля вне кадра — свободны. Плюс
    `canvasBoxToFrame(box, frameLayer, canvas)` — обратный пересчёт для `occupancyOfBox`.
  - **Критерий приёмки:** тесты: кадр во весь холст с той же пропорцией — тождество; `cover` при
    более узком холсте срезает края симметрично при центральном `focus` и несимметрично при
    `focus` у края; `contain` даёт свободные поля; прямой и обратный пересчёт бокса — тождество
    в пределах 0,01.

- [x] **B5.2. Раннер маски — сэмплы альфы от сервиса выреза.** Исполнено и сведено 2026-10-03 (`ee8726f`).
  - **Целевой файл(ы):** `supabase/functions/_shared/card-layout/cutout.ts`, `cutout.test.ts`.
  - **Файлы-контракты:** [ADR-0018](../../docs/adr/0018-art-director-layout-patch.md), п. 4 — контракт
    `POST /mask` · `card-layout/occupancy.ts` — тип `MaskSamples` · `createCutoutRunner` в том же
    файле — образец формы, журнала и отказов.
  - **Границы:** `createCutoutRunner`, его таймаут и `occupancy.ts` не менять. Декодер PNG не
    заводить. Воркер не трогать.
  - **Задача:** `export type MaskRunner = (frame: ImageRef) => Promise<MaskSamples | null>` и
    `createMaskRunner(config: CutoutServiceConfig): MaskRunner`.
    - Запрос как у выреза: `POST config.endpoint`, тело — байты кадра из data-URI
      (`decodeDataUri`), `content-type` — его mime, `authorization: Bearer <secret>`,
      `AbortSignal.timeout` (по умолчанию `DEFAULT_TIMEOUT_MS`).
    - `204` → `null` без журнала.
    - `200` → прочитать `x-mask-width` и `x-mask-height` как целые больше нуля, тело как
      `Uint8Array`. Если длина тела ≠ `width × height`, или `max(width, height) ≠ 256`, или
      `|width/height − frame.width/frame.height| > 1/height` → журнал `Маска: …` и `null`. Иначе —
      `{ width, height, alpha }`.
    - Любой другой статус или исключение → журнал `Маска: …` и `null`.
  - **Критерий приёмки:** тесты на подменном `fetch`, по одному на ветку: `204`, `500`, исключение
    `fetch`, тело короче заявленного, длинная сторона не 256, пропорция не кадра, корректный ответ
    192×256 для кадра 1440×1920 (`occupancyOf` от результата не бросает); запрос несёт
    `authorization` и тело-кадр. `npm test` и `npm run lint` — каждая отдельной командой.
    Мутационная проверка по контракту исполнителя.

- [x] **B5.3. (Репозиторий `ovr58/cutout_runner`) Операция `POST /mask`.** Код сведён в локальный
  `main` `cutout_runner` 2026-10-03 (`4312734`, не запушен): маршрут открыт и в `deploy/nginx.conf`,
  `/mask` делит с `/cutout` зону `limit_req` и очередь. Деплой, `nginx -t` и замер времени — после
  включения коробки владельцем (блок команд — `deploy/README.md`, «Включение POST /mask»).
  - **Целевой файл(ы):** обработчик операций сервиса и его тесты — тот же модуль, где живёт
    `POST /cutout`.
  - **Файлы-контракты:** ADR-0018 этого репозитория, п. 4 — контракт целиком · ADR-0016 — граница
    доверия (тот же секрет, сравнение по постоянному времени, лимиты nginx).
  - **Границы:** `POST /cutout`, модель и очередь «один инференс за раз» не менять. Деплой на
    коробку — только командой владельца; коробка на паузе с 2026-10-03, включение — отдельным
    запросом владельцу.
  - **Задача:** те же вход, авторизация и очередь, что у `/cutout`. Если для кадра `/cutout`
    ответил бы `204`, ответить `204` — общим кодом, а не копией условия. Иначе взять альфу маски в
    размере кадра (до наложения на кадр), уменьшить до длинной стороны 256 в пропорции кадра
    (короткая — `round(256 × короткая / длинная)`) усреднением по площади, без порога. Ответ:
    `200`, `application/octet-stream`, `x-mask-width`, `x-mask-height`, тело — байты построчно
    сверху вниз.
  - **Критерий приёмки:** тест — кадр 1440×1920 даёт 192×256 и тело длиной 49 152; есть хотя бы
    один полутон (не только 0 и 255); без секрета — `401`; кадр без товара — `204`. Готовый блок
    команды деплоя — владельцу. После деплоя: один вызов на коробке, время в отчёт (открытое
    условие ADR-0018).

- [ ] **B5.4. Правка арт-директора: форма, предпроверка, постановка, применение — чистые функции.**
  - **Целевой файл(ы):** `supabase/functions/_shared/card-layout/direction.ts` (новый),
    `direction.test.ts` (новый).
  - **Файлы-контракты:** ADR-0018, п. 1, п. 2 (проверки 1–2) и п. 5 · `card-layout/types.ts` —
    `CardLayout`, `Layer`, `Box`, `CardContent`, `ImageRef` · `card-layout/features.ts` —
    `boundTextSlots`, `flattenLayers` · `card-layout/occupancy.ts` — `OccupancyMap`,
    `occupancyOfBox` · `card-layout/validate.ts` — `resolveLayout`, `PlacedLayer`.
  - **Границы:** без ввода-вывода. `types.ts`, `validate.ts`, `occupancy.ts` не менять.
    Переполнение, налегание и сборку итога не делать — это B5.5.
  - **Задача:**
    1. Тип `CardDirection` — дословно из ADR-0018, п. 1. `DIRECTED_SLOTS = ['subtitle', 'kicker',
       'brand'] as const`, `EDITABLE_TYPES = ['text', 'asset', 'group', 'shape'] as const`,
       `BARE_TEXT_LIMIT = 0.15`, `PLAQUE_COVER = 0.9`.
    2. `iconProps(layout): number[]` — отсортированные уникальные `index` у слоёв (через
       `flattenLayers`) с `bind.kind === 'prop' && bind.part === 'icon'`.
    3. `bareTextLayers(placed: PlacedLayer[]): PlacedLayer[]` — текстовые слои, для которых нет
       `shape` с меньшим `z`, у которого площадь пересечения боксов ≥ `PLAQUE_COVER` × площади бокса
       текста.
    4. `behindCutout(placed, text, hasCutout): boolean` — `hasCutout` и среди `placed` есть
       `cutout` с `z` больше, чем у `text`.
    5. `topLevelOf(layout, layerId): string` — `id` слоя верхнего уровня, внутри которого (или
       которым) лежит слой. Обход `layout.layers` с детьми групп.
    6. `textsOnProduct(layout, content, canvasMap, hasCutout): { layerId: string; topId: string;
       occupancy: number }[]` — по `resolveLayout(layout, content).layers`: голые, не за вырезом, с
       `occupancyOfBox(canvasMap, box) > BARE_TEXT_LIMIT`.
    7. `directionNeed({ layout, content, canvasMap: OccupancyMap | null, hasCutout }): 'full' |
       'content' | 'none'`: `'full'`, если `canvasMap !== null` и `textsOnProduct(...)` не пуст;
       иначе `'content'`, если `boundTextSlots(layout)` пересекается с `DIRECTED_SLOTS` или
       `iconProps(layout)` не пуст; иначе `'none'`.
    8. `directorBrief(input)`, где `input = { mode: 'full' | 'content', layout, texts: { title, body
       }, properties: {label, value}[], wishes, canvasMap: OccupancyMap | null, icons: { name,
       description }[], fillSlots: TextSlot[], iconPropsAsked: number[], complaints: string[] }`.
       Всегда: `mode`, `texts`, `properties`, `wishes`, `fillSlots`, `iconProps: iconPropsAsked`,
       `icons`, `complaints`. Только при `mode === 'full'`: `canvas: {aspectW, aspectH}`; `layers` —
       верхний уровень в порядке `layout.layers`: `{ id, type, z, box, bind?, editable, role?,
       size?, lineCount?, contains? }` (`editable` — тип из `EDITABLE_TYPES`; `role`/`size`/
       `lineCount` — у text; `contains` — у group: привязки детей через `flattenLayers`);
       `map: canvasMap`.
    9. `parseDirection(raw: unknown, ctx) → { parts: DirectionParts; complaints: string[] }`, где
       `ctx = { layout, mode, propertyCount, iconNames: string[], source: string[] }` и
       `DirectionParts = CardDirection`. В `parts` — только части, прошедшие проверки 1–2
       ADR-0018, п. 2: форма — по каждой части; слова — по каждому гнезду (нормализация: нижний
       регистр, `ё → е`; слова — `\p{L}+`, числа — `\d+`). Бокс разрешён только при `mode ===
       'full'`. Повтор `id` отвергает все боксы этого `id`. Ответ не объект → пустые `parts` и одно
       возражение. Каждое возражение — строка по-русски с адресом части, например `бокс «title»:
       выходит за правый край (x + w = 1.08)` или `гнездо «kicker»: слова «хит» нет в описании`.
    10. `applyDirection(layout, direction): CardLayout` — новый объект, у слоёв верхнего уровня из
        `boxes` заменён `box`. Вход не мутирует.
    11. `directedContent(content, direction, iconRefs: Record<string, ImageRef>): CardContent` —
        `texts` дополнены строками из `direction.texts`; у `props[prop]` стоит `icon =
        iconRefs[name]`, если имя не `null` и есть в `iconRefs`.
  - **Критерий приёмки:** тесты, каждый отдельно:
    - `directionNeed`: `'full'` при голом заголовке на занятой половине карты; `'content'` при том
      же макете без карты; `'content'` при карте, где заголовок на плашке ≥ 90%; `'content'` при
      тексте с `z` ниже `cutout` и `hasCutout`; `'none'` для макета без гнёзд и иконок и без текста
      на товаре;
    - `directorBrief` в режиме `'content'` не содержит `layers` и `map`;
    - `parseDirection` в одном ответе принимает годную иконку и гнездо и отвергает бокс `frame` —
      `parts` содержит иконку и гнездо, `complaints` — одну строку про `frame`;
    - `parseDirection` отвергает по отдельности: бокс вложенного слоя, повтор `id`, выход за
      холст, сжатие до 0,4, бокс в режиме `'content'`, гнездо, не привязанное в макете, четвёртую
      строку, строку в 61 знак, число, которого нет в источнике, слово «хит» без него в источнике,
      иконку не из списка, индекс без слоя иконки;
    - `parseDirection` принимает «мужская» при источнике «мужской» и `{}`;
    - `applyDirection` не мутирует вход; `directedContent` ставит иконку и строки.

    `npm test`, `npm run lint` — каждая отдельной командой. Мутационная проверка.

- [ ] **B5.5. Сборка итога правки по частям — чистая функция.**
  - **Целевой файл(ы):** `supabase/functions/_shared/card-layout/direction-check.ts` (новый),
    `direction-check.test.ts` (новый).
  - **Файлы-контракты:** ADR-0018, п. 2 (проверки 3–6 и «Сборка итога») · `direction.ts` (B5.4) ·
    `validate.ts` — `validateLayout`, `resolveLayout` · `svg.ts` — `textProbes`, `overflowsOf`,
    `Overflow` · `occupancy.ts` — `occupancyOfBox`.
  - **Границы:** без растеризатора — обмерщик приходит параметром. `svg.ts`, `validate.ts`,
    `occupancy.ts` не менять.
  - **Задача:** `OVERLAP_SLACK = 0.05`. `overlapShare(a: Box, b: Box)` — площадь пересечения,
    делённая на площадь меньшего из двух. `combineDirection(input) → { direction: CardDirection;
    rejected: { part: string; reason: string }[] }`, где `input = { library, libraryContent,
    parts: CardDirection, size, fonts, measure, canvasMap: OccupancyMap | null, hasCutout,
    iconRefs: Record<string, ImageRef> }`. Порядок:
    1. **Переполнение, один обмер.** `A = overflowsOf(textProbes(library, libraryContent, …),
       measure)`. `B` — то же для `applyDirection(library, parts)` с `directedContent(libraryContent,
       parts, iconRefs)`. Для каждой записи `B`, у которой в `A` нет записи с тем же `layerId` и
       `kind` и `over` ≥ её `over`: отвергнуть бокс `topLevelOf(library, layerId)`, если он есть в
       `parts.boxes`; если слой привязан к гнезду из `DIRECTED_SLOTS`, отвергнуть строки этого
       гнезда. Причина — `строка «…» шире бокса на N%` или `блок выше бокса на N%`.
    2. **Круг сочетания.** Пока что-то меняется: `current = applyDirection(library, принятые
       боксы)`;
       (а) при `canvasMap !== null` для каждой записи `textsOnProduct(current, directedContent(...),
       canvasMap, hasCutout)`: предел — `max(BARE_TEXT_LIMIT, то же число у слоя в библиотеке)`
       (в библиотеке слой не на товаре — предел `BARE_TEXT_LIMIT`); при превышении отвергнуть
       принятые боксы `topId` этого слоя и всех `shape` верхнего уровня, бывших под ним в
       библиотеке (плашки, уехавшей из-под текста);
       (б) для каждой пары слоёв верхнего уровня, кроме `frame`, `cutout` и боксов `{0,0,1,1}`:
       `overlapShare(current) > max(OVERLAP_SLACK, overlapShare(library))` — отвергнуть из пары
       принятые боксы (если принят только один — его).
       Причины — `текст «…» лежит на товаре на N% (допустимо M%)` или `«a» налегает на «b» на N%
       (в библиотеке M%)`.
    3. **Валидатор.** `validateLayout(current)` не пуст → для каждого принятого бокса
       `validateLayout(applyDirection(library, {boxes:[этот], texts:{}, icons:[]}))`; непустой —
       бокс отвергнуть. Если итог всё ещё не валиден — отвергнуть все боксы.
    4. Вернуть принятые боксы, гнёзда и иконки (иконки отвергаются только формой — в B5.4) и
       список `rejected`.
  - **Критерий приёмки:** тесты на фикстурах с подменным `measure` (ширина = длина строки ×
    константа): ответ без изменений — пусто в `rejected`; сужение бокса до переполнения отвергает
    только этот бокс, иконка и гнездо остаются; переполнение, которое было и у библиотеки, не
    отвергается; не влезающее гнездо отвергает строки гнезда; голый заголовок, перенесённый на
    товар, отвергается, а сдвиг модуля в том же ответе принят; уезжающая из-под заголовка плашка,
    после которой заголовок голый на товаре, отвергается; заголовок, наехавший на модуль,
    отвергается по налеганию; текст с `z` ниже `cutout` при `hasCutout` не проверяется на товар;
    без карты занятость не проверяется. `npm test`, `npm run lint` — отдельно. Мутационная
    проверка.

- [ ] **B5.11. Сдвиг голого текста в свободную зону — чистая функция.**
  - **Целевой файл(ы):** `supabase/functions/_shared/card-layout/direction-shift.ts` (новый),
    `direction-shift.test.ts` (новый).
  - **Файлы-контракты:** ADR-0018, п. 3 («Сдвиг без ИИ») · `direction.ts` — `textsOnProduct`,
    `applyDirection`, `topLevelOf` · `direction-check.ts` — `overlapShare`, `OVERLAP_SLACK`.
  - **Границы:** без растеризатора и без ИИ. Размер бокса не менять.
  - **Задача:** `SHIFT_LIMIT = 0.25`. `shiftBareText({ library, layout: текущий, content,
    canvasMap, hasCutout }) → { boxes: { layerId: string; box: Box }[] }`.
    - Для каждого уникального `topId` из `textsOnProduct(layout, content, canvasMap, hasCutout)`
      в порядке `layout.layers`: бокс `b` этого слоя верхнего уровня.
    - Для каждой зоны `z` из `canvasMap.free` по порядку, если `z.w ≥ b.w` и `z.h ≥ b.h`:
      `x' = clamp(b.x, z.x, z.x + z.w − b.w)`, `y'` — так же; смещение `|x' − b.x| + |y' − b.y|`.
    - Годно, если смещение ≤ `SHIFT_LIMIT`, все голые тексты этого слоя после сдвига имеют
      `occupancyOfBox ≤ BARE_TEXT_LIMIT`, и `overlapShare` с каждым другим слоем верхнего уровня
      (кроме `frame`, `cutout`, боксов `{0,0,1,1}`) ≤ `max(OVERLAP_SLACK, overlapShare в library)`.
    - Из годных — наименьшее смещение, при равенстве — первая зона. Сдвиг применяется к `layout`
      сразу, до следующего слоя, чтобы соседи видели новое положение.
    - `canvasMap === null` → пусто.
  - **Критерий приёмки:** тесты: заголовок на товаре со свободной зоной рядом сдвигается в
    ближайшую точку зоны; зона дальше 0,25 не используется; зона уже бокса не используется; сдвиг,
    наезжающий на модуль, не выбирается — берётся следующая зона; два слоя на товаре: второй
    учитывает новое положение первого; без карты — пусто. `npm test`, `npm run lint` — отдельно.
    Мутационная проверка.

- [ ] **B5.6. Операция провайдера `directCard`.**
  - **Целевой файл(ы):** `supabase/functions/_shared/ai-provider/types.ts`, `aitunnel.ts`,
    `aitunnel.test.ts`, `stub.ts`, новая миграция
    `supabase/migrations/<метка>_generation_costs_direct_card.sql`, тест
    `supabase/tests/database/generation_costs_direct_card.test.sql`.
  - **Файлы-контракты:** ADR-0018, п. 1 · ADR-0005 · `20260830000000_generation_costs.sql` —
    проверка `operation` · `direction.ts` — `DirectorBrief`, `CardDirection`.
  - **Границы:** промпты остальных операций, модель изображений и резерв не трогать. Ответ в
    провайдере не разбирать — разбор только в `parseDirection`.
  - **Задача:**
    1. В `AiProvider` — `directCard(input: { brief: DirectorBrief }): Promise<Record<string,
       unknown>>`. В `ProviderUsage['operation']` — `'directCard'`.
    2. В `aitunnel.ts` — `chatJson(config, DIRECT_CARD_SYSTEM, JSON.stringify(input.brief), {
       operation: 'directCard', onUsage })`. Один системный промпт на оба режима, по-русски, по
       пунктам: роль — арт-директор готового макета; поле `mode`: при `'content'` вернуть только
       `texts` и `icons`, при `'full'` ещё и `boxes`; координаты — доли холста, `map.cells` —
       занятость ячеек товаром 0…1, `map.free` — свободные места; двигать только слои с
       `editable: true`, бокс внутри [0, 1], размер 0,5–1,5 исходного; голый текст не класть на
       занятые ячейки, кроме слоёв за `cutout`; блоки не накладывать друг на друга; гнёзда из
       `fillSlots` — только словами из `texts`, `properties`, `wishes`, 1–3 строки до 60 знаков,
       ничего не придумывать; иконки — только имена из `icons` для индексов из `iconProps`,
       `null`, если ни одна не подходит; при непустом `complaints` — исправить перечисленное и
       вернуть только запрошенные части; ответ — строго JSON `{"boxes":[{"layerId":"…","box":{"x":…,
       "y":…,"w":…,"h":…}}],"texts":{…},"icons":[{"prop":0,"icon":"…"}]}`.
    3. Заглушка возвращает `{}`.
    4. Миграция: пересоздать проверку `generation_costs.operation` с добавленным `'directCard'`.
  - **Критерий приёмки:** `aitunnel.test.ts` на подменном `fetch`: текстовая модель,
    `response_format: json_object`, тело пользователя — `JSON.stringify(brief)`, `onUsage` с
    `operation: 'directCard'`. pgTAP: `'directCard'` вставляется, `'foo'` отвергается. `npm test`,
    `npm run lint`, `npm run test:db` — каждая отдельно.

- [ ] **B5.7. Цикл арт-директора по ступеням — чистая функция с внедрёнными зависимостями.**
  - **Целевой файл(ы):** `supabase/functions/_shared/card-layout/director-run.ts` (новый),
    `director-run.test.ts` (новый).
  - **Файлы-контракты:** ADR-0018, пп. 2, 3, 5 · `direction.ts`, `direction-check.ts`,
    `direction-shift.ts` · `frame-space.ts` (B5.1) — `frameToCanvas(map, frameLayer, canvas,
    frame)`, где `canvas` и `frame` — `{width, height}` в пикселях.
  - **Границы:** без сети и базы — всё приходит параметрами. Воркер не трогать. `radius` и
    `rotate` слоя `frame` пересчёт не учитывает (известное ограничение B5.1, не чинить).
    `canvasBoxToFrame` и `frameBoxToCanvas` не нужны: занятость — только `occupancyOfBox(canvasMap,
    box)` в долях холста.
  - **Задача:** `DIRECTOR_ATTEMPTS = 2`. `runDirector(input) → Promise<{ stage: 1 | 2 | 3 | 4; mode:
    'full' | 'content' | 'none'; calls: number; direction: CardDirection | null; layout:
    CardLayout; content: CardContent; rejected: { part, reason }[]; shifted: number; reason?:
    string }>`, где `input = { layout, content, texts, properties, wishes, frameMask: OccupancyMap |
    null, frame: ImageRef, size: {width, height}, hasCutout, icons: {name, description}[],
    loadIcons: (names) => Promise<Record<string, ImageRef>>, ask: (brief) => Promise<Record<string,
    unknown>>, fonts, measure }`. Шаги:
    1. `frameLayer` — первый слой `frame` верхнего уровня. `canvasMap = frameMask && frameLayer ?
       frameToCanvas(frameMask, frameLayer, size, { width: frame.width, height: frame.height }) :
       null`.
    2. `mode = directionNeed(...)`. При `'none'` → ступень 4, `direction: null`, `calls: 0`.
    3. Попытка 1: `directorBrief({ mode, fillSlots: привязанные DIRECTED_SLOTS, iconPropsAsked:
       iconProps(layout), complaints: [] })` → `ask`. Исключение → ступень 4, `reason: 'провайдер:
       …'`, без повтора. Затем `parseDirection` → `loadIcons(имена)` → `combineDirection` →
       принятое.
    4. Повтор (не больше одного) — только если после попытки 1 при `mode === 'full'`
       `textsOnProduct(applyDirection(layout, принятое))` не пуст, или отвергнуто хотя бы одно
       гнездо. Режим повтора: `'full'`, если остался текст на товаре, иначе `'content'`. `fillSlots`
       — только отвергнутые гнёзда, `iconPropsAsked` — `[]`, `complaints` — возражения попытки 1.
       Принятое из повтора докладывается к принятому, боксы проходят `combineDirection` заново
       вместе с принятыми.
    5. Если `canvasMap !== null`, вызывается `shiftBareText({ library: layout, layout:
       applyDirection(layout, принятое), … })`, его боксы добавляются к `direction.boxes`.
    6. Ступень: 1 — всё запрошенное принято и сдвигов нет; 2 — принято что-то, но не всё; 3 —
       ИИ-боксов нет, а сдвиги есть (ступень по боксам, итог в `rejected`); 4 — патч пуст,
       `direction: null`.
    7. `layout` и `content` на выходе — `applyDirection(layout, direction)` и
       `directedContent(...)`, при ступени 4 — входные.
  - **Критерий приёмки:** тесты с подменным `ask`: `'none'` — ноль вызовов, ступень 4; годный
    ответ — один вызов, ступень 1; ответ с годной иконкой и негодным боксом заголовка, повтор годен
    — два вызова, второй `brief.complaints` непуст, ступень 1 или 2 по итогу; два негодных ответа
    по боксу, сдвиг находит зону — ступень 3, `shifted = 1`; `ask` бросает — один вызов, ступень 4;
    кадр 1024×1024 в макете 3:4 с `fit: 'cover'` — в `brief.map` карта холста (`frameToCanvas`
    вызван с размером кадра, а не холста); без маски — режим `'content'` при гнёздах в макете.
    `npm test`, `npm run lint` — отдельно. Мутационная проверка.

- [ ] **B5.8. Арт-директор в воркере и запись патча.**
  - **Целевой файл(ы):** `supabase/functions/generation-worker/index.ts`,
    `supabase/functions/_shared/card-layout/render.ts`, новая миграция
    `supabase/migrations/<метка>_generation_cards_direction.sql`, тест
    `supabase/tests/database/generation_cards_direction.test.sql`.
  - **Файлы-контракты:** ADR-0018, пп. 3–5 · `director-run.ts` (B5.7) · `cutout.ts` —
    `createMaskRunner` (B5.2), `createCutoutRunner` · `render.ts` — `renderPreview` (обмер
    `withResvg(...).getBBox()`) · `20260901120000_card_layouts.sql` — `generation_cards` и RLS ·
    `20261003100000_record_card_assembly.sql` — `record_card_assembly` как образец.
  - **Границы:** порядок B7.1 сохраняется: арт-директор встаёт между содержимым (пункт 3 B7.1) и
    `renderCard` (пункт 4). Снимок `layout` не перезаписывать. Превью не трогать. Таймауты выреза и
    маски не менять. Генерация на любой ступени не падает.
  - **Задача:**
    1. `render.ts`: экспорт `measureText(): Promise<(svg: string) => number>`; `renderPreview`
       пользуется им, поведение не меняется.
    2. Миграция: `generation_cards.direction jsonb null` (комментарий: «итоговый патч арт-директора
       и сдвига, ADR-0018; null — ступень 4») и `record_card_direction(target_generation uuid,
       card_direction jsonb)` — `security definer`, `execute` только `service_role`, пишет только
       `direction`.
    3. Воркер при `CARD_DIRECTOR === 'on'`: маска и вырез — `Promise.all`; маска при заданных
       `CUTOUT_MASK_ENDPOINT` и `CUTOUT_SECRET`, иначе `null`; результат → `occupancyOf` или
       `null`; иконки — `card_icons` `name, description` при `status = 'готово'` (service-role),
       `loadIcons` по именам → `data:image/svg+xml;base64,…`; `runDirector({…, frame: images[0] как
       ImageRef, size: { width: profile.width, height: profile.height }, ask: (brief) =>
       provider.directCard({ brief }), measure: await measureText() })`; сборка —
       `renderCard(result.layout, result.content, …)`; журнал одной строкой: `Арт-директор: ступень
       ${stage} · постановка ${mode} · вызовов ${calls} · боксы a/b · гнёзда c/d · иконки e/f ·
       сдвинуто ${shifted} · отвергнуто: ${rejected.map(r => r.part + ' — ' + r.reason).join('; ')}`;
       при `direction !== null` после записи сборки (B7.4) — `record_card_direction`.
       При `CARD_DIRECTOR` не `on` — без маски, без вызова, сборка как раньше.
  - **Критерий приёмки:** pgTAP: service-role пишет `direction`; `authenticated` получает отказ;
    `layout` не изменился. Локальный стенд, заглушка (`{}`), `CARD_DIRECTOR=on`, секретов маски
    нет, макет с привязанным `subtitle`: `done`, в журнале `постановка content · вызовов 1`,
    `direction` — `null` (ступень 4). Без `CARD_DIRECTOR` — `direction` `null`, результат побайтово
    как без арт-директора. `npm test`, `npm run lint`, `npm run test:db` — каждая отдельно.

- [ ] **B5.9. Пересборка применяет правку арт-директора.**
  - **Целевой файл(ы):** `supabase/functions/card-rebuild/index.ts` и его тест.
  - **Файлы-контракты:** ADR-0018, п. 3 · `direction.ts` — `applyDirection`, `directedContent` ·
    B7.5 — режимы чтения и пересборки.
  - **Границы:** квоту, баланс, `ledger` и снимок не трогать. Вендора не звать. Арт-директора при
    пересборке не звать.
  - **Задача:** при непустом `generation_cards.direction`: макет сборки и обмера =
    `applyDirection(снимок, direction)`; содержимое = `directedContent(cardFilling(…), direction,
    иконки из card_icons по именам из direction)`; `direction` не перезаписывается; `null` —
    поведение B7.5 без изменений.
  - **Критерий приёмки:** тест: генерация с `direction`, сдвигающим бокс заголовка, пересобирается
    с тем же сдвигом (бокс заголовка в `resolveLayout` равен боксу из `direction`); повтор даёт
    побайтово тот же PNG; генерация с `direction = null` — как раньше. `npm test`, `npm run lint` —
    отдельно.

- [ ] **B5.10. ⚠️ Платно. Пробный прогон арт-директора, доля полной постановки и цена в модели.**
  - **Целевой файл(ы):** каталог прогона `bench/runs/director-<дата>/`, страница сравнения
    «библиотека / с правкой», строка в `planning/reference/UNIT_ECONOMICS.md` §10.
  - **Файлы-контракты:** ADR-0018, п. 5 · `bench/README.md` · `generation_costs` по `operation =
    'directCard'` · журнал функции — строки `Арт-директор: …` (доступ — analytics API, как к
    `function_logs`).
  - **Границы:** бюджет разрешён владельцем 2026-10-03 (10 карточек, 4–10 ₽ за арт-директора
    поверх генераций); запуск — по его слову, когда B5.3 задеплоена. Логи вендора включить **до**
    прогона. Продуктовый код не менять. `CARD_DIRECTOR` в стейдже включает владелец.
  - **Задача:** прогнать 10 карточек разных категорий при включённом арт-директоре и задеплоенной
    `/mask`; по каждой: постановка, ступень, вызовов, сумма `cost_rub`, PNG с патчем и PNG
    библиотеки на том же кадре (пересборка с `direction = null` в оснастке); страница сравнения для
    владельца; в `UNIT_ECONOMICS.md` §10 — строка «арт-директор»: доля полной постановки `p`, доля
    повторов, средняя фактическая цена на карточку, пересчитанная себестоимость.
  - **Критерий приёмки:** таблица «карточка · постановка · ступень · вызовов · ₽»; `p` и средняя
    цена против оценки ADR (30–60%, 0,19–0,29 ₽); вердикт владельца на странице; решение о
    `CARD_DIRECTOR=on` в стейдже записано в план.

### Фаза C — приёмка и наполнение

- [x] **C1. Механическая приёмка на каждой сборке.** Исполнено и сведено 2026-10-03 (`922bcfb`).
  - **Целевой файл(ы):** `supabase/functions/_shared/card-layout/svg.test.ts` (детерминизм
    SVG, K-3), `supabase/functions/_shared/card-layout/text-check.ts` + тест (новые; проверка
    дословности), `generation-worker/index.ts` (вызов проверки после сборки).
  - **Файлы-контракты:** `card-layout/validate.ts` — `resolveLayout` (что реально легло в
    кадр) · `card-layout/svg.ts` — `composeSvg`.
  - **Границы:** не трогать язык макета; проверка не должна вызывать растеризацию второй раз.
  - **Задача:** (1) в `svg.test.ts`: `composeSvg` с одним входом 20 раз подряд даёт одинаковую
    строку; детерминизм PNG — два прогона `npm run cards:roundtrip` подряд и сравнение sha256
    всех `*.rebuilt.png` (растеризатор под vitest не поднимается — он тянет npm-wasm для Deno).
    (2) `textMismatches(layout, content) → TextSlot[]` в `text-check.ts`: для гнёзд `title` и
    `body` склеить размещённые прогоны `resolveLayout` этого гнезда через один пробел и сравнить
    с исходным текстом после схлопывания пробельных символов; не совпало — гнездо в списке.
    Воркер после `renderCard` зовёт её и при непустом списке бросает исключение с именами гнёзд
    (баллы вернёт `fail_generation`). (3) В `svg.test.ts`: сборка без логотипа и без иконок
    даёт валидный SVG и непустой список снятых слоёв.
  - **Критерий приёмки:** тесты (1)–(3) зелёные, sha256 двух прогонов совпадают; мутация
    «отрезать от заголовка последний символ перед сборкой» роняет тест `text-check`.

- [ ] **C2. ⚠️ Платно. Замер кадров с человеком (K-4).**
  - **Целевой файл(ы):** `bench/run.mjs` (режим карточки, если его нет), каталог прогона
    `bench/runs/hands-<дата>/`, таблица итога в отчёте.
  - **Файлы-контракты:** `bench/README.md` — формат выборки и порядок прогона · `bench/run.mjs` —
    прогон через боевой путь Edge Functions · `card_layouts.hands_hidden` — признак «кисти
    скрыты».
  - **Границы:** только стейдж или локальный стенд с живым вендором; бюджет и число кадров —
    из разрешения владельца, без него не запускать; логи вендора включить **до** прогона;
    продуктовый код не менять.
  - **Задача:** прогнать генерации карточек со сценариями показа «на модели» поровну по
    макетам с `hands_hidden = true` и `false`; для каждой генерации записать `layout_id` из
    `generation_cards` и признак кистей; собрать страницу с кадрами, где владелец отмечает
    дефект анатомии на каждом.
  - **Критерий приёмки:** таблица «макет · кисти скрыты · кадров · дефектов (по отметкам
    владельца)» и фактическая цена прогона рядом с разрешённым бюджетом.

- [ ] **C3. Пополнение библиотеки образцами Ozon и Я.Маркета.**
  - **Целевой файл(ы):** `tools/card-pipeline/samples/<площадка>-*.json`, строки `card_layouts`
    через `npm run cards:layouts push`, исходник витрины `docs/design/card-library/`.
  - **Файлы-контракты:** `tools/card-pipeline/README.md` — порядок разбор → теги → `push` ·
    `tools/card-pipeline/parse.mts` — проверка содержимого на границе.
  - **Границы:** язык макета не расширять без образца, который без нового слова не выражается
    (тогда — стоп и отчёт); старт только когда владелец положил отобранные образцы в
    `bench/samples/<набор>/` и разрешил платный Batch API.
  - **Задача:** `npm run cards:parse -- submit | status | fetch` по новому набору; теги
    `npm run cards:layout-tags` и подтверждение владельцем в витрине V-12; `push`; витрину
    переиздать по тому же URL.
  - **Критерий приёмки:** `npm run cards:roundtrip` собирает все макеты библиотеки без
    возражений валидатора; в `card_layouts` у новых строк площадка Ozon или Я.Маркет; витрина
    показывает новые счётчики.

- [ ] **C4. Приёмка вслепую.**
  - **Целевой файл(ы):** страница-артефакт приёмки с хранилищем вердиктов; итог — в этот план.
  - **Файлы-контракты:** решение 13 (порог — за владельцем) · `bench/samples/wb-starter/` —
    образцы для смешивания.
  - **Границы:** порог не назначать за владельца; карточки — только собранные боевым путём.
  - **Задача:** собрать не меньше 20 наших карточек и столько же образцов по тем же
    категориям, перемешать без подписей; на каждую — вердикт «годится на площадку / нет» и поле
    замечания; вердикты читать со страницы.
  - **Критерий приёмки:** доля «годится» у наших карточек против доли у образцов и порог
    владельца записаны в план; карточки ниже порога — списком с замечаниями.

## Вопросы владельцу

- **O-6. Кнопка «Редактировать».** Искать кандидата в сторонние редакторы уже сейчас или только
  держать точку подключения? До ответа кнопка неактивна (B7.6) — веху не блокирует.

## Verification

- Текст детерминирован: 20 сборок подряд побайтово одинаковы, заголовок и описание в кадре
  дословны (C1).
- Каждый выходной файл проходит `describeProfileMismatch` при **точном** размере профиля (B7.3).
- Отсутствующий ассет не ломает макет (K-3, C1).
- Пересборка бесплатна: баланс и `ledger` не меняются (B7.5).
- Ни один макет, допускаемый подбором, не убивает изолят в размере профиля (B7.7).
- US-01 проходит целиком на живом вендоре с пилотной библиотекой; FR-07 и FR-25 — на всех
  сборках.

## Порядок исполнения

Строка = одна сессия. Модель строки — наивысшая потребность её шагов; полоса — по модели,
ветка — по полосе (`AGENTS.md`). Пустая зависимость читается «запускать сразу».

| Сессия | Шаги | Модель · эффорт | Полоса | Ветка | Зависит от | Параллельно с |
| --- | --- | --- | --- | --- | --- | --- |
| M7-1 ✓ сведена 2026-10-03 | B7.1 (НЕДЕЛИМ, головной), B7.2, B7.3, B7.4 | Opus · high | доверенная | `claude/m7-card-assembly` | — | M7-2, M7-3 |
| M7-2 ✓ сведена 2026-10-03 | B5.0 (НЕДЕЛИМ) | Opus · high | доверенная | `claude/m7-art-director-contract` | — | M7-1, M7-3 |
| M7-3 ✓ сведена 2026-10-03 | B5.1 | Sonnet · medium | консервативная | `feature/m7-frame-space` | — | M7-1, M7-2 |
| M7-4 | B7.5, B7.6 | Sonnet · high | консервативная | `feature/m7-card-rebuild` | M7-1 сведена; B18 (BACKLOG) сведена | M7-5 |
| M7-5 ✓ сведена 2026-10-03 | C1 | Sonnet · high | консервативная | `feature/m7-mechanical-acceptance` | M7-1 сведена | M7-4 |
| M7-6 | B7.7 | Sonnet · high | консервативная | `feature/m7-edge-heavy` | M7-1 сведена; держит стенд (bench, test:db) | M7-4; с M7-5 и B18 — по времени (воркер, стенд) |
| M7-7a ✓ сведена 2026-10-03 | B5.2 | Sonnet · medium | консервативная | `feature/m7-mask-runner` | M7-2 сведена | M7-7b, M7-7m, M7-7c |
| M7-7m ✓ код сведён 2026-10-03, деплой — владелец | B5.3 (репозиторий `cutout_runner`) | Sonnet · medium | консервативная | `feature/mask-samples` (в `cutout_runner`) | M7-2 сведена; деплой и включение коробки — владелец | M7-7a, M7-7b, M7-7c |
| M7-7b | B5.4, B5.5, B5.11 | Sonnet · high | консервативная | `feature/m7-director-core` | M7-2 сведена | M7-7a, M7-7m, M7-7c |
| M7-7c | B5.6 | Sonnet · high | консервативная | `feature/m7-director-provider` | M7-2 сведена; держит стенд (`test:db`) | M7-7a, M7-7b, M7-7m; со стендом — по времени |
| M7-7d | B5.7, B5.8 | Sonnet · high | консервативная | `feature/m7-director-worker` | M7-7a, M7-7b, M7-7c сведены; держит стенд | — |
| M7-7e | B5.9 | Sonnet · medium | консервативная | `feature/m7-director-rebuild` | M7-4 и M7-7d сведены | M7-7f |
| M7-7f | B5.10 | Sonnet · high | консервативная | `feature/m7-director-probe` | M7-7d сведена; M7-7m задеплоена; слово владельца на запуск (бюджет разрешён) | M7-7e |
| M7-8 | C2 | Sonnet · high | консервативная | `feature/m7-hands-measure` | M7-6, M7-7f сведены; разрешение владельца на платный прогон | C3 |
| M7-9 | C3 | Sonnet · medium | консервативная | `feature/m7-library-ozon-ym` | образцы владельца в `bench/samples/`; разрешение на Batch API | C2 |
| M7-10 | C4 | Opus · medium | доверенная | `claude/m7-blind-acceptance` | всё выше сведено | — |
