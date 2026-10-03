/**
 * Карта занятости кадра — остаток шага B4 плана
 * [`card-assembly-pipeline_2026-08-31.md`](../../../../planning/active/card-assembly-pipeline_2026-08-31.md).
 *
 * **Зачем.** Арт-директор (шаг B5) выбирает, где в кадре встанет текст. Без знания о том, где
 * товар, перекрытие текста товаром получается случайным: в одном кадре заголовок ляжет на
 * фон, в соседнем — на лицо модели. Карта даёт это знание в виде, пригодном для выбора места,
 * а не только для констатации «занято на 47%».
 *
 * **Карта отвечает на вопрос, а не описывает картинку.** Вопрос у арт-директора один:
 * «если я положу бокс сюда, сколько его окажется на товаре». На него отвечает `occupancyOfBox`,
 * а `free` — заранее посчитанные места, где ответ близок к нулю. Приём тот же, что у
 * `overflowsOf` в шаге B6: модель предлагает вёрстку, арифметика проверяет её до отрисовки.
 * Обратное чтение тоже законно и нужно — слой `cutout` существует ради приёма «текст уходит
 * за товар», и там высокая занятость бокса не брак, а замысел. Карта даёт числа, решает
 * арт-директор.
 *
 * **Карта не зависит от модели выреза — и это свойство формы, а не аккуратности.** Модель
 * меняется прямо сейчас ([ADR-0017](../../../../docs/adr/0017-cutout-model-u2netp-by-authors-consent.md),
 * плюс заливка дыр на стороне сервиса), а переделывать из-за этого B5 нельзя. Держится
 * тремя механизмами:
 *
 * 1. **Доли кадра, а не пиксели.** Маска `u2netp` приезжает 320×320, BiRefNet — 1024×1024;
 *    карта у них обязана быть одна.
 * 2. **Усреднение мягкой альфы по ячейке, а не порог по пикселю.** Кайма в два пикселя
 *    сдвигает долю ячейки на сотые и ячейку не переключает. Порог по пикселю переключал бы.
 * 3. **Округление до сотых.** Разница масок, не видимая глазом, не должна доезжать до данных,
 *    которые уйдут в промпт арт-директора.
 *
 * **Карта — не уменьшенная маска: у них разные цели.** Маске просветы нужны — дужки очков
 * обязаны просвечивать, и ради этого на стороне сервиса стоит порог площади дыры. Карте
 * просветы не нужны: дырка внутри контура местом под текст не является, кто бы её ни оставил
 * — модель браком или сервис намеренно. Поэтому ячейка, запертая товаром и по строке, и по
 * столбцу, считается занятой (`enclosedCells`). Это же снимает последнюю зависимость от
 * соседнего репозитория: включена там заливка дыр или нет, карта выходит одна.
 *
 * **Ошибаемся в сторону «занято».** Ложно свободная ячейка кладёт текст на товар — это брак в
 * кадре. Ложно занятая отнимает у арт-директора один вариант из нескольких. Цена разная,
 * поэтому и правила сдвинуты в одну сторону.
 *
 * **Координаты — кадра, а не холста.** Кадр ложится в макет слоем с привязкой `frame`, и если
 * его бокс не во весь холст или пропорции расходятся, `cover` часть кадра срезает. Пересчёт
 * «доли кадра → доли холста» — работа B5: там известны бокс слоя, `fit` и `focus`, здесь не
 * известно ничего из этого. Здесь — только маска.
 *
 * **Пикселей маски этот модуль не добывает.** На вход идут готовые сэмплы альфы: их собирает
 * тот, у кого есть декодер, — сервис сборки на VPS
 * ([ADR-0015](../../../../docs/adr/0015-card-service-on-vps-not-edge-function.md)) или
 * офлайн-оснастка. Заводить декодер PNG в изоляте ADR-0015 как раз и запретил, а тестам
 * маска подменяется вручную — весов и коробки для проверки карты не нужно.
 */

