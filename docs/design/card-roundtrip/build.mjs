/**
 * Сборка страницы V-13 из исходника с плейсхолдерами.
 *
 * Девять картинок держать в репозитории вторым, раздутым base64 экземпляром незачем — они уже
 * лежат в `docs/assets/cardsforsysprompt/`. Скрипт уменьшает их до 340 px по ширине (тем же
 * `resvg`, что собирает карточки) и подставляет в исходник.
 *
 * Запуск из корня репозитория:
 *   node docs/design/card-roundtrip/build.mjs > /tmp/peresborka-obrazcov.html
 *
 * Собранный файл — около 2,3 МБ, публикуется инструментом `Artifact` по тому же URL
 * (параметр `url`). В репозиторий не кладётся.
 */
import { readFile } from 'node:fs/promises'
import { initWasm, Resvg } from '@resvg/resvg-wasm'

const WIDTH = 340
const DIR = 'docs/assets/cardsforsysprompt/'
const SOURCES = {
  JACKET: 'пример карточки верхней одежды',
  DRESS: 'пример карточки женской одежды',
  TSHIRT: 'пример карточки одежды',
}
const KINDS = { ORIG: '', REBUILT: '.rebuilt', LAYERS: '.layers' }

await initWasm(await readFile('node_modules/@resvg/resvg-wasm/index_bg.wasm'))

async function thumb(file) {
  const bytes = await readFile(DIR + file)
  const height = Math.round((bytes.readUInt32BE(20) / bytes.readUInt32BE(16)) * WIDTH)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}">` +
    `<image width="${WIDTH}" height="${height}" ` +
    `href="data:image/png;base64,${bytes.toString('base64')}"/></svg>`
  const png = new Resvg(svg).render().asPng()
  return `data:image/png;base64,${Buffer.from(png).toString('base64')}`
}

let html = await readFile('docs/design/card-roundtrip/peresborka-obrazcov.src.html', 'utf8')

for (const [key, stem] of Object.entries(SOURCES)) {
  for (const [kind, suffix] of Object.entries(KINDS)) {
    html = html.replace(`__IMG_${key}_${kind}__`, await thumb(`${stem}${suffix}.png`))
  }
}

if (html.includes('__IMG_')) {
  throw new Error('в исходнике остался неподставленный плейсхолдер')
}

process.stdout.write(html)
