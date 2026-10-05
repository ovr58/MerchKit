/**
 * Шов раннера выреза — шаг B4 плана
 * [`card-assembly-pipeline_2026-08-31.md`](../../../../planning/active/card-assembly-pipeline_2026-08-31.md).
 *
 * **Это тип функции, а не интерфейсный слой.** Вызывающих у раннера двое (сборка карточки и
 * офлайн-оснастка), и тестам нужна подмена: юнит-тест сборки не должен поднимать 214 МБ весов,
 * чтобы проверить, что слой лёг куда надо. Но двое вызывающих одного кода — это не две
 * реализации, и абстракции они не требуют; приём тот же, что у `DownloadFile` в
 * `renderer-assets.ts`. Обещание [ADR-0014](../../../../docs/adr/0014-cutout-runner-onnx-behind-interface.md)
 * «реализации сменные» этим выполнено: другая реализация — просто другая функция того же типа.
 *
 * **Сама модель здесь не считается и не может считаться.** По
 * [ADR-0015](../../../../docs/adr/0015-card-service-on-vps-not-edge-function.md) инференс живёт
 * в своём сервисе на VPS: в изолят он не помещается вовсе. Отсюда единственная реализация в
 * этом файле — HTTP-вызов, и граница доверия у неё из
 * [ADR-0016](../../../../docs/adr/0016-cutout-service-trust-boundary.md): общий секрет в
 * заголовке поверх TLS, никаких ключей проекта на той стороне.
 *
 * **`null` — законный ответ, а не сбой.** Вырез нужен 4 макетам из 34; нет выреза — слой
 * `cutout` снимается правилом K-3, и карточка собирается без него. Поэтому *любой* отказ
 * сервиса — недоступен, отвергнул секрет, не уложился в срок — превращается здесь в `null`, а
 * не в исключение: пользователь не должен терять генерацию из-за коробки, которой может не
 * быть вовсе. Причина при этом обязана попасть в журнал, иначе молчаливый `null` не отличить
 * от честного «товар не найден».
 *
 * **По сети едет вырез, а не маска.** ADR-0014 описывает операцию как «кадр → маска того же
 * размера», и по смыслу так и есть — новых пикселей не появляется, альфа накладывается на тот
 * же растр. Но накладывает её сервис, а не мы: у него кадр уже разобран в пиксели, а в изоляте
 * ради этого пришлось бы заводить декодер и кодировщик PNG — ровно ту работу, которую ADR-0015
 * оттуда и унёс. Наружу шов отдаёт готовый к отрисовке `ImageRef`, и это то, чего ждёт
 * `CardContent.cutout`.
 */

import { mimeOf, readImageInfo } from '../image.ts'
import { encodeBlockJpeg } from '../jpeg.ts'
import type { HtmlScene } from './html/scene.ts'
import type { MaskSamples } from './occupancy.ts'
import type { ImageRef } from './types.ts'

export type CutoutRunner = (frame: ImageRef) => Promise<ImageRef | null>

export type CutoutServiceConfig = {
  /** Полный адрес операции, например `https://cutout.example.ru/cutout`. */
  endpoint: string
  /** Общий секрет из ADR-0016. В код не попадает — приходит конфигурацией. */
  secret: string
  /** По умолчанию 10 с. Прежние 90 с ставились под BiRefNet (12–24 с инференса плюс 5 с
   *  загрузки сессии); модель снята, и потолок оказался избыточен почти в сто раз.
   *  Замер на самой коробке 2026-09-09 (`u2netp`, 1 ядро / 955 МБ): вырез 0,61–0,96 с на
   *  кадрах 768×1024 и 1024×683, **0,93–1,13 с на кадре площадки 1440×1920**; загрузка
   *  сессии после перезапуска — 158 мс, а не 5 с.
   *  Почему 10, а не 2: сервис пропускает один вырез за раз, и второй запрос ждёт первого,
   *  поэтому бюджет должен вмещать два выреза подряд плюс сеть. Ниже 5 с опускать нельзя —
   *  получим ложный таймаут на втором запросе там, где сервис исправен. */
  timeoutMs?: number
  /** Подмена в тестах. */
  fetch?: typeof globalThis.fetch
}

