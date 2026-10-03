// PreToolUse на Bash/PowerShell: на страховочном контуре (чужой ANTHROPIC_BASE_URL) ЗАПРЕТ
// переключать или заводить ветку в основном каталоге репозитория.
//
// Почему файл существует. Сессия на стороннем эндпоинте однажды завела ветку прямо в основном
// каталоге, и параллельная работа, сделанная там же другой сессией, легла на её ветку, а не на
// `main`. Правило «исполнитель — в своём worktree» стояло в пусковом промпте и не сработало: у
// него не было носителя, кроме самодисциплины. Супервизор (доверенная полоса, ADR-0002) ветки в
// основном каталоге заводит законно, поэтому хук молчит вне контура.
//
// Основной каталог узнаётся по `.git`: там это каталог, в связанном worktree — файл.
// Предикат `onContour` экспортируется: его читает session-start.mjs, чтобы определение
// «что такое страховочный контур» жило в одном месте, а не в двух копиях.
// Проверка — `node --test ".claude/hooks/*.test.js"`. Аргумент-каталог не годится: Node на
// Windows принимает его за модуль и падает с MODULE_NOT_FOUND (проверено на 24.21).

const fs = require('node:fs');
const path = require('node:path');

const SWITCH = /\bgit\s+(?:switch|checkout)\b/;

function onContour(env = process.env) {
  const url = env.ANTHROPIC_BASE_URL || '';
  return url !== '' && !url.includes('api.anthropic.com');
}

function isMainCheckout(cwd) {
  try {
    return fs.statSync(path.join(cwd, '.git')).isDirectory();
  } catch {
    return false;
  }
}

function decide(command, cwd, env = process.env) {
  if (!command || !onContour(env) || !SWITCH.test(command)) return null;
  // `git -C <путь>` или `cd <путь>` — команда уходит в другой каталог, её не судим.
  if (/\bgit\s+-C\s/.test(command) || /(^|[;&|]\s*)cd\s/.test(command)) return null;
  if (!isMainCheckout(cwd)) return null;
  return (
    'на контуре ветки в основном каталоге не переключаются и не заводятся — он держит `main` ' +
    'для супервизора. Заведи свой worktree: `git worktree add ../<project>-<slug> -b <ветка> main` ' +
    '(скил using-git-worktrees) и работай там.'
  );
}

module.exports = { decide, onContour };

if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => (raw += c));
  process.stdin.on('end', () => {
    let payload = {};
    try {
      payload = JSON.parse(raw || '{}');
    } catch {
      process.exit(0);
    }
    const reason = decide(String((payload.tool_input || {}).command || ''), payload.cwd || process.cwd());
    if (reason) {
      process.stderr.write('Запрещено хуком contour-own-worktree: ' + reason + '\n');
      process.exit(2);
    }
    process.exit(0);
  });
}
