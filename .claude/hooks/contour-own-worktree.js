// PreToolUse на Bash/PowerShell: ЗАПРЕТ заводить ветку или переключаться на другую ветку в основном
// каталоге репозитория — для любой сессии, включая супервизора доверенной полосы.
//
// Почему файл существует. Сессия на стороннем эндпоинте однажды завела ветку прямо в основном
// каталоге, и параллельная работа, сделанная там же другой сессией, легла на её ветку, а не на
// `main`. Сначала хук стоял только на контуре; ретро-аудит нашёл то же у супервизора — ветки волн
// заводились в основном каталоге, пока рядом работали параллельные сессии. Ветка — свойство
// каталога, а не сессии: основной каталог держит `main`, работа на ветке — в своём worktree.
//
// Можно: `git switch main`/`master`, откат файлов (`git checkout -- <путь>`, `git checkout <путь>`).
// Каталог команды — по `cd <путь>` перед ней или `git -C <путь>`, иначе `cwd` вызова.
// Основной каталог узнаётся по `.git`: там это каталог, в связанном worktree — файл.
// Предикат `onContour` экспортируется: его читает session-start.mjs, чтобы определение
// «что такое страховочный контур» жило в одном месте, а не в двух копиях.
// Проверка — `node --test ".claude/hooks/*.test.js"`. Аргумент-каталог не годится: Node на
// Windows принимает его за модуль и падает с MODULE_NOT_FOUND (проверено на 24.21).

const fs = require('node:fs');
const path = require('node:path');

const HOME_BRANCHES = new Set(['main', 'master']);

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

/** Путь Git-Bash `/d/x` → `D:/x`; относительный — от каталога `dir`. */
function resolveDir(dir, p) {
  const unq = p.replace(/^['"]|['"]$/g, '');
  const win = process.platform === 'win32' ? unq.replace(/^\/([a-zA-Z])(?=\/|$)/, '$1:') : unq;
  return path.resolve(dir, win);
}

/** Заводит ветку или уводит HEAD с main? `args` — слова после `switch`/`checkout`. */
function movesHead(sub, args, dir) {
  if (sub === 'checkout' && args.includes('--')) return false;
  if (args.some((a) => /^(-[cCbB]|--create|--force-create|--orphan|--detach)$/.test(a))) return true;
  const target = args.find((a) => !a.startsWith('-'));
  if (!target || HOME_BRANCHES.has(target)) return false;
  if (sub === 'checkout' && fs.existsSync(path.join(dir, target))) return false;
  return true;
}

function decide(command, cwd) {
  if (!command || !/\bgit\b/.test(command)) return null;
  let dir = cwd;
  for (const part of command.split(/&&|\|\||;|\|/)) {
    const words = part.trim().split(/\s+/).filter(Boolean);
    if (words[0] === 'cd' && words[1]) {
      dir = resolveDir(dir, words[1]);
      continue;
    }
    if (words[0] !== 'git') continue;
    let i = 1;
    let gitDir = dir;
    if (words[i] === '-C' && words[i + 1]) {
      gitDir = resolveDir(dir, words[i + 1]);
      i += 2;
    }
    const sub = words[i];
    if (sub !== 'switch' && sub !== 'checkout') continue;
    if (!isMainCheckout(gitDir) || !movesHead(sub, words.slice(i + 1), gitDir)) continue;
    return (
      'в основном каталоге ветки не заводятся и не переключаются — он держит `main`, а рядом ' +
      'могут работать параллельные сессии. Заведи worktree: ' +
      `\`git worktree add ../${path.basename(gitDir)}-<slug> -b <ветка> main\` ` +
      '(скил using-git-worktrees) и работай там.'
    );
  }
  return null;
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
