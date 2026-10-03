const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { decide } = require('./contour-own-worktree.js');

const contour = { ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic' };
const main = fs.mkdtempSync(path.join(os.tmpdir(), 'main-'));
fs.mkdirSync(path.join(main, '.git'));
const linked = fs.mkdtempSync(path.join(os.tmpdir(), 'linked-'));
fs.writeFileSync(path.join(linked, '.git'), 'gitdir: x');

test('контур, основной каталог, git switch -c — запрет', () => {
  assert.ok(decide('git switch -c fix/x', main, contour));
  assert.ok(decide('git checkout -b fix/x', main, contour));
});
test('связанный worktree — можно', () => {
  assert.equal(decide('git switch -c fix/x', linked, contour), null);
});
test('вне контура — молчит', () => {
  assert.equal(decide('git switch -c fix/x', main, {}), null);
  assert.equal(decide('git switch -c fix/x', main, { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }), null);
});
test('cd или -C в другой каталог — не судим', () => {
  assert.equal(decide('cd ../project-x && git switch -c fix/x', main, contour), null);
  assert.equal(decide('git -C ../project-x switch -c fix/x', main, contour), null);
});
test('прочие команды — молчит', () => {
  assert.equal(decide('git worktree add ../project-x -b fix/x main', main, contour), null);
  assert.equal(decide('git status', main, contour), null);
});
