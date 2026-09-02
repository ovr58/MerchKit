/**
 * Свойство товара для модулей карточки: порядок в списке — порядок важности продавца.
 *
 * `id` живёт только у клиента: он даёт строке стабильный ключ, когда список переставляют и
 * прореживают. На сервер уезжают одни пары — там строку опознаёт позиция в массиве.
 */
export type ProductProperty = { id: string; label: string; value: string }

/** Пара без ключа строки — то, что уходит в заявку и хранится с генерацией. */
export type ProductPropertyPair = { label: string; value: string }

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Ответ модели и сохранённый черновик — недоверенные границы, поэтому чистим оба здесь. */
export function normalizeProductProperties(value: unknown): ProductProperty[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry) => {
    if (entry === null || typeof entry !== 'object') return []

    const { id, label, value } = entry as { id?: unknown; label?: unknown; value?: unknown }
    if (typeof label !== 'string' || typeof value !== 'string') return []

    // Ключ строки переживает перезагрузку вместе с черновиком, а у ответа модели его нет.
    const property = {
      id: typeof id === 'string' && id !== '' ? id : crypto.randomUUID(),
      label: text(label),
      value: text(value),
    }
    return property.label === '' && property.value === '' ? [] : [property]
  })
}

export function productPropertiesPayload(properties: ProductProperty[]): ProductPropertyPair[] {
  return normalizeProductProperties(properties).map(({ label, value }) => ({ label, value }))
}

export function addProductProperty(properties: ProductProperty[]): ProductProperty[] {
  return [...properties, { id: crypto.randomUUID(), label: '', value: '' }]
}

export function updateProductProperty(
  properties: ProductProperty[],
  index: number,
  patch: Partial<ProductProperty>,
): ProductProperty[] {
  return properties.map((property, current) => current === index ? { ...property, ...patch } : property)
}

export function removeProductProperty(properties: ProductProperty[], index: number): ProductProperty[] {
  return properties.filter((_, current) => current !== index)
}

export function moveProductProperty(
  properties: ProductProperty[],
  index: number,
  direction: -1 | 1,
): ProductProperty[] {
  const target = index + direction
  if (target < 0 || target >= properties.length) return properties

  const reordered = [...properties]
  ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
  return reordered
}
