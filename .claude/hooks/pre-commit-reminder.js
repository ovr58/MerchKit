// PreToolUse на `git commit` / `git merge`: момент, в который сходятся три забываемых скила.
// Не блокирует — напоминает. Гейт уже есть (githooks/pre-commit запрещает коммит в main).
//
// Команду проверяет сам скрипт, а не поле `if` в settings.json: `if` не разбирает составные
// команды (`cd … &&`, `$VAR`, циклы, heredoc) и на них срабатывает всегда, а две записи —
// commit и merge — давали парные напоминания на каждой такой команде, даже без git.
let input = '';
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  let command;
  try {
    command = JSON.parse(input).tool_input?.command ?? '';
  } catch {
    return;
  }
  if (!/\bgit\s+(commit|merge)\b/.test(command)) return;
  process.stdout.write(
    JSON.stringify({
      systemMessage:
        'Перед коммитом: verification-before-completion (чем проверено И что НЕ проверено) · ' +
        'finishing-a-development-branch, если ветка закрывается · ступень лестницы названа · ' +
        'новые термины в CONTEXT.md/GLOSSARY.md · строка planning/INDEX.md в том же изменении.',
      suppressOutput: false,
    }),
  );
});
