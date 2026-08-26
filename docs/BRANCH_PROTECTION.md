# Защита trunk на GitHub

> Серверный аналог локального хука `githooks/pre-commit`. Хук живёт в `.git/hooks/` **одной
> машины** и в git не попадает: он не защищает удалёнку и его не увидит новый контрибьютор.
> Всё, что перечислено ниже, включает владелец репозитория в настройках GitHub — агент этого
> сделать не может.
>
> Правила ветвления и полосы доверия — [`AGENTS.md`](../AGENTS.md), обоснование полос —
> [ADR-0002](adr/0002-trust-lane-by-model-not-host.md). Для людей — [`CONTRIBUTING.md`](../CONTRIBUTING.md).

Обновлено: 2026-08-26

## Trunk этого репозитория — `main`

Развилка `master`↔`main` закрыта в пользу `main`: так называется ветка по умолчанию у GitHub,
и так её называют документы проекта. `master` в тексте хука и команды `/review-branches`
остаётся только как host-neutral подстраховка для форков с другим именем trunk.

## Что включить на `main`

Настройка — **Settings → Rules → Rulesets → New branch ruleset** (современная замена
классическому Branch protection). Target: `Include default branch`. Enforcement: `Active`.

| Правило | Значение | Зачем |
| --- | --- | --- |
| Restrict deletions | вкл. | Trunk нельзя удалить даже случайно. |
| Block force pushes | вкл. | История trunk не переписывается — иначе ссылки в планах и ADR (Architecture Decision Record) протухают молча. |
| Require a pull request before merging | вкл. | Прямой push в `main` отбивается на сервере — ровно то, что локально делает `pre-commit`. |
| ├ Required approvals | `0` (репо одного мейнтейнера) | GitHub не даёт апрувить собственный PR (pull request — запрос на слияние). При `1` единственный мейнтейнер блокирует сам себя. Появится второй человек — поднять до `1`. |
| ├ Dismiss stale reviews on push | вкл. | Апрув относится к тому диффу, который читали. |
| └ Require conversation resolution | вкл. | Комментарий ревью нельзя «промотать» мёржем. |
| Require status checks to pass | выкл., **до появления CI** | Включить в том же изменении, где заводится workflow (Continuous Integration — автосборка/автопроверки на сервере). Чек, который не запускается, вечно висит в pending и блокирует мёрж. |
| Bypass list | пусто | Включая владельца: исключение, которым пользуются, перестаёт быть исключением. |

## Как это ложится на полосы доверия

Сервер не знает, какая модель работает, — он не различает полосы (см. предупреждение в
`AGENTS.md`). Поэтому машинно требуется **минимум**, а разница между полосами держится
процессом:

- **Доверенная полоса (Opus).** `Required approvals: 0` оставляет fast-merge: агент делает
  self-review по скилу `requesting-code-review`, открывает PR и сливает его сам.
- **Консервативная полоса (не-Opus).** Self-approve запрещён правилом, а не сервером: агент
  готовит review-handoff и ждёт ревью Opus **и** явного апрува пользователя. Появится второй
  ревьюер-человек — `Required approvals: 1` сделает это правило машинным.

## Порядок мёржа

`Squash and merge` как способ по умолчанию (Settings → General → Pull Requests): ветка
приезжает в `main` одним осмысленным коммитом, а шум промежуточных «wip» остаётся в PR.
Там же — `Automatically delete head branches`, чтобы слитые ветки не копились.

## CODEOWNERS — сознательно не заводим

Файл `CODEOWNERS` имеет смысл, когда у областей кода **разные** владельцы. В репозитории
одного мейнтейнера он лишь добавляет самому себе обязательный ревью-гейт на каждый PR.
Появятся отдельные владельцы у `supabase/` или `docs/` — завести тогда же.

## Воспроизвести командой

Если авторизован `gh` (GitHub CLI), тот же ruleset создаётся без UI:

```bash
gh api -X POST repos/ovr58/MerchKit/rulesets --input - <<'JSON'
{
  "name": "protect-main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true,
        "allowed_merge_methods": ["squash"]
      }
    }
  ]
}
JSON
```

Проверка: `gh api repos/ovr58/MerchKit/rulesets` должен вернуть ruleset со статусом `active`,
а `git push origin main` из локального `main` с новым коммитом — отбиться сервером.

## Локальный хук ставится отдельно

Защита на сервере не отменяет локальную: без хука ошибка обнаружится только на push, когда
коммит уже лежит в `main` и его надо вынимать. Установка — один шаг, описан в
[`CONTRIBUTING.md`](../CONTRIBUTING.md).
