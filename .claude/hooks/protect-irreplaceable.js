// PreToolUse на Bash/PowerShell: ЗАПРЕТ (а не напоминание) на разрушение того, чего нет в git.
//
// Почему файл существует. 2026-09-18 сессия проверяла критерий «без ключа — внятная ошибка» и
// выполнила `Remove-Item .env -Force -Confirm:$false` ПЕРЕД `Push-Location` в свой worktree.
// Рабочий каталог инструмента — основной клон, поэтому удалился боевой `.env` владельца со
// всеми ключами внешних сервисов. `-Force` не кладёт в корзину, `.env` в `.gitignore` — копии
// не осталось нигде. Ветки и worktree не защищают неотслеживаемые файлы В ПРИНЦИПЕ: git их не
// видит. Единственный носитель такого правила — хук, потому что он исполняется харнессом.
//
// Предикат намеренно НЕ «всё, что в .gitignore»: там же лежат node_modules, dist, build и
// coverage, которые удаляют законно и постоянно. Хук, падающий на рутине, обходят — и он
// перестаёт защищать вообще. Здесь — короткий список незаменимого: секреты, тома БД,
// `git clean -x`.
//
// Хук грубый: он читает строку команды, а не её последствия. Если он заблокировал законный
// случай — это делает человек руками, и это дешевле потерянного ключа.
//
// Проверка — `node --test .claude/hooks/protect-irreplaceable.test.js`: там и ложные
// срабатывания, и пропуски, найденные на живых сессиях. Правишь хук — дописывай случай туда.

const TEMP = /(\/tmp\/|\\Temp\\|\$env:TEMP|%TEMP%|AppData[\\/]Local[\\/]Temp|TMPDIR)/i;

