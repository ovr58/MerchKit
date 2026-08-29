/**
 * Минимальный кодировщик и читатель JPEG.
 *
 * **Зачем свой, а не библиотека.** В Edge Functions зависимостей нет намеренно: шаблонный
 * импорт с `jsr.io` уронил рантайм с `worker boot error` ещё до первой строки обработчика
 * (B9 в `planning/BACKLOG.md`). А JPEG нужен по-настоящему: профиль FR-25 требует именно
 * этот формат, и «почти картинка» критерий приёмки вехи не закрывает.
 *
 * **Почему кодировщик умещается в полтораста строк.** Он кодирует не любое изображение, а
 * только такое, где каждый блок 8×8 залит одним цветом. У блока постоянной яркости
 * дискретное косинусное преобразование вырождается: ненулевым остаётся один коэффициент
 * DC, все 63 коэффициента AC — нули. Значит ни самого преобразования, ни зигзаг-обхода,
 * ни кодирования серий писать не нужно — на блок уходит одно число и метка «дальше нули».
 * Разрешение при этом настоящее: 1200 × 1600 — это 150 × 200 блоков, для плейсхолдера
 * такой «пиксельной» сетки более чем достаточно.
 *
 * Таблицы квантования — единицы. Обычный JPEG ими огрубляет высокие частоты ради размера,
 * но у нас высоких частот нет вовсе: единичный делитель просто возвращает цвет блока
 * без потерь. Таблицы Хаффмана — свои, а не из приложения K стандарта: раз AC-символ
 * бывает ровно один (конец блока), таблица из двух символов честнее ста шестидесяти двух.
 *
 * Проверяется `jpeg.test.ts` (структура и размеры) и разбором посторонним декодером —
 * см. раздел «Как проверялось» в плане вехи M4.
 */

/** Цвет в sRGB, каналы 0…255. */
export type Rgb = readonly [number, number, number]

/** Сколько блоков 8×8 укладывается в сторону изображения (последний может торчать за край). */
export function blockCount(sizePx: number): number {
  return Math.ceil(sizePx / 8)
}

type HuffmanTable = { bits: number[]; values: number[]; codes: Map<number, [number, number]> }

/**
 * Канонические коды Хаффмана из счётчиков длин, как их строит сам стандарт: коды одной
 * длины идут подряд по возрастанию, при переходе к следующей длине код сдвигается влево.
 */
function huffman(bits: number[], values: number[]): HuffmanTable {
  const codes = new Map<number, [number, number]>()
  let code = 0
  let index = 0

  for (let length = 1; length <= 16; length++) {
    for (let n = 0; n < bits[length - 1]; n++) {
      codes.set(values[index], [code, length])
      index += 1
      code += 1
    }
    code <<= 1
  }

  return { bits, values, codes }
}

// Категорий величины у разности DC двенадцать (0…11) — этого хватает: максимальная разность
// между соседними блоками равна 8 × 255 = 2040 и попадает в одиннадцатую категорию.
const DC_TABLE = huffman(
  [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
)

// AC-символов ровно два: 0x00 — «конец блока», 0xF0 — «шестнадцать нулей». Пишем только
// первый, второй оставлен, чтобы таблица не вырождалась в единственный код.
const AC_TABLE = huffman([0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0x00, 0xf0])

/** Поток битов с байт-стаффингом: 0xFF внутри данных обязан продолжаться нулевым байтом. */
class BitWriter {
  private readonly bytes: number[] = []
  private accumulator = 0
  private filled = 0

  write([code, length]: [number, number]): void {
    for (let bit = length - 1; bit >= 0; bit--) {
      this.accumulator = (this.accumulator << 1) | ((code >> bit) & 1)
      this.filled += 1

      if (this.filled === 8) {
        const byte = this.accumulator & 0xff
        this.bytes.push(byte)
        // Иначе декодер принял бы данные за начало следующего сегмента.
        if (byte === 0xff) this.bytes.push(0x00)
        this.accumulator = 0
        this.filled = 0
      }
    }
  }

  /** Хвост добивается единицами: нулевой хвост декодер прочитал бы как настоящий код. */
  end(): number[] {
    if (this.filled > 0) this.write([0xff, 8 - this.filled])
    return this.bytes
  }
}

/** Категория величины и её биты по правилам JPEG: отрицательные пишутся дополнением. */
function magnitude(value: number): [number, [number, number]] {
  if (value === 0) return [0, [0, 0]]

  const absolute = Math.abs(value)
  let size = 1
  while (absolute >= 1 << size) size += 1

  const bits = value > 0 ? value : value + (1 << size) - 1
  return [size, [bits & ((1 << size) - 1), size]]
}

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : Math.round(value)
}

