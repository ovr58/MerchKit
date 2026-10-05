import { describe, expect, it } from 'vitest'

import { isReferenceFile, storagePathOf, unlistedRows } from './references-lib.ts'

/**
 * Каталог референсов (C4): `push` берёт в каталог только образцы, а `retire --unlisted` выводит из
 * выбора строки, которых в текущем наборе нет. 2026-10-05 `push` из основного дерева завёл 92 строки
 * вместо 31: рядом с образцами лежат производные гейта round-trip (`*.layers.png`, `*.rebuilt.png`).
 */
describe('C4: отбор файлов-референсов', () => {
  it('берёт картинки образцов', () => {
    expect(isReferenceFile('Снимок экрана 2026-08-31 173733.jpg')).toBe(true)
    expect(isReferenceFile('образец.PNG')).toBe(true)
    expect(isReferenceFile('образец.webp')).toBe(true)
  })

  it('не берёт производные round-trip — те же шаблоны, что в .gitignore', () => {
    expect(isReferenceFile('Снимок экрана 2026-08-31 173733.layers.png')).toBe(false)
    expect(isReferenceFile('Снимок экрана 2026-08-31 173733.rebuilt.png')).toBe(false)
  })

  it('не берёт не-картинки', () => {
    expect(isReferenceFile('Снимок экрана 2026-08-31 173733.json')).toBe(false)
    expect(isReferenceFile('README.md')).toBe(false)
  })
})

describe('C4: путь в бакете', () => {
  it('<площадка>/<категория>/<sha256>.<расширение>, .jpeg → .jpg', () => {
    const bytes = new TextEncoder().encode('abc')
    const hash = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    expect(storagePathOf('wildberries', 'clothing', bytes, '.JPEG')).toBe(`wildberries/clothing/${hash}.jpg`)
    expect(storagePathOf('ozon', 'home', bytes, '.png')).toBe(`ozon/home/${hash}.png`)
  })
})

describe('C4: строки вне текущего набора', () => {
  const row = (storage_path: string, status = 'active') => ({ id: storage_path, storage_path, status })

  it('активные строки, чьих путей набор не выводит, — лишние', () => {
    const rows = [row('wb/a/1.png'), row('wb/a/2.png'), row('wb/a/3.png')]
    expect(unlistedRows(rows, new Set(['wb/a/1.png', 'wb/a/3.png'])).map((r) => r.storage_path)).toEqual(['wb/a/2.png'])
  })

  it('выведенные из выбора не трогает повторно', () => {
    const rows = [row('wb/a/1.png'), row('wb/a/2.png', 'retired')]
    expect(unlistedRows(rows, new Set(['wb/a/1.png']))).toEqual([])
  })
})