// Незаменимое: секреты и ключи. `.env.example` — не секрет, в нём одни имена.
const PROTECTED =
  /(?:^|[\s"'`=(/\\])(\.env(?!\.example)[\w.-]*|[\w.-]+\.pem|[\w.-]+\.key|secrets\.\w+|credentials\.json|id_rsa\w*)/;

const DESTRUCTIVE =
  /(?:^|[\s;|&(])(rm|del|erase|unlink|rmdir|rd|mv|move|Remove-Item|Move-Item|Clear-Content|Set-Content|Out-File|New-Item)(?:\s|$)/i;

const COPY = /(?:^|[\s;|&(])(cp|copy|Copy-Item)(?:\s|$)/i;

const REDIRECT_OVERWRITE = />\s*"?'?[^\s"'|>]*\.env\b/;

const GIT_CLEAN_IGNORED = /\bgit\s+clean\b[^\n;|&]*\s-[a-zA-Z]*[xX]/;

const DOCKER_VOLUMES =
  /\bdocker\s+(compose\s+)?down\b[^\n;|&]*\s(-v|--volumes)\b|\bdocker\s+volume\s+(rm|prune)\b/;

function protectedTokens(command) {
  const out = [];
  const re = new RegExp(PROTECTED.source, 'g');
  let m;
  while ((m = re.exec(command)) !== null) out.push(m[1]);
  return out;
}

const DRY_RUN = /(?:^|\s)(-n|--dry-run|-WhatIf|--whatif)(?:\s|$)/i;

function decide(command, cwd) {
  if (!command) return null;

  // Пробный прогон ничего не удаляет — не мешаем смотреть, что команда сделала бы.
  if (DRY_RUN.test(command)) return null;

  if (GIT_CLEAN_IGNORED.test(command)) {
    return (
      '`git clean` с флагом -x сносит неотслеживаемые файлы, включая `.env` с ключами — ' +
      'git их не восстановит. Удаляй мусор адресно (`rm -rf node_modules dist`) или запусти ' +
      'команду сам, если правда нужен -x.'
    );
  }

  if (DOCKER_VOLUMES.test(command)) {
    return (
      'Это удалит тома Docker вместе с dev-базой: миграции и seed придётся накатывать заново. ' +
      'Если контейнеры надо просто погасить — `docker compose down` без -v.'
    );
  }

  const tokens = protectedTokens(command);
  if (tokens.length === 0) return null;

  // Разрешено, если работа идёт с копией в OS-temp: отрицательные проверки «файла нет»
  // ставятся именно на копии, а не на настоящем имени в настоящем дереве.
  if (TEMP.test(command)) return null;

  if (DESTRUCTIVE.test(command) || REDIRECT_OVERWRITE.test(command)) {
    return (
      `Команда удаляет или перезаписывает незаменимое: ${tokens.join(', ')}. ` +
      'Этих файлов нет в git — восстановить будет нечем (так 2026-09-18 потеряли `.env` со всеми ' +
      'ключами). Нужна отрицательная проверка «файла нет» — делай её на копии в OS-temp. ' +
      'Нужен именно этот файл — пусть его тронет человек.'
    );
  }

  if (COPY.test(command)) {
    // Копирование поверх существующего секрета затирает значения так же насмерть, как rm.
    const hit = copyOverSecret(command, cwd || process.cwd());
    if (hit) {
      return (
        `Копирование поверх существующего файла с секретами (${hit}) сотрёт значения — ` +
        'ровно так шаблон уже затирал заполненный `.env`. Заводи копию под другим именем ' +
        'или удали цель руками, если правда этого хочешь.'
      );
    }
  }

  return null;
}

// --- Копирование: что именно окажется перезаписано ----------------------------------------
//
// ПОЧЕМУ ЦЕЛЬ РАЗБИРАЕТСЯ ЦЕЛИКОМ, А НЕ ПО ИМЕНИ ФАЙЛА. Первая редакция брала из команды только
// имя (`.env`) и искала его в рабочем каталоге инструмента — основном клоне. Ошибалась она в обе
// стороны (2026-09-19): `cp .env.example <свежее дерево>/.env` блокировала, потому что `.env`
// есть в клоне, а `cp .env.example <клон>/.env`, выполненное из свежего дерева, ПРОПУСКАЛА —
// ровно тот случай, ради которого хук заведён. Поэтому здесь: команда режется на части, `cd`
// и `Set-Location` сдвигают каталог для следующих частей (как и в самой оболочке), и
// проверяется назначение копирования по полному пути.

const PATH = require('path');
const FS = require('fs');

const SEGMENTS = /&&|\|\||[;\n|]/;
const CHDIR = /^(cd|pushd|sl|Set-Location|Push-Location)$/i;
const COPY_COMMAND = /^(cp|copy|Copy-Item)$/i;

// Переменная, подстановка или домашний каталог: без оболочки путь не вычислить.
const UNRESOLVED = /[$%~`]/;

function words(segment) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(segment)) !== null) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** Путь Git Bash `/d/x` → `d:/x`: иначе Node на Windows прочтёт его от корня текущего диска. */
function native(p) {
  return process.platform === 'win32' ? p.replace(/^\/([A-Za-z])(?=\/|$)/, '$1:') : p;
}

function resolveFrom(base, p) {
  if (base === null || UNRESOLVED.test(p)) return null;
  const n = native(p);
  return PATH.isAbsolute(n) ? n : PATH.join(base, n);
}

function isSecretName(name) {
  return PROTECTED.test(PATH.basename(name));
}

function exists(p) {
  try {
    return FS.existsSync(p);
  } catch {
    return false;
  }
}

/** Назначение и источники копирования: `-Destination` у PowerShell, иначе последнее слово. */
function copyArguments(args) {
  let destination = null;
  const sources = [];
  for (let i = 0; i < args.length; i += 1) {
    if (/^-(destination|dest)$/i.test(args[i])) destination = args[++i] ?? null;
    else if (/^-(path|literalpath)$/i.test(args[i])) sources.push(args[++i]);
    else if (!args[i].startsWith('-')) sources.push(args[i]);
  }
  if (destination === null) destination = sources.pop() ?? null;
  return { destination, sources };
}

/** Какой файл с секретами перезапишет копирование — или `null`, если такого нет. */
function copyOverSecret(command, cwd) {
  let base = cwd;
  for (const segment of command.split(SEGMENTS)) {
    const [head, ...args] = words(segment.trim());
    if (!head) continue;

    if (CHDIR.test(head)) {
      const target = args.find((a) => !a.startsWith('-'));
      base = target === undefined ? base : resolveFrom(base, target);
      continue;
    }
    if (!COPY_COMMAND.test(head)) continue;

    const { destination, sources } = copyArguments(args);
    if (!destination) continue;

    const target = resolveFrom(base, destination);
    if (target === null) {
      // Цель не вычислить — значит, не доказать, что она безопасна. Хук грубый сознательно.
      if (protectedTokens(' ' + destination).length > 0) return destination;
      continue;
    }

    let directory = false;
    try {
      directory = FS.statSync(target).isDirectory();
    } catch {
      /* цели нет — значит, и перезаписывать нечего */
    }

    const written = directory
      ? sources.map((s) => PATH.join(target, PATH.basename(native(s))))
      : [target];
    const hit = written.find((p) => isSecretName(p) && exists(p));
    if (hit) return hit;
  }
  return null;
}

module.exports = { decide };

// Вход харнесса читается, только когда файл запущен хуком, а не подключён тестом.
if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => (raw += c));
  process.stdin.on('end', () => {
    let payload = {};
    try {
      payload = JSON.parse(raw || '{}');
    } catch {
      process.exit(0); // не смогли разобрать вход — не мешаем работе
    }
    const input = payload.tool_input || {};
    const reason = decide(String(input.command || ''), payload.cwd);
    if (reason) {
      process.stderr.write('Запрещено хуком protect-irreplaceable: ' + reason + '\n');
      process.exit(2); // exit 2 на PreToolUse = блокировка вызова
    }
    process.exit(0);
  });
}