import type { Box } from './types.ts'

/**
 * Маска в том виде, в каком её видит тот, кто её декодировал: непрозрачность по пикселям,
 * построчно сверху вниз. 0 — фон, 255 — товар, промежуточное — мягкая кромка.
 *
 * Мягкость сюда доезжать обязана: усреднение полутона по ячейке и есть то, что делает карту
 * независимой от модели. Бинаризованная маска даст на границе ступеньку той модели, которая
 * её посчитала.
 */
export type MaskSamples = {
  width: number
  height: number
  alpha: Uint8Array | number[]
}

export type OccupancyMap = {
  /** Число ячеек по горизонтали и вертикали. Ячейки близки к квадратным — иначе площади
   *  свободных зон нельзя было бы сравнивать между собой. */
  cols: number
  rows: number
  /** Доли занятости ячеек 0…1, построчно сверху вниз, длиной `cols × rows`. Это ответ карты,
   *  а не среднее по маске: запертые внутри контура ячейки подняты до 1. */
  cells: number[]
  /** Габарит товара в долях кадра. `null` — товара на кадре нет. Нужен не только для текста:
   *  им же выбирается `focus` кадра, чтобы `cover` не срезал товар.
   *
   *  Пустой габарит при ненулевой `coverage` законен и означает ровно то, что написано: ни в
   *  одной ячейке товара не больше, чем фона. Так выглядит маска-полутон, которую модель
   *  отдала, не разделив объект и фон; сервис такую отсекает своим порогом `coverage`, и слой
   *  `cutout` снимается правилом K-3. */
  bounds: Box | null
  /** Доля кадра, которую карта считает занятой. */
  coverage: number
  /** Свободные прямоугольники в долях кадра, от крупного к мелкому. Пересекаться между собой
   *  им можно и нужно: широкая низкая полоса и узкая высокая колонка над одним и тем же
   *  местом — два разных предложения арт-директору, а не одно. */
  free: Box[]
}

/** Длинная сторона сетки в ячейках. Ячейка выходит около 6% стороны кадра: мельче — карта
 *  начинает пересказывать кромку конкретной модели, крупнее — перестаёт различать колонку под
 *  текст рядом с товаром. */
export const GRID_LONG_SIDE = 16

/** С какой доли ячейка считается занятой. Половина — та точка, где ячейка больше товар, чем
 *  фон; на мягкой кромке в неё попадает ровно один ряд ячеек. */
export const OCCUPIED_AT = 0.5

/** Меньше двух ячеек по стороне (около 12% кадра) — не место под текстовый блок, а щель.
 *  Такие зоны не отбрасываются молча: они просто не предлагаются как места. */
export const MIN_FREE_CELLS = 2

/** Сколько свободных зон докладывать. Арт-директору нужен выбор из нескольких, а не список
 *  всех прямоугольников: длинный список он всё равно прочтёт как шум. */
export const FREE_LIMIT = 6

export function occupancyOf(mask: MaskSamples): OccupancyMap {
  if (mask.width <= 0 || mask.height <= 0 || mask.alpha.length !== mask.width * mask.height) {
    throw new Error(
      `Карта занятости: маска ${mask.width}×${mask.height} не сходится с ${mask.alpha.length} сэмплами`,
    )
  }

  const { cols, rows } = gridOf(mask.width, mask.height)
  const cells = averageAlpha(mask, cols, rows)
  const occupied = cells.map((share) => share >= OCCUPIED_AT)

  // Запертое внутри контура — товар, а не место. Значение поднимается вместе с признаком:
  // иначе `occupancyOfBox` отвечал бы «свободно» там, где `free` места не предлагает, и две
  // половины карты разошлись бы на первом же кадре с дыркой в маске.
  for (const index of enclosedCells(occupied, cols, rows)) {
    occupied[index] = true
    cells[index] = 1
  }

  return {
    cols,
    rows,
    cells: cells.map(round2),
    bounds: boundsOf(occupied, cols, rows),
    coverage: round2(cells.reduce((sum, share) => sum + share, 0) / cells.length),
    free: freeZones(occupied, cols, rows),
  }
}

