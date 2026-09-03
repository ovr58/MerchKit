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
import type { ImageRef } from './types.ts'

export type CutoutRunner = (frame: ImageRef) => Promise<ImageRef | null>

export type CutoutServiceConfig = {
  /** Полный адрес операции, например `https://cutout.example.ru/cutout`. */
  endpoint: string
  /** Общий секрет из ADR-0016. В код не попадает — приходит конфигурацией. */
  secret: string
  /** По умолчанию 90 с: замер даёт 12–24 с инференса на машине разработки, коробка слабее, и
   *  к первому запросу после перезапуска добавляется 5 с загрузки сессии. */
  timeoutMs?: number
  /** Подмена в тестах. */
  fetch?: typeof globalThis.fetch
}

const DEFAULT_TIMEOUT_MS = 90_000

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
