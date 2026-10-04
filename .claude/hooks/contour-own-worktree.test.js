const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { decide, onContour } = require('./contour-own-worktree.js');

const main = fs.mkdtempSync(path.join(os.tmpdir(), 'main-'));
fs.mkdirSync(path.join(main, '.git'));
fs.writeFileSync(path.join(main, 'a.js'), '');
const linked = fs.mkdtempSync(path.join(os.tmpdir(), 'linked-'));
fs.writeFileSync(path.join(linked, '.git'), 'gitdir: x');

test('основной каталог, заведение ветки — запрет в любой сессии', () => {
  assert.ok(decide('git switch -c fix/x', main));
  assert.ok(decide('git checkout -b fix/x', main));
  assert.ok(decide('git switch -c claude/wave-6 main', main));
});
test('основной каталог, переключение на другую ветку — запрет', () => {
  assert.ok(decide('git switch claude/wave-6', main));
  assert.ok(decide('git checkout feature/x', main));
});
test('возврат на main и откат файлов — можно', () => {
  assert.equal(decide('git switch main', main), null);
  assert.equal(decide('git checkout master', main), null);
  assert.equal(decide('git checkout -- a.js', main), null);
  assert.equal(decide('git checkout HEAD -- a.js', main), null);
  assert.equal(decide('git checkout a.js', main), null);
});
test('связанный worktree — можно', () => {
  assert.equal(decide('git switch -c fix/x', linked), null);
});
test('cd и -C судятся по целевому каталогу', () => {
  assert.ok(decide(`cd ${main} && git switch -c fix/x`, linked));
  assert.ok(decide(`git -C ${main} switch -c fix/x`, linked));
  assert.equal(decide(`cd ${linked} && git switch -c fix/x`, main), null);
  assert.equal(decide(`git -C ${linked} switch -c fix/x`, main), null);
});
test('путь Git-Bash /d/... узнаётся', () => {
  const posix = main.replace(/^([A-Za-z]):[\\/]/, (m, d) => `/${d.toLowerCase()}/`).replace(/\\/g, '/');
  if (posix === main) return; // не Windows
  assert.ok(decide(`cd ${posix} && git switch -c fix/x`, linked));
});
test('прочие команды — молчит', () => {
  assert.equal(decide('git worktree add ../x -b fix/x main', main), null);
  assert.equal(decide('git status', main), null);
  assert.equal(decide('git branch fix/x', main), null);
});
test('onContour по-прежнему отличает контур', () => {
  assert.equal(onContour({}), false);
  assert.equal(onContour({ ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic' }), true);
});