/**
 * Сколько бокса лежит на товаре: 0 — целиком на фоне, 1 — целиком на товаре.
 *
 * Ячейки берутся с весом перекрытия, а не целиком: бокс не обязан совпадать с сеткой, и
 * округление его до ячеек давало бы разные ответы для одного и того же места в зависимости
 * от того, куда попала граница.
 *
 * Бокс за краем кадра законен — так задаётся вылет за обрез (см. `Fraction` в `types.ts`), —
 * и обрезается по кадру: то, что за краем, ни на каком товаре не лежит.
 */
export function occupancyOfBox(map: OccupancyMap, box: Box): number {
  if (box.w <= 0 || box.h <= 0) return 0

  const left = Math.max(0, box.x)
  const top = Math.max(0, box.y)
  const right = Math.min(1, box.x + box.w)
  const bottom = Math.min(1, box.y + box.h)
  if (right <= left || bottom <= top) return 0

  let weighted = 0
  let area = 0

  for (let row = 0; row < map.rows; row += 1) {
    const overlapH = overlap(top, bottom, row / map.rows, (row + 1) / map.rows)
    if (overlapH === 0) continue

    for (let col = 0; col < map.cols; col += 1) {
      const overlapW = overlap(left, right, col / map.cols, (col + 1) / map.cols)
      if (overlapW === 0) continue

      const weight = overlapW * overlapH
      weighted += weight * map.cells[row * map.cols + col]
      area += weight
    }
  }

  return area === 0 ? 0 : round2(weighted / area)
}

/** Сетка под пропорцию кадра: ячейки близки к квадратным, длинная сторона — `GRID_LONG_SIDE`. */
function gridOf(width: number, height: number): { cols: number; rows: number } {
  const scale = GRID_LONG_SIDE / Math.max(width, height)
  return {
    cols: Math.max(1, Math.round(width * scale)),
    rows: Math.max(1, Math.round(height * scale)),
  }
}

/** Доля товара в ячейке — среднее альфы по её пикселям. Границы ячеек считаются от размера
 *  маски, а не наоборот: маска не обязана делиться на сетку нацело. */
function averageAlpha(mask: MaskSamples, cols: number, rows: number): number[] {
  const cells: number[] = []

  for (let row = 0; row < rows; row += 1) {
    const top = Math.floor((row * mask.height) / rows)
    const bottom = Math.floor(((row + 1) * mask.height) / rows)

    for (let col = 0; col < cols; col += 1) {
      const left = Math.floor((col * mask.width) / cols)
      const right = Math.floor(((col + 1) * mask.width) / cols)

      let sum = 0
      for (let y = top; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) sum += mask.alpha[y * mask.width + x]
      }

      const count = (bottom - top) * (right - left)
      cells.push(count === 0 ? 0 : sum / count / 255)
    }
  }

  return cells
}

/**
 * Ячейки, запертые товаром и по строке, и по столбцу.
 *
 * Условия именно два, а не одно: по одной строке «занято слева и справа» верно и для
 * промежутка между двумя рядом стоящими предметами (пара обуви), и такое правило съело бы
 * весь фон между ними. Заперто по обеим осям — это уже внутренность контура.
 */
function enclosedCells(occupied: boolean[], cols: number, rows: number): number[] {
  const rowFirst = new Array<number>(rows).fill(-1)
  const rowLast = new Array<number>(rows).fill(-1)
  const colFirst = new Array<number>(cols).fill(-1)
  const colLast = new Array<number>(cols).fill(-1)

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (!occupied[row * cols + col]) continue
      if (rowFirst[row] === -1) rowFirst[row] = col
      rowLast[row] = col
      if (colFirst[col] === -1) colFirst[col] = row
      colLast[col] = row
    }
  }

  const enclosed: number[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (occupied[row * cols + col]) continue
      const inRow = rowFirst[row] !== -1 && col > rowFirst[row] && col < rowLast[row]
      const inCol = colFirst[col] !== -1 && row > colFirst[col] && row < colLast[col]
      if (inRow && inCol) enclosed.push(row * cols + col)
    }
  }

  return enclosed
}

