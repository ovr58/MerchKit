// @vitest-environment node
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { extractScene } from './extract.mts'

const fixture = fileURLToPath(new URL('./fixtures/home-chair.html', import.meta.url))
const canvas = { width: 896, height: 1200 }

describe('B2: сцена HTML из Chromium', () => {
  it('снимает кадр, тексты со строками и плашки фикстуры без отказов', async () => {
    const scene = await extractScene(fixture, canvas)

    expect(scene.rejected).toEqual([])
    expect(scene.elements.filter((element) => element.kind === 'frame')).toHaveLength(1)

    const texts = scene.elements.filter((element) => element.kind === 'text')
    expect(texts.length).toBeGreaterThanOrEqual(3)
    for (const text of texts) expect(text.lines?.length ?? 0).toBeGreaterThanOrEqual(1)

    for (const { rect } of scene.elements) {
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.y).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.w).toBeLessThanOrEqual(canvas.width)
      expect(rect.y + rect.h).toBeLessThanOrEqual(canvas.height)
    }

    const title = texts.find((text) => text.lines?.[0]?.text === 'Кресло')
    expect(title?.style.fontWeight).toBe(900)
    expect(title?.style.textTransform).toBe('uppercase')
    // Значение «Три цветных блока» Chromium переносит на две строки.
    const wrapped = texts.find((text) => text.lines?.[0]?.text === 'Три цветных')
    expect(wrapped?.lines?.map((line) => line.text)).toEqual(['Три цветных', 'блока'])
    expect(scene.elements.map((element) => element.order)).toEqual(scene.elements.map((_, at) => at))
  }, 60_000)

  it('отклоняет элементы вне подмножества', async () => {
    const { mkdtemp, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = await mkdtemp(join(tmpdir(), 'extract-'))
    const path = join(dir, 'bad.html')
    await writeFile(
      path,
      `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">
<div id="card" style="position:relative;width:200px;height:200px">
<div id="turned" style="position:absolute;left:10px;top:10px;font:20px Montserrat;transform:rotate(5deg)">Слово</div>
<svg id="pic" width="10" height="10"></svg>
</div></body></html>`,
    )

    const scene = await extractScene(path, { width: 200, height: 200 })

    expect(scene.rejected.map((rejection) => rejection.selector).sort()).toEqual(['svg#pic', 'div#turned'].sort())
  }, 60_000)
})
