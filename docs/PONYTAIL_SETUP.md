# Ponytail — установка «из коробки» (Claude Code + Copilot Chat)

Рецепт, как запечь плагин [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail)
(«ленивый сеньор»: YAGNI → reuse → stdlib → native → dep → one-liner → минимум кода) в шаблон
проекта так, чтобы он работал сразу после клонирования — без ручных команд.

**В шаблоне это уже сделано:** оба носителя в репозитории —
`.claude/settings.json` (Claude Code) и `.github/instructions/ponytail.instructions.md`
(Copilot Chat). Этот файл нужен, чтобы повторить установку в другом шаблоне или проверить
существующую. Коммит — как любой другой: боковая ветка, никаких обходов pre-commit-хука
(хард-правило канона «никаких прямых коммитов в `main`»).

---

## 1. Claude Code — авто-подхват через project-level `.claude/settings.json`

Версия для шаблона **не** требует ручных `claude plugin marketplace add/install`. Достаточно
закоммитить в репозиторий `.claude/settings.json` с этими двумя ключами — Claude Code сам узнает
маркетплейс и включит плагин в любой сессии этого workspace:

```json
{
  "extraKnownMarketplaces": {
    "ponytail": { "source": { "source": "github", "repo": "DietrichGebert/ponytail" } }
  },
  "enabledPlugins": { "ponytail@ponytail": true }
}
```

Если в репо уже есть `.claude/settings.json` — **слить** эти ключи, не перезаписывать файл.

Что приедет (состав **внешнего** плагина, сверено 2026-09-29 — при расхождении верен плагин, не
этот файл): 6 скилов (`ponytail`, `-audit`, `-debt`, `-gain`, `-help`, `-review`) + 3 хука
(SessionStart/SubagentStart/UserPromptSubmit), ~983 tok always-on на сессию. Режим по умолчанию
`full`; переключение в чате — `/ponytail lite|full|ultra`, стоп — «stop ponytail». Состав задаёт
автор плагина и меняет без предупреждения — проверять `claude plugin list`, а не эту строку.

Альтернатива (разовая, user-scope, не для шаблона):
`claude plugin marketplace add DietrichGebert/ponytail` → `claude plugin install ponytail@ponytail`.

## 2. Copilot Chat (VS Code) — repo-level инструкция

Copilot Chat плагины-маркетплейсы ponytail не умеет; он читает правила из репозитория. Файл
[`.github/instructions/ponytail.instructions.md`](../.github/instructions/ponytail.instructions.md)
(`applyTo: "**"`) — зеркало методички ponytail. Он уже в репо; для шаблона просто оставить как есть.

**Анти-дубль:** пересекающиеся темы (минимальные правки, секреты, логи, отчётность) вынесены ссылкой
на `.github/instructions/general-code.instructions.md`, а не продублированы. При переносе в другой
шаблон проверь, что одноимённый general-файл существует, иначе перенеси нужные пункты внутрь.

## 3. Проверка

- Claude Code: `claude plugin list` → `ponytail@ponytail … enabled`. В шаблоне — открыть новую
  сессию в склонированном репо и убедиться, что плагин подхватился без ручных команд.
- Copilot Chat: открыть репо в VS Code, в чате спросить «which instructions apply?» — должен
  учитывать ponytail-лестницу; или просто проверить, что правки стали минимальнее/без лишних абстракций.

## 4. Заметка про конфликты (правило проекта)

Любое противоречие ponytail существующим правилам/решениям проекта — решать через владельца, не
тихо переписывать curated-инструкции. Стартовый режим `full` строже формулировок проекта по
смыслу совпадает; при желании снизить — переключить дефолт на `lite` или оставить в инструкции
только ссылку на `general-code.instructions.md`.