function boundsOf(occupied: boolean[], cols: number, rows: number): Box | null {
  let left = cols
  let top = rows
  let right = -1
  let bottom = -1

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (!occupied[row * cols + col]) continue
      left = Math.min(left, col)
      top = Math.min(top, row)
      right = Math.max(right, col)
      bottom = Math.max(bottom, row)
    }
  }

  if (right === -1) return null

  return {
    x: round2(left / cols),
    y: round2(top / rows),
    w: round2((right + 1 - left) / cols),
    h: round2((bottom + 1 - top) / rows),
  }
}

type FreeCandidate = { top: number; bottom: number; left: number; right: number }

/**
 * Свободные прямоугольники — максимальные по включению: те, которые нельзя раздвинуть ни в
 * одну сторону, не задев товар.
 *
 * Перебираются пары «верхняя строка — нижняя строка», внутри пары — сплошные пробеги
 * свободных столбцов. На сетке в 16 ячеек по длинной стороне это тысячи операций, поэтому
 * умнее алгоритма здесь не нужно, а понятнее — нужно.
 */
function freeZones(occupied: boolean[], cols: number, rows: number): Box[] {
  const found = new Map<string, FreeCandidate>()

  for (let top = 0; top < rows; top += 1) {
    const columnFree = new Array<boolean>(cols).fill(true)

    for (let bottom = top; bottom < rows; bottom += 1) {
      for (let col = 0; col < cols; col += 1) {
        if (occupied[bottom * cols + col]) columnFree[col] = false
      }

      if (bottom - top + 1 < MIN_FREE_CELLS) continue

      let runStart = -1
      for (let col = 0; col <= cols; col += 1) {
        const free = col < cols && columnFree[col]
        if (free && runStart === -1) runStart = col
        if (free || runStart === -1) continue

        if (col - runStart >= MIN_FREE_CELLS) {
          found.set(`${top}:${bottom}:${runStart}:${col - 1}`, { top, bottom, left: runStart, right: col - 1 })
        }
        runStart = -1
      }
    }
  }

  const candidates = [...found.values()]

  return candidates
    .filter((candidate) => !candidates.some((other) => contains(other, candidate)))
    .sort(byAreaThenPosition)
    .slice(0, FREE_LIMIT)
    .map((candidate) => ({
      x: round2(candidate.left / cols),
      y: round2(candidate.top / rows),
      w: round2((candidate.right + 1 - candidate.left) / cols),
      h: round2((candidate.bottom + 1 - candidate.top) / rows),
    }))
}

function contains(outer: FreeCandidate, inner: FreeCandidate): boolean {
  if (outer === inner) return false
  return (
    outer.top <= inner.top &&
    outer.bottom >= inner.bottom &&
    outer.left <= inner.left &&
    outer.right >= inner.right
  )
}

/** Порядок — часть контракта: карта уезжает в промпт арт-директора, и одна и та же маска
 *  обязана давать один и тот же список, иначе кадр не воспроизвести. */
function byAreaThenPosition(left: FreeCandidate, right: FreeCandidate): number {
  const area = areaOf(right) - areaOf(left)
  if (area !== 0) return area
  if (left.top !== right.top) return left.top - right.top
  return left.left - right.left
}

function areaOf(candidate: FreeCandidate): number {
  return (candidate.bottom + 1 - candidate.top) * (candidate.right + 1 - candidate.left)
}

function overlap(from: number, to: number, cellFrom: number, cellTo: number): number {
  return Math.max(0, Math.min(to, cellTo) - Math.max(from, cellFrom))
}

/** Сотые — предел, за которым разница масок перестаёт быть различием кадра и становится
 *  различием модели. */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}