const DEFAULT_TIMEOUT_MS = 10_000

export function createCutoutRunner(config: CutoutServiceConfig): CutoutRunner {
  const call = config.fetch ?? globalThis.fetch
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return async (frame: ImageRef): Promise<ImageRef | null> => {
    const source = decodeDataUri(frame.dataUri)
    if (source === null) {
      console.error('Вырез: кадр не в форме data-URI, запрос не отправлен')
      return null
    }

    try {
      const response = await call(config.endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.secret}`, 'content-type': source.mime },
        body: source.bytes,
        signal: AbortSignal.timeout(timeoutMs),
      })

      // Сервис сам решил, что товара на кадре нет. Это не ошибка и в журнал не идёт.
      if (response.status === 204) return null

      if (!response.ok) {
        console.error(`Вырез: сервис ответил ${response.status}`)
        return null
      }

      const bytes = new Uint8Array(await response.arrayBuffer())
      const info = readImageInfo(bytes)

      // Размер проверяем по самому файлу, а не по слову отправителя: слой `cutout` ложится на
      // `frame` пиксель в пиксель, и вырез другого размера — это сдвоенный контур в кадре, а
      // не мелкое расхождение. Ровно та же осторожность, что в `image.ts`.
      if (info === null || info.width !== frame.width || info.height !== frame.height) {
        console.error(
          `Вырез: ожидался ${frame.width}×${frame.height}, получено ` +
            (info === null ? 'нераспознанное изображение' : `${info.width}×${info.height}`),
        )
        return null
      }

      return {
        dataUri: `data:${mimeOf(info.format)};base64,${toBase64(bytes)}`,
        width: info.width,
        height: info.height,
      }
    } catch (error) {
      console.error('Вырез: сервис не ответил', error)
      return null
    }
  }
}

/** Длинная сторона сэмплов маски — контракт `POST /mask`, ADR-0018 п. 4. */
const MASK_LONG_SIDE = 256

export type MaskRunner = (frame: ImageRef) => Promise<MaskSamples | null>

/**
 * Сырые сэмплы альфы от `POST /mask` сервиса выреза — шаг B5.2 плана, контракт в
 * [ADR-0018](../../../../docs/adr/0018-art-director-layout-patch.md), п. 4. Карту занятости из них
 * считает `occupancyOf`; декодера PNG в изоляте нет и не будет.
 *
 * Отказы те же, что у выреза: `null` и причина в журнале, исключение наружу не уходит. Ответ
 * проверяется целиком — сэмплы чужой длины или чужой пропорции молча исказили бы карту, а
 * `occupancyOf` на них бросает, и сборка потеряла бы карточку из-за коробки.
 */
export function createMaskRunner(config: CutoutServiceConfig): MaskRunner {
  const call = config.fetch ?? globalThis.fetch
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return async (frame: ImageRef): Promise<MaskSamples | null> => {
    const source = decodeDataUri(frame.dataUri)
    if (source === null) {
      console.error('Маска: кадр не в форме data-URI, запрос не отправлен')
      return null
    }

    try {
      const response = await call(config.endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.secret}`, 'content-type': source.mime },
        body: source.bytes,
        signal: AbortSignal.timeout(timeoutMs),
      })

      // Сервис сам решил, что товара на кадре нет. Это не ошибка и в журнал не идёт.
      if (response.status === 204) return null

      if (!response.ok) {
        console.error(`Маска: сервис ответил ${response.status}`)
        return null
      }

      const width = Number(response.headers.get('x-mask-width'))
      const height = Number(response.headers.get('x-mask-height'))
      const alpha = new Uint8Array(await response.arrayBuffer())

      if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
        console.error(
          `Маска: размер в заголовках не целое положительное: ` +
            `${response.headers.get('x-mask-width')}×${response.headers.get('x-mask-height')}`,
        )
        return null
      }
      if (alpha.length !== width * height) {
        console.error(`Маска: ${width}×${height} заявлено, тело ${alpha.length} байт`)
        return null
      }
      if (Math.max(width, height) !== MASK_LONG_SIDE) {
        console.error(`Маска: длинная сторона ${Math.max(width, height)}, ожидалось ${MASK_LONG_SIDE}`)
        return null
      }
      if (Math.abs(width / height - frame.width / frame.height) > 1 / height) {
        console.error(`Маска: ${width}×${height} не в пропорции кадра ${frame.width}×${frame.height}`)
        return null
      }

      return { width, height, alpha }
    } catch (error) {
      console.error('Маска: сервис не ответил', error)
      return null
    }
  }
}

