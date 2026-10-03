---
name: worktree-remove-fails-long-paths
description: git worktree remove на Windows может падать с «Filename too long» и оставлять каталог на диске
metadata:
  type: feedback
---

`git worktree remove <путь>` на Windows может завершиться ошибкой `failed to delete ...:
Filename too long`: внутри рабочего дерева лежат зависимости (`node_modules` и подобные) с
путями длиннее MAX_PATH. При этом **реестр git всё равно очищается** — `git worktree list`
дерево больше не показывает, и `git branch -d` после этого проходит. На диске каталог остаётся
целиком.

**Why:** после сведения легко решить, что дерево убрано, и оставить на диске копию репозитория
с тысячами файлов зависимостей — они потом попадаются в поиске и путают сессии.

**How to apply:** после `worktree remove` проверять, остался ли каталог на диске. Удаление
остатка — действие пользователя: автоматике оно запрещено классификатором харнесса как
необратимое — [[auto-mode-classifier-owns-irreversible]]. Давать владельцу готовую команду
(`robocopy <пустой каталог> <путь> /MIR`, затем `Remove-Item -Recurse -Force`, потому что
обычный `Remove-Item` тоже упирается в длину пути). См. [[worktree-may-hold-uncommitted-work]].
