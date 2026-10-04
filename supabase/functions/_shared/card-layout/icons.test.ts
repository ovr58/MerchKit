import { describe, expect, it } from 'vitest'
import { readIcons } from './icons.ts'

describe('readIcons (B5.8, B5.9)', () => {
  it('переводит bytea `\\x<hex>` в SVG-картинку 24 × 24', async () => {
    // «<svg/>» в шестнадцатеричной записи PostgREST.
    const select = async () => [{ name: 'check', content: '\\x3c7376672f3e' }]
    const refs = await readIcons(['check'], select)

    expect(refs).toEqual({
      check: { dataUri: `data:image/svg+xml;base64,${btoa('<svg/>')}`, width: 24, height: 24 },
    })
  })

  it('спрашивает только готовые иконки по закодированным именам', async () => {
    const queries: string[] = []
    await readIcons(['a b', 'щит'], async (query) => {
      queries.push(query)
      return []
    })

    expect(queries).toEqual([
      `card_icons?select=name,content&name=in.(a%20b,${encodeURIComponent('щит')})&status=eq.${encodeURIComponent('готово')}`,
    ])
  })
})