/** Страница сочинения для `POST /layout`: HTML, холст карточки и размер кадра в пикселях. */
export type LayoutPage = {
  html: string
  canvas: { width: number; height: number }
  frame: { width: number; height: number }
}

export type LayoutRunner = (page: LayoutPage) => Promise<HtmlScene | null>

/** Потолок вызова сцены. Коробка снимает страницу не дольше 10 с (свой таймаут, ответ 422
 *  `timeout`) и пускает одну тяжёлую работу за раз — сверху очередь за вырезом (~1 с) и сеть.
 *  Ниже 10 с ставить нельзя: оборвали бы ответ, который коробка ещё вправе дать. */
const LAYOUT_TIMEOUT_MS = 15_000

/** Цвет заглушки кадра. Сцене нужны только размеры: боксы снимает CSS, а не пиксели кадра. */
const PLACEHOLDER_GREY = [128, 128, 128] as const

/**
 * Сцена страницы сочинения от `POST /layout` коробки выреза —
 * [ADR-0019](../../../../docs/adr/0019-html-authoring-transpiled-to-layers.md), п. 4; контракт —
 * `docs/SPEC.md` §5 репозитория `cutout_runner`.
 *
 * **Кадр по сети не едет.** Лимит тела коробки — 2 МиБ вместе с кадром в data-URI, а сцене нужны
 * только размеры: вместо фото уходит одноцветный JPEG того же размера (решение супервизора
 * 2026-10-05). JPEG, а не PNG: кодировщик блочного JPEG у нас уже есть (`jpeg.ts`), а коробка
 * принимает оба.
 *
 * Отказы — как у выреза и маски: `null` и одна строка причины в журнал, исключение наружу не
 * уходит. Решает вызывающий: `null` значит откат на макет библиотеки (ADR-0019, п. 6).
 */
export function createLayoutRunner(config: CutoutServiceConfig): LayoutRunner {
  const call = config.fetch ?? globalThis.fetch
  const timeoutMs = config.timeoutMs ?? LAYOUT_TIMEOUT_MS

  return async (page: LayoutPage): Promise<HtmlScene | null> => {
    try {
      const placeholder = encodeBlockJpeg(page.frame.width, page.frame.height, () => PLACEHOLDER_GREY)
      const response = await call(config.endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.secret}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          html: page.html,
          canvas: page.canvas,
          frame: `data:image/jpeg;base64,${toBase64(placeholder)}`,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })

      if (!response.ok) {
        // 422 несёт причину из закрытого списка (`script` · `url` · `timeout`) — она и есть диагноз.
        const refusal = response.status === 422
          ? ((await response.json().catch(() => null)) as { reason?: unknown } | null)?.reason
          : undefined
        console.error(`Сцена: сервис ответил ${response.status}${typeof refusal === 'string' ? ` (${refusal})` : ''}`)
        return null
      }

      const scene = (await response.json().catch(() => null)) as HtmlScene | null
      if (
        scene === null || typeof scene !== 'object' || !Array.isArray(scene.elements) ||
        !Array.isArray(scene.rejected) || typeof scene.canvas !== 'object' || scene.canvas === null
      ) {
        console.error('Сцена: ответ 200 — не сцена')
        return null
      }

      return scene
    } catch (error) {
      console.error('Сцена: сервис не ответил', error)
      return null
    }
  }
}

function decodeDataUri(dataUri: string): { mime: string; bytes: Uint8Array } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUri)
  if (match === null) return null

  const binary = atob(match[2])
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return { mime: match[1], bytes }
}

/** Кадр — сотни килобайт, а `String.fromCharCode` с таким числом аргументов переполняет стек
 *  вызовов. Поэтому по кускам, а не одной строкой. */
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}
