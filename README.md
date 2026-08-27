# Merch Kit

Веб-сервис, в котором продавец загружает обычное фото товара и получает готовый продающий
контент: набор студийных изображений в выбранном сценарии показа («на модели», «как в
магазине», «раскладка сверху», «каталог») либо целиком карточку товара — карусель изображений
вместе с заголовком и описанием. Генерации складываются в личный каталог, оплата — внутренними
баллами.

**Статус: веха M1 — каркас — закрыта 2026-08-27; следующая M2 — Аккаунт.** Сборка, тема с
токенами под WCAG AA, логгер, конвейер миграций и связка фронтенд ↔ Edge Function работают
локально и в проде: <https://merchkit-xi.vercel.app>. Продуктовых экранов ещё нет — они
приезжают на M2. Дорожная карта — шесть вех M1…M6 в
[`planning/reference/00_GENERAL_PLAN.md`](planning/reference/00_GENERAL_PLAN.md), отчёт по
M1 — [`planning/archive/plans/m1-skeleton_2026-08-27.md`](planning/archive/plans/m1-skeleton_2026-08-27.md).

## Стек

React 18 + TypeScript, сборка Vite, SSR не используем
([ADR-0007](docs/adr/0007-vite-spa-no-ssr.md)) · Tailwind + shadcn/ui · Supabase (Postgres +
RLS, Auth, Storage, Realtime, Edge Functions на Deno) · AI-провайдер за абстракцией — вендор
сознательно не выбран ([ADR-0005](docs/adr/0005-ai-provider-abstraction.md)).

## С чего начать чтение

| Документ | Что там |
| --- | --- |
| [`docs/TZ.md`](docs/TZ.md) | **Что и зачем:** цель, роли, scope и не-scope, сценарии US-01…US-05, требования FR-01…FR-24, НФТ, риски, открытые вопросы |
| [`docs/SPEC.md`](docs/SPEC.md) | **Как устроено:** архитектура, стек и обоснование, модули и границы, данные, тестирование, грабли стека, handoff в планирование |
| [`docs/VISUALS.md`](docs/VISUALS.md) | **Все схемы и референсы** — единственный визуальный артефакт проекта (V-01…V-08) |
| [`docs/adr/`](docs/adr/README.md) | Необратимые решения |
| [`AGENTS.md`](AGENTS.md) | Канон правил для AI-агентов (полосы доверия, ветки, consult-first) |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Правила контрибьюции для людей: хук, ветки, коммиты, PR, ревью |
| [`CONTEXT.md`](CONTEXT.md) | Единый язык проекта: генерация, объект, сценарий показа, балл, журнал операций |
| [`planning/INDEX.md`](planning/INDEX.md) | Карта планов · [`planning/BACKLOG.md`](planning/BACKLOG.md) — отложенное с ценностью |

Исходное ТЗ заказчика — `docs/Техническое задание.pdf`.

## Ключевые инварианты

Три правила, нарушение которых стоит денег и доверия, — подробно в
[ADR-0006](docs/adr/0006-supabase-as-backend.md):

1. **Баланс меняется только сервером** и только в одной транзакции с записью в журнал
   `ledger`, у каждой записи — ключ идемпотентности. Клиенту баланс доступен на чтение.
2. **RLS включается в той же миграции, где создаётся таблица.** `anon`-ключ Supabase публичен
   by design — единственная защита данных это политики RLS, а не маршруты интерфейса.
3. **AI-провайдер не вызывается из браузера.** Ключи живут только в секретах Edge Functions,
   а сам вендор скрыт за интерфейсом `ai-provider`.

## Разработка

Требуется **Node 22** (версия зафиксирована в `.nvmrc` и `package.json`) и — для локального
Supabase — Docker Desktop.

```
nvm use                 # Node 22 из .nvmrc
npm install
cp .env.example .env    # заполнить VITE_SUPABASE_URL и VITE_SUPABASE_PUBLISHABLE_KEY

npm run dev             # дев-сервер Vite
npm run build           # сборка (tsc -b && vite build)
npm test                # тесты (Vitest)
npm run lint            # oxlint
```

Локальная часть Supabase (нужен Docker):

```
npx supabase start                    # локальные Postgres, Auth, Storage, Studio
npx supabase db reset                 # накатить миграции с нуля
npx supabase functions serve health   # Edge Function локально
```

На прод уезжает не база, а SQL: `npx supabase db push` применяет миграции к облачному
проекту, затем `npx supabase functions deploy`, затем сборка фронтенда — порядок обязателен
(`docs/SPEC.md` §8).

Ветки: прямые коммиты в `main` заблокированы хуком `githooks/pre-commit` (после клона его
надо поставить — см. [`CONTRIBUTING.md`](CONTRIBUTING.md)); на GitHub то же самое держит защита
ветки — [`docs/BRANCH_PROTECTION.md`](docs/BRANCH_PROTECTION.md). Конвенция веток и полосы
доверия — [`AGENTS.md`](AGENTS.md), процесс для людей — [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Что делать дальше

1. Веха **M2 — Аккаунт**: экраны из утверждённого канваса D1, `profiles` с RLS в той же
   миграции, подтверждение email. Перед вёрсткой перерисовать артборды D1 под токены,
   прошедшие контраст AA (см. отчёт по M1).
2. К вехе M3 закрыть номинал стартовых баллов **N**, цену генерации за объект и состав
   пакетов; к M6 — формулировки 24 сценариев показа. Перечень — [`docs/TZ.md`](docs/TZ.md) §11.
