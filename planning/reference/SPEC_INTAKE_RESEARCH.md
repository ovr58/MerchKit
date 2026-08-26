# SPEC_INTAKE_RESEARCH — разведка: как устроены ТЗ, спецификации и spec-driven интейк

Status: REFERENCE
Собрано: 2026-08-26 · метод: скил `research` (inline, без субагентов) · автор-сессия: Opus 5, Claude Code

> **Зачем этот файл.** Вход для опросника `docs/INTAKE_QUESTIONNAIRE.md` и шаблонов
> `docs/TZ.md` / `docs/SPEC.md` / `docs/VISUALS.md`. Без него опросник был бы «из головы».
> Каждое утверждение — со ссылкой на источник; там, где источник вторичный (обзор, а не сам
> стандарт), это помечено **[вторичный]**.
>
> **Вопрос разведки:** какие поля обязаны быть в ТЗ и спецификации, чтобы модель-планировщик
> могла построить генеральный план, не переспрашивая пользователя; и какие вопросы надо задать,
> чтобы эти поля заполнились.
>
> **Достаточный ответ:** список полей ядра + стековые дельты + известные грабли по профилям.

---

## 1. Форма требований: что берём из индустриальных стандартов

### ISO/IEC/IEEE 29148:2018 — стандарт requirements engineering