/** Перевод в YCbCr по JFIF — то, в чём JPEG хранит цвет. */
function toYCbCr([r, g, b]: Rgb): [number, number, number] {
  return [
    clampByte(0.299 * r + 0.587 * g + 0.114 * b),
    clampByte(128 - 0.168736 * r - 0.331264 * g + 0.5 * b),
    clampByte(128 + 0.5 * r - 0.418688 * g - 0.081312 * b),
  ]
}

function segment(marker: number, payload: number[]): number[] {
  return [0xff, marker, ((payload.length + 2) >> 8) & 0xff, (payload.length + 2) & 0xff, ...payload]
}

function huffmanSegment(id: number, table: HuffmanTable): number[] {
  return segment(0xc4, [id, ...table.bits, ...table.values])
}

/**
 * Собирает JPEG из блоков сплошного цвета.
 *
 * `colorAt` спрашивается по одному разу на блок 8×8 — координаты блочные, не пиксельные.
 * Размер изображения при этом произвольный: блоки, торчащие за край, декодер обрежет по
 * размерам из заголовка.
 */
export function encodeBlockJpeg(
  widthPx: number,
  heightPx: number,
  colorAt: (blockX: number, blockY: number) => Rgb,
): Uint8Array {
  if (!Number.isInteger(widthPx) || !Number.isInteger(heightPx) || widthPx < 1 || heightPx < 1) {
    throw new Error(`Недопустимый размер изображения: ${widthPx} × ${heightPx}`)
  }

  const flatQuantization = new Array<number>(64).fill(1)

  const header: number[] = [
    0xff, 0xd8, // SOI
    ...segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]), // JFIF
    ...segment(0xdb, [0x00, ...flatQuantization]),
    ...segment(0xdb, [0x01, ...flatQuantization]),
    ...segment(0xc0, [
      8,
      (heightPx >> 8) & 0xff, heightPx & 0xff,
      (widthPx >> 8) & 0xff, widthPx & 0xff,
      3,
      1, 0x11, 0, // яркость: без прореживания, таблица квантования 0
      2, 0x11, 1,
      3, 0x11, 1,
    ]),
    ...huffmanSegment(0x00, DC_TABLE), // DC, таблица 0
    ...huffmanSegment(0x10, AC_TABLE), // AC, таблица 0
    ...huffmanSegment(0x01, DC_TABLE),
    ...huffmanSegment(0x11, AC_TABLE),
    ...segment(0xda, [3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]), // SOS
  ]

  const writer = new BitWriter()
  const previous: [number, number, number] = [0, 0, 0]
  const blocksWide = blockCount(widthPx)
  const blocksHigh = blockCount(heightPx)

  for (let by = 0; by < blocksHigh; by++) {
    for (let bx = 0; bx < blocksWide; bx++) {
      const sample = toYCbCr(colorAt(bx, by))

      for (let component = 0; component < 3; component++) {
        // Единственный ненулевой коэффициент блока постоянного цвета. Множитель 8 — та самая
        // нормировка DCT, при делителе квантования 1 обратное преобразование вернёт цвет.
        const dc = 8 * (sample[component] - 128)
        const [size, bits] = magnitude(dc - previous[component])
        previous[component] = dc

        writer.write(DC_TABLE.codes.get(size)!)
        if (size > 0) writer.write(bits)
        writer.write(AC_TABLE.codes.get(0x00)!) // все AC нулевые — сразу конец блока
      }
    }
  }

  return Uint8Array.from([...header, ...writer.end(), 0xff, 0xd9])
}

/**
 * Размер изображения из заголовка JPEG.
 *
 * Нужен на своей стороне, а не только в заглушке: провайдер отдаёт **готовый** кадр
 * (решение шага 0 вехи M4), и единственный способ убедиться, что кадр соответствует
 * профилю FR-25, — прочитать его размеры. На M5, когда провайдер станет настоящим, это
 * останется единственной проверкой, отделяющей «файл, который площадка примет» от
 * «файла, за который пользователь заплатил зря».
 */
export function readJpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null

  let at = 2
  while (at + 3 < bytes.length) {
    if (bytes[at] !== 0xff) return null

    const marker = bytes[at + 1]
    // Заполнители и маркеры без полезной нагрузки длины не несут.
    if (marker === 0xff) { at += 1; continue }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { at += 2; continue }

    const length = (bytes[at + 2] << 8) | bytes[at + 3]

    // SOF любого профиля, кроме маркеров таблиц (0xC4), выравнивания (0xC8) и арифметики
    // (0xCC): размеры лежат сразу за точностью.
    const isFrameHeader =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc

    if (isFrameHeader) {
      if (at + 9 >= bytes.length) return null
      return {
        height: (bytes[at + 5] << 8) | bytes[at + 6],
        width: (bytes[at + 7] << 8) | bytes[at + 8],
      }
    }

    // Начались сжатые данные — заголовков дальше не будет.
    if (marker === 0xda) return null

    at += 2 + length
  }

  return null
}
