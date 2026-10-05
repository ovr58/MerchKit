/**
 * Чистые правила каталога референсов (`references.mts`, шаг C4): какой файл — образец, какой путь
 * он получит в бакете и какие строки каталога в текущем наборе не встречаются. Без сети и без
 * диска, чтобы тест держал их отдельно от скрипта.
 */

import { createHash } from 'node:crypto'
import { extname } from 'node:path'

export const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

/**
 * Производные гейта round-trip рядом с образцами — те же шаблоны, что в `.gitignore`. В чистом
 * дереве их нет, в рабочем есть: 2026-10-05 `push` из основного дерева завёл их референсами.
 */
const DERIVED_SUFFIXES = ['.layers.png', '.rebuilt.png']

/** Файл — образец: картинка по расширению и не производная round-trip. */
export function isReferenceFile(name: string): boolean {
  const lower = name.toLowerCase()
  return CONTENT_TYPES[extname(lower)] !== undefined && !DERIVED_SUFFIXES.some((suffix) => lower.endsWith(suffix))
}

/** `<площадка>/<категория>/<sha256>.<расширение>`; `.jpeg` пишется как `.jpg`. */
export function storagePathOf(marketplaceId: string, categoryId: string, bytes: Uint8Array, ext: string): string {
  const lower = ext.toLowerCase()
  const hash = createHash('sha256').update(bytes).digest('hex')
  return `${marketplaceId}/${categoryId}/${hash}${lower === '.jpeg' ? '.jpg' : lower}`
}

/** Активные строки, чьих путей текущий набор не выводит: их выводит из выбора `retire --unlisted`. */
export function unlistedRows<T extends { storage_path: string; status: string }>(rows: T[], listed: Set<string>): T[] {
  return rows.filter((row) => row.status === 'active' && !listed.has(row.storage_path))
}