- Определяет **семейство документов**, различающихся аудиторией и уровнем детализации:
  BRS (business), StRS (stakeholder), OpsCon (operational concept), SyRS (system),
  **SRS (software)**. То есть «одно ТЗ на всё» — не соответствует стандарту: слои «зачем/что»
  и «как» разделены by design. [вторичный: [ReqView: ISO 29148 templates](https://www.reqview.com/doc/iso-iec-ieee-29148-templates/),
  [Modern Requirements: ISO 29148 Explained](https://www.modernrequirements.com/blogs/iso-29148-explained/)]
- **Синтаксис функционального требования — 5 частей:** `[условие] [субъект] [действие]
  [объект] [ограничение действия]`. Это готовый шаблон строки для `docs/TZ.md`.
  [вторичный: Modern Requirements, ReqView]
- **Качество измеримо:** 9 характеристик на отдельное требование + 5 на набор требований
  (полнота, непротиворечивость и т.п.). [вторичный: Modern Requirements]
- Текст стандарта в открытом доступе: [PDF ISO/IEC/IEEE 29148-2018](https://drkasbokar.com/wp-content/uploads/2024/09/29148-2018-ISOIECIEEE.pdf).

> **Берём:** разделение на два слоя (`TZ.md` = BRS/StRS-слой «что и зачем», `SPEC.md` =
> SyRS/SRS-слой «как») и 5-частный синтаксис требования.

### Volere Requirements Specification Template

- 27 секций, сгруппированных в: назначение продукта · стейкхолдеры · факты и допущения ·
  навязанные ограничения · функциональные · нефункциональные (usability, performance,
  operations, maintainability, security, culture, compliance) · project issues (open issues,
  off-the-shelf, риски, стоимость, миграция) · «waiting room» (идеи на потом).
  [Первичный: [volere.org — Requirements Specification Template](https://www.volere.org/templates/volere-requirements-specification-template/),
  [PDF ed.16](https://www.cs.uic.edu/~i440/VolereMaterials/templateArchive16/c%20Volere%20template16.pdf)]
- **Requirements shell / «snow card»** — поля атомарного требования: ID · тип · описание ·
  **rationale** (зачем) · **fit criterion** (мера, по которой тестировщик решает, выполнено ли).
  Fit criterion превращает «продукт должен быть удобным» в проверяемое утверждение.
  [Первичный: volere.org]
- **«Waiting room»** — секция для идей, которые не в этом релизе. Прямой аналог нашего
  `planning/BACKLOG.md` («развилки → backlog»).

> **Берём:** `fit criterion` как обязательное поле каждого требования в `docs/TZ.md`
> (иначе «проверяемое требование» из плана — пустой звук); группировку НФТ; waiting room →
> ссылка на `planning/BACKLOG.md`, а не вторая очередь.

### arc42 — структура архитектурного документа (12 разделов)

1. Introduction & Goals · 2. Constraints · 3. Context & Scope · 4. Solution Strategy ·
5. Building Block View · 6. Runtime View · 7. Deployment View · 8. Crosscutting Concepts ·
9. Architectural Decisions · 10. Quality Requirements · 11. Risks & Technical Debt ·
12. **Glossary («ubiquitous language»)**.
[Первичный: [arc42.org/overview](https://arc42.org/overview/)]

> **Берём:** скелет `docs/SPEC.md` ≈ сжатый arc42. Две секции **не копируем, а связываем**:
> §9 Architectural Decisions → уже есть `docs/adr/`; §12 Glossary → уже есть `CONTEXT.md` +
> `docs/GLOSSARY.md`. Дублировать их в спецификацию — раздвоить канон.

### C4 model — уровни архитектурной схемы

Четыре уровня: **System Context → Container → Component → Code**.
[Первичный: [c4model.com](https://c4model.com/), [c4model.com/faq](https://c4model.com/faq)]
C4 ложится внутрь arc42: §3 Context ≈ C4 L1, §5 Building Block View ≈ C4 L2/L3.
[вторичный: [пример arc42+C4](https://bitsmuggler.github.io/arc42-c4-software-architecture-documentation-example/)]

> **Берём:** в визуальный артефакт `docs/VISUALS.md` просим уровни **1–2** (контекст +
> контейнеры). Level 4 (Code) почти всегда устаревает быстрее, чем пишется, — не запрашиваем.

### Google design doc

Секции: **Context and Scope · Goals and Non-Goals · The Actual Design · Alternatives
Considered · Cross-cutting concerns** (безопасность, приватность, наблюдаемость).
Объём: 10–20 страниц для крупного, 1–3 для инкремента. Не писать вовсе, если решение
очевидно и трейд-оффов нет.
[Первичный: [Design Docs at Google — Malte Ubl](https://www.industrialempathy.com/posts/design-docs-at-google/)]

- **Non-goals** — это не «система не должна падать», а **то, что могло бы быть целью, но
  сознательно ею не является**. Это точная формулировка нашего «явного не-scope».
- **Alternatives Considered** — фиксировать трейд-оффы отвергнутых вариантов.

> **Берём:** «Goals / Non-Goals» дословно как формат раздела scope в `docs/TZ.md`;
> «Alternatives Considered» — в `docs/SPEC.md` (а если решение необратимо — в ADR).
> Также берём **правило меры**: маленький проект не обязан рожать 20 страниц.

### Amazon PR/FAQ («working backwards»)

Пресс-релиз на 1 страницу из будущего + FAQ на 2–5 страниц, разделённый на **внешний**
(вопросы клиента) и **внутренний** (осуществимость, стоимость, риски, метрики). Язык — без
жаргона и внутренних аббревиатур.
[Первичный: [workingbackwards.com — PR/FAQ process](https://workingbackwards.com/concepts/working-backwards-pr-faq-process/),
[инструкции и шаблон](https://workingbackwards.com/resources/working-backwards-pr-faq/)]

> **Берём:** входной вопрос опросника «опиши результат так, будто он уже готов и ты его
> анонсируешь» — самый дешёвый способ вытащить ценность и целевого пользователя у человека,
> который не умеет писать требования. **Не берём** сам формат PR как артефакт: у нас его
> место занимает раздел «Цель и пользователи» в `docs/TZ.md`.

### INVEST + user stories + Given/When/Then

- **INVEST**: Independent · Negotiable · Valuable · Estimable · Small · Testable.
- Формат истории: `Как <роль>, я хочу <возможность>, чтобы <ценность>`; критерии приёмки —
  `Given / When / Then`.
[вторичный: [GitScrum: User Story Writing](https://docs.gitscrum.com/en/best-practices/user-story-writing),
[LeanWisdom: INVEST в SAFe](https://www.leanwisdom.com/blog/crafting-high-quality-user-stories-with-the-invest-criteria-in-safe/)]

> **Берём:** формат сценария и Given/When/Then для критериев приёмки. Given/When/Then —
> это и есть стык с нашим скилом `verification-before-completion` и с TDD: критерий приёмки
> уже написан так, что из него делается тест.

### Lean Canvas (Ash Maurya) — 9 блоков

Problem · Solution · Unique Value Proposition · Unfair Advantage · Customer Segments ·
Key Metrics · Channels · Cost Structure · Revenue Streams.
[вторичный: [Miro: What is Lean Canvas](https://miro.com/strategic-planning/what-is-lean-canvas/),
[Whimsical: Lean Canvas (Ash Maurya format)](https://whimsical.com/templates/lean-canvas)]

> **Берём выборочно:** Problem · Customer Segments · Key Metrics — это «проблема, пользователь,
> метрика успеха» из ядра опросника. Блоки Revenue/Channels/Cost/Unfair Advantage —
> **не берём в ядро**: у большинства проектов, поднимаемых из этого шаблона (внутренний
> инструмент, pet-проект, утилита), они пустые и создают шум. Спрашивать их — только если
> пользователь сказал, что продукт коммерческий.

---

## 2. Чужие spec-driven реализации для AI-агентов

### github/spec-kit

Цепочка команд: `/speckit.constitution` → `/speckit.specify` → (опц. `/speckit.clarify`) →
`/speckit.plan` → `/speckit.tasks` → `/speckit.implement` → `/speckit.converge`.
Артефакты: `constitution.md` (принципы проекта) · `spec.md` (требования и user stories, «что
и зачем») · `plan.md` (техническая реализация, «как») · `tasks.md` (упорядоченный список задач).
[Первичный: [github/spec-kit](https://github.com/github/spec-kit),
[spec-driven.md](https://github.com/github/spec-kit/blob/main/spec-driven.md)]
[вторичный, про «статьи» конституции и слоты-плейсхолдеры:
[Microsoft Dev Blog](https://developer.microsoft.com/blog/spec-driven-development-spec-kit/),
[LPains deep dive](https://blog.lpains.net/posts/2025-12-07-deep-dive-into-speckit/)]

**Что подтверждает наш подход:**

- Разделение `spec` («что/зачем») и `plan` («как») — независимое подтверждение расслоения
  ISO 29148. У нас это `docs/TZ.md` / `docs/SPEC.md`.
- **Отдельный шаг прояснения** (`/clarify`, ранее `/quizme`) **перед** планированием —
  ровно наша фаза интервью. Рекомендуется запускать до `/plan`.

**Чего у них нет и что мы добавляем:**

- Явного механизма пометки недосказанного в артефакте (маркеров вида `[NEEDS CLARIFICATION]`)
  на странице репозитория не описано — `clarify` подаётся как отдельный ручной шаг, а не как
  сквозная валидация. У нас эту роль играют обязательные `> TODO(пользователь):` в шаблонах:
  модель обязана пометить пробел, а не выдумать ответ.
- **`constitution.md` нам не нужен** — его функцию уже несёт `AGENTS.md` (канон правил) плюс
  `.github/instructions/*`. Заводить второй свод принципов = раздвоить канон (ADR-0001).

### BMAD-METHOD

Роли-агенты и передача артефактов по цепочке: PM-агент из брифа делает **PRD** → агент-архитектор
из PRD делает **архитектуру** → dev-агент работает по «story files» со сфокусированным контекстом.
[Первичный: [docs.bmad-method.org — Workflow Map](https://docs.bmad-method.org/reference/workflow-map/),
[Agents](https://docs.bmad-method.org/reference/agents/)]

> **Берём идею handoff между ролями с разной «мощностью».** У нас нет отдельных агентов-ролей
> (и заводить их дорого — `docs/WORKING_RULES.md` §2), поэтому роль меняется **сменой
> модели/эффорта в той же сессии** — это и есть handoff-блок в `docs/SPEC.md`.

### Agent OS (buildermethods)

«Система для инъекции стандартов кодовой базы и написания лучших спек»: слой **standards**
(конвенции и паттерны команды) отделён от слоя **spec**; стандарты подаются агенту точечно,
«right standards at the right time», и работает поверх любого AI-инструмента.
[Первичный: [buildermethods/agent-os](https://github.com/buildermethods/agent-os),
[Agent OS v2](https://buildermethods.com/agent-os/v2), [3-Layer Context](https://buildermethods.com/agent-os/v2/3-layer-context)]

> **Подтверждает нашу раскладку:** «стандарты» ≈ `AGENTS.md` + `.github/instructions/*`
> (по `applyTo`-глобу — та самая точечная подача), «спека» ≈ `docs/SPEC.md`. Ничего нового
> заводить не нужно, нужно только связать их ссылками.

### anthropics/skills

Открытая спецификация формата (`agent-skills-spec.md`): скил = каталог с `SKILL.md`
(YAML-фронтматтер + инструкции).
[Первичный: [anthropics/skills](https://github.com/anthropics/skills),
[README](https://github.com/anthropics/skills/blob/main/README.md)]

> Наш `.claude/skills/_TEMPLATE/SKILL.md` уже этому соответствует. Вывод: новый скил
> `spec-intake` пишем в том же формате, ничего не изобретаем.

---

## 3. Стековая специфика и известные грабли (по профилям)

> Одна цель раздела: понять, **какие 5–12 вопросов меняют архитектуру** на каждом профиле.
> Всё, что не меняет архитектуру, в опросник не попадает.

### `web-react`

Развилка №1 — **SPA vs SSR-фреймворк**, и она определяет всё остальное (роутинг, данные,
деплой, SEO). Ориентир 2026: для контентных/публичных продуктов, где важны SEO и первая
отрисовка, — фреймворк с SSR/SSG (Next.js — самый распространённый в проде); для приложения
за логином (админки, дашборды) SEO не нужен, и SPA на Vite деплоится на любой статик-хост.
[вторичный: [patterns.dev — React Stack Patterns 2026](https://www.patterns.dev/react/react-2026/),
[Magehire: Next.js vs React SPA (2026)](https://www.magehire.com/blog/nextjs-vs-react-spa)]

**Грабли:** выбор «Next, потому что все так» для приложения за логином — платишь сложностью
серверного рантайма без выгоды; обратный случай — SPA для публичного контента и последующая
переклейка SEO костылями. Оба разворота дорогие → это кандидат в ADR, а не строка плана.

**Вопросы модуля:** публичный контент/SEO или за логином · SSR/SSG/ISR или чистый клиент ·
роутинг · состояние сервера (кэш запросов) vs состояние клиента · формы и валидация ·
дизайн-система/UI-кит · авторизация · целевые браузеры · **доступность: целевой уровень WCAG**.

### `react-native`

Развилка №1 — **Expo (managed / dev-builds) vs bare**. Ориентир 2026: разрыв почти закрыт —
Expo даёт полный доступ к нативным модулям через dev-builds и EAS-сборки, New Architecture
включена по умолчанию; начинать bare «ради контроля» = взять обслуживание до того, как контроль
понадобился.
[вторичный: [rnrescue: Expo SDK vs bare — решение, не религия](https://rnrescue.dev/blog/expo-sdk-vs-bare-react-native),
[PkgPulse: New Architecture, Fabric, TurboModules, Expo 2026](https://www.pkgpulse.com/guides/react-native-new-architecture-fabric-turbomodules-expo-2026)]

Развилка №2 — **New Architecture** (Fabric — новый рендерер, TurboModules — ленивые типизированные
нативные модули через CodeGen): не экспериментальная, по умолчанию с RN 0.76+ / Expo SDK 52+.
[вторичный: те же источники + [CoderCops: миграция на Fabric/JSI](https://blog.codercops.com/blog/react-native-new-architecture-fabric-jsi-2026)]

**Грабли:** нативная зависимость, несовместимая с New Architecture, обнаруживается уже после
выбора стека и способна вынудить eject; OTA-обновления и сторы имеют собственные правила;
push-уведомления и deep links тянут нативную конфигурацию на обеих платформах.

**Вопросы модуля:** Expo vs bare (и почему) · нужны ли кастомные нативные модули · целевые ОС
и минимальные версии · офлайн-режим и локальное хранилище · push · deep links ·
распространение (сторы / внутреннее) · OTA-обновления · **что из списка нативных зависимостей
уже известно**.

### `ios-xcode`

- **Signing & provisioning** — 4 ключевые настройки сборки: Code Signing Identity, Code Signing
  Style, Development Team, Provisioning Profile; Apple рекомендует автоматическое управление
  профилями. TestFlight требует distribution-сертификат и App Store distribution-профиль.
  [Первичный: [Apple QA1814 — automatically manage provisioning profiles](https://developer.apple.com/library/ios/qa/qa1814/_index.html)]
  [вторичный: [Kodeco — Code Signing & Provisioning](https://www.kodeco.com/books/ios-app-distribution-best-practices/v1.0/chapters/4-code-signing-provisioning)]
- **App Store Review Guidelines** — 5 разделов: Safety · Performance · Business · Design · Legal.
  Частые причины отказа: 2.1 App Completeness (плейсхолдеры, нерабочие URL, отсутствие демо-аккаунта
  для ревью) · 5.1 Privacy (нет политики приватности, сбор данных без согласия) · 3.1 Payments
  (цифровой контент в обход in-app purchase) · 4.2 Minimum Functionality («переупакованный сайт») ·
  5.1.1 Account Sign-In (логин там, где он не нужен; **обязательное удаление аккаунта из приложения**).
  [Первичный: [App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)]

**Грабли:** signing ломается не при разработке, а на первой раздаче (TestFlight); требование
«удаление аккаунта внутри приложения» и политика приватности всплывают на ревью, когда
переделывать дорого; «просто обёртка над сайтом» отклоняется по 4.2.

**Вопросы модуля:** минимальная версия iOS и устройства (iPhone/iPad/Mac Catalyst) ·
targets и schemes (dev/staging/prod) · signing: автоматический или ручной, есть ли Apple
Developer аккаунт и команда · распространение: App Store / TestFlight / enterprise / ad-hoc ·
нативные зависимости и способ их подключения (SPM/CocoaPods) · **есть ли аккаунты
пользователей** (→ обязательное удаление аккаунта) · собираются ли данные (→ политика
приватности и nutrition labels) · платный контент (→ in-app purchase).

### `backend-api`

Опора — **12-factor**: I Codebase · II Dependencies · III Config (в окружении) · IV Backing
Services (как присоединённые ресурсы) · V Build/Release/Run · VI Processes (stateless) ·
VII Port Binding · VIII Concurrency · IX Disposability · X Dev/Prod Parity · XI Logs (поток
событий) · XII Admin Processes.
[Первичный: [12factor.net](https://12factor.net/)]

**Вопросы модуля:** стиль API (REST/GraphQL/gRPC) и где живёт его контракт · хранилище и
миграции · аутентификация/авторизация · **уровень OWASP ASVS** (L1 базовый · **L2 —
рекомендуемый для большинства и для любых чувствительных данных** · L3 — критичные системы;
уровни кумулятивны) [вторичный: [OWASP Developer Guide — ASVS](https://devguide.owasp.org/en/03-requirements/05-asvs/)] ·
конфигурация и секреты · наблюдаемость (логи/метрики/трейсы) · нагрузка и целевые задержки ·
фоновые задачи/очереди · окружения и деплой.

### `cli`

Опора — Command Line Interface Guidelines: человекоориентированность · композируемость ·
следование конвенциям терминала · достаточная (не избыточная) речь · обнаруживаемость через
help и подсказки · robustness · именованные флаги вместо позиционных аргументов · машинный
вывод через `--json` · отключение цвета вне TTY · порядок приоритета конфигурации
(флаги → переменные окружения → конфиг проекта → конфиг пользователя → системный) ·
осторожность с catch-all подкомандами.
[Первичный: [clig.dev](https://clig.dev/)]

**Вопросы модуля:** одна команда или дерево подкоманд · интерактивный режим или только
неинтерактивный (CI) · формат вывода (человеческий + `--json`) · конфигурация и её приоритет ·
коды выхода · способ распространения (пакетный менеджер / бинарь / контейнер) · целевые ОС.

### `desktop`

**Вопросы модуля:** целевые ОС и минимальные версии · тулкит/фреймворк · упаковка и инсталлятор ·
автообновление · подпись кода и нотаризация (macOS) · где приложение хранит данные пользователя ·
доступ к ОС-ресурсам (файлы, устройства, автозапуск) · оффлайн-работа · нужен ли UI-аудит
(`tools/ui-audit/` — референс WinUI; для других платформ — новый `IUiDriver`, см. скил
`auditing-ui`).

### `data-ml`

Опора — практика документирования: **Model Cards** (назначение модели, целевые пользователи,
метрики, ограничения, этические соображения) и **Datasheets for Datasets** (мотивация, состав,
процесс сбора, известные смещения).
[Первичный: [Model Cards for Model Reporting (arXiv:1810.03993)](https://arxiv.org/pdf/1810.03993)]
[вторичный: [Hugging Face — landscape of ML documentation tools](https://huggingface.co/docs/hub/en/model-card-landscape-analysis)]

**Вопросы модуля:** источник и права на данные · разметка · воспроизводимость (сиды, версии
данных/кода) · метрика качества и порог приёмки · офлайн- vs онлайн-инференс · дрейф и
переобучение · приватность и персональные данные · вычислительный бюджет.

---

## 4. Сквозные (нефункциональные) требования — что спрашивать всегда

Группировка взята из Volere (usability · performance · operations · maintainability · security ·
culture · compliance) и сужена до проверяемых вопросов:

- **Производительность** — целевые задержки/размеры/объёмы, а не «должно быть быстро».
- **Доступность** — целевой уровень **WCAG**: A (базовый) · **AA** (то, что почти всегда
  подразумевают под «соответствием WCAG» в законах и договорах) · AAA (максимальный).
  [вторичный: [Level Access: WCAG levels](https://www.levelaccess.com/blog/ada-compliance-levels/),
  [Allyant: разница A/AA](https://allyant.com/blog/difference-between-wcag-2-a-aa-explained/)]
- **Безопасность** — уровень ASVS (см. `backend-api`), обращение с секретами.
- **Приватность** — какие персональные данные собираются, где хранятся, требуется ли политика.
- **Интернационализация** — языки, локали, форматы, RTL.
- **Наблюдаемость** — логи/метрики; в нашем каноне логирование только через логгер проекта.

---

## 5. Визуальный слой: почему отдельный артефакт и почему он один

Ни один из разобранных источников не выносит схемы в отдельный файл: arc42 держит их внутри
разделов, C4 описывает только сами диаграммы, Google design doc просит «system-context diagram»
внутри раздела дизайна. Но у всех у них документ — один. У нас документов **два** (`TZ.md` и
`SPEC.md`), и одна и та же схема нужна обоим: сценарий из ТЗ и модуль из спецификации ссылаются
на одну картинку.

Отсюда решение (ADR-0004): визуальный слой выносится в **`docs/VISUALS.md`** — единственный
артефакт, на который ссылаются оба документа, а не копия схемы в каждом.

- **Диаграммы — текстом (Mermaid), а не картинкой.** Текст диффится, правится точечно и не
  требует внешнего редактора; картинка требует пересборки и порождает «а какая из них свежая».
  Mermaid рендерится в GitHub и в Claude-артефактах нативно.
- **Скриншоты и референсы — бинарники** в `docs/assets/`, имя файла привязано к ID визуала.
- **Стабильные ID (`V-01`, `V-02`, …)** — это то, чем пользователь адресует правку («поменяй
  на схеме V-03 …»), и то, чем на визуал ссылаются `TZ.md` / `SPEC.md`.
- **Правило единственности:** файл переписывается на месте. Никаких `VISUALS_v2.md`,
  `VISUALS_old.md`, `SPEC_схемы.md` — иначе через две итерации никто не знает, какая версия
  схемы актуальна, а это ровно та болезнь, от которой лечит `planning/INDEX.md`.
- Уровни C4: берём **L1 (контекст)** и **L2 (контейнеры)**; L3 — по необходимости; **L4 (код)
  не заводим** — устаревает быстрее, чем пишется.

---

## 6. Выводы, которые прямо ложатся в опросник и шаблоны

1. **Два текстовых артефакта + один визуальный.** `docs/TZ.md` = слой «что и зачем»
   (BRS/StRS + spec-kit `spec.md`), `docs/SPEC.md` = слой «как» (SyRS/SRS + arc42 + spec-kit
   `plan.md`), `docs/VISUALS.md` = общий визуальный слой для обоих. Расслоение текста
   подтверждено тремя независимыми источниками (29148, spec-kit, BMAD).
2. **Каждое требование — с fit criterion** (Volere) и в 5-частном синтаксисе (29148); критерии
   приёмки — Given/When/Then (INVEST). Без этого «проверяемое требование» не проверяемо.
3. **Non-goals обязательны** и означают «могло бы быть целью, но сознательно не является»
   (Google), а не «система не должна падать».
4. **Alternatives Considered** — отдельный раздел спецификации; если вариант необратим —
   уезжает в `docs/adr/`, а спецификация ссылается.
5. **Фаза прояснения — до планирования**, отдельным шагом (spec-kit `/clarify`). У нас это
   интервью по `grill-with-docs`: один вопрос за раз, само-ответ из репозитория.
6. **Пробелы помечаются, а не выдумываются** — `> TODO(пользователь):`. Это наша замена
   отсутствующему в spec-kit сквозному механизму маркеров.
7. **Глоссарий и решения не дублируются в спецификацию** — arc42 §9/§12 у нас уже заняты
   `docs/adr/` и `CONTEXT.md` / `docs/GLOSSARY.md`. Спецификация ссылается.
8. **Правило меры** (Google): для маленького проекта спецификация на 1–3 страницы —
   нормальный результат, а не недоработка.
9. **Конституцию не заводим** — её роль несёт `AGENTS.md` (ADR-0001).
10. **Handoff между «ролями» у нас реализуется сменой модели/эффорта**, а не спавном
    агентов-ролей (BMAD) — так дешевле по `docs/WORKING_RULES.md` §2.

---

## 7. Неуверенные места и что осталось за кадром

- Полный текст ISO/IEC/IEEE 29148 платный; структура клауз выше взята из обзоров и
  шаблонов-реализаций (ReqView, Modern Requirements) — помечено **[вторичный]**. На точность
  наших выводов (два слоя + синтаксис требования) это не влияет, но точные номера подпунктов
  цитировать по этим источникам нельзя.
- Стековые ориентиры 2026 (Expo vs bare, Next vs SPA) опираются в основном на обзорные
  материалы, не на официальные доки фреймворков. Поэтому в опроснике они сформулированы как
  **вопрос с развилкой**, а не как навязанный дефолт: решение принимает пользователь, и если
  оно дорого-к-откату — оно уезжает в ADR.
- Версии SDK и номера релизов намеренно **не** зашиты в опросник: они устареют быстрее файла.
  Там, где нужна актуальная версия, — спрашивать пользователя или проверять на месте.
- Не разбирались: игровые движки, embedded/IoT, blockchain. Если такой профиль понадобится —
  завести модуль по образцу существующих (запись в `planning/BACKLOG.md`).
