/**
 * Файлы, без которых Edge-сборщик не может перевести SVG в PNG. Они лежат в приватном Storage,
 * а не рядом с функцией: пополнение шрифтов — операция с данными, а не релиз кода.
 */

export const CARD_RENDER_ASSETS_BUCKET = 'card-render-assets'

const WASM_PATH = 'resvg/index_bg.wasm'
const FONT_MANIFEST_PATH = 'fonts/manifest.json'

export type RendererAssets = { wasm: Uint8Array; fonts: Uint8Array[] }
export type DownloadFile = (bucket: string, path: string) => Promise<Uint8Array>

type FontManifest = { fonts: string[] }

/**
 * Один экземпляр создаётся на модуль Edge Function. Promise ставится в кэш до первого await:
 * параллельные сборки на холодном старте делят одну загрузку, а не скачивают файлы каждая.
 */
export function createRendererAssets(downloadFile: DownloadFile): () => Promise<RendererAssets> {
  let cached: Promise<RendererAssets> | undefined

  return async (): Promise<RendererAssets> => {
    if (cached === undefined) {
      cached = loadAssets(downloadFile).catch((error: unknown) => {
        cached = undefined
        throw error
      })
    }
    return cached
  }
}

async function loadAssets(downloadFile: DownloadFile): Promise<RendererAssets> {
  const [wasm, manifestBytes] = await Promise.all([
    downloadFile(CARD_RENDER_ASSETS_BUCKET, WASM_PATH),
    downloadFile(CARD_RENDER_ASSETS_BUCKET, FONT_MANIFEST_PATH),
  ])
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as unknown
  if (!isFontManifest(manifest)) throw new Error('Файл fonts/manifest.json содержит некорректный список шрифтов')

  return {
    wasm,
    fonts: await Promise.all(manifest.fonts.map((path) => downloadFile(CARD_RENDER_ASSETS_BUCKET, path))),
  }
}

function isFontManifest(value: unknown): value is FontManifest {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { fonts?: unknown }).fonts) &&
    (value as { fonts: unknown[] }).fonts.every(
      (path) => typeof path === 'string' && /^fonts\/[a-z0-9]+(?:-[a-z0-9]+)*\.ttf$/.test(path),
    )
  )
}
