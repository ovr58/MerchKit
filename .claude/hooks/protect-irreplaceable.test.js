// Тест хука protect-irreplaceable. Прогон: `node --test .claude/hooks/*.test.js` (каталогом не работает: Node 24 трактует путь как модуль).
//
// Зачем он есть. 2026-09-19 хук заблокировал законное `cp .env.example <новое дерево>/.env`:
// из пути он брал только имя `.env` и проверял его существование относительно основного клона,
// где `.env` есть. Хук, падающий на рутине, обходят — и он перестаёт защищать вообще (см.
// шапку хука). Поэтому здесь проверяются обе стороны: законное пропускается, опасное — нет.
//
// Каталоги-фикстуры заводятся рядом с тестом, а не в OS-temp: путь во временный каталог хук
// пропускает целиком, и тест зеленел бы, ничего не проверяя.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { decide } = require('./protect-irreplaceable');

let withEnv; // «основной клон»: `.env` с ключами на месте
let fresh; // «свежее дерево»: `.env` ещё нет

before(() => {
  withEnv = fs.mkdtempSync(path.join(__dirname, '.fixture-main-'));
  fresh = fs.mkdtempSync(path.join(__dirname, '.fixture-fresh-'));
  fs.writeFileSync(path.join(withEnv, '.env'), 'SECRET=1\n');
  fs.writeFileSync(path.join(withEnv, '.env.example'), 'SECRET=\n');
  fs.writeFileSync(path.join(fresh, '.env.example'), 'SECRET=\n');
});

after(() => {
  fs.rmSync(withEnv, { recursive: true, force: true });
  fs.rmSync(fresh, { recursive: true, force: true });
});

/** Путь в форме MSYS (`/d/...`), как его пишет Git Bash на Windows. */
function msys(p) {
  const posix = p.replace(/\\/g, '/');
  return process.platform === 'win32' ? posix.replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`) : posix;
}

const blocked = (command, cwd = withEnv) => assert.notEqual(decide(command, cwd), null, command);
const allowed = (command, cwd = withEnv) => assert.equal(decide(command, cwd), null, command);

// --- Законное, что хук блокировал ложно ------------------------------------------------------

test('копия шаблона в свежее дерево абсолютным путём', () => {
  allowed(`cp ${fresh}/.env.example ${fresh}/.env`);
});

test('то же путём MSYS', () => {
  allowed(`cp ${msys(fresh)}/.env.example ${msys(fresh)}/.env`);
});

test('то же после cd в свежее дерево', () => {
  allowed(`cd ${msys(fresh)} && cp .env.example .env`);
});

test('то же в PowerShell после Set-Location', () => {
  allowed(`Set-Location "${fresh}"; Copy-Item .env.example .env`);
});

test('резервная копия .env — не перезапись .env', () => {
  allowed('cp .env .env.bak');
});

// --- Опасное, что хук обязан держать -------------------------------------------------------

test('шаблон поверх заполненного .env в текущем каталоге', () => {
  blocked('cp .env.example .env');
});

test('шаблон поверх .env абсолютным путём из чужого каталога', () => {
  blocked(`cp .env.example ${withEnv}/.env`, fresh);
});

test('шаблон поверх .env путём MSYS', () => {
  blocked(`cp .env.example ${msys(withEnv)}/.env`, fresh);
});

test('шаблон поверх .env после cd в каталог с ключами', () => {
  blocked(`cd ${msys(withEnv)} && cp .env.example .env`, fresh);
});

test('Copy-Item с -Destination поверх .env', () => {
  blocked(`Copy-Item -Path .env.example -Destination "${withEnv}\\.env" -Force`, fresh);
});

test('копия в каталог, где уже лежит .env', () => {
  blocked(`cp ${fresh}/.env.example ${withEnv}/.env`, fresh);
  blocked(`cp ${withEnv}/.env ${withEnv}/`, fresh);
});

test('цель, которую не разрешить, — блок, а не пропуск', () => {
  blocked('cp .env.example $TARGET/.env', fresh);
  blocked('Copy-Item .env.example "$env:TARGET\\.env"', fresh);
});

test('удаление .env блокируется независимо от пути', () => {
  blocked(`rm -f ${fresh}/.env`, fresh);
  blocked('Remove-Item .env -Force', fresh);
});

test('работа с копией в OS-temp пропускается, как и раньше', () => {
  allowed('cp .env /tmp/check/.env && rm /tmp/check/.env');
});
