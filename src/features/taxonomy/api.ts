import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'

/**
 * Модуль `catalog-taxonomy` (docs/SPEC.md §3): категории, сценарии показа, маркетплейсы и
 * параметры конечного изображения по паре «площадка × категория».
 *
 * **Читается и гостем.** Мастер генерации проходится без входа целиком — перехват стоит
 * только на «Запустить генерацию» (FR-12), поэтому `select` на этих таблицах выдан и
 * `anon`. Экраны спрашивают справочник здесь, а не запросом в таблицу.
 *
 * Всё четыре справочника грузятся одним хуком: вместе это 38 строк, и раздельные запросы
 * дали бы водопад ожиданий на ровном месте.
 */

export type Category = { id: string; title: string }

export type Preset = {
  id: string
  categoryId: string
  title: string
  description: string
}

export type Marketplace = { id: string; title: string; note: string }

/** Параметры конечного изображения (FR-25). Показываются человеку ДО списания. */
export type OutputProfile = {
  marketplaceId: string
  categoryId: string
  width: number
  height: number
  /** Порог площадки: ниже него файл не примут. Целевой кадр выше по типу — то, что мы
   *  запрашиваем у провайдера и обещаем человеку (миграция 20260829140000). */
  minWidth: number
  minHeight: number
  aspectLabel: string
  /** Форматы, принимаемые площадкой: вендор выбирает из них сам. */
  formats: string[]
  colorSpace: string
  backgroundHex: string
  backgroundTitle: string
}

export type Taxonomy = {
  categories: Category[]
  presets: Preset[]
  marketplaces: Marketplace[]
  profiles: OutputProfile[]
}

/** Категория без предсозданных сценариев: там работает только свободный ввод (FR-08). */
export const FREEFORM_CATEGORY = 'other'

export function presetsOf(taxonomy: Taxonomy | undefined, categoryId: string | null): Preset[] {
  if (!taxonomy || categoryId === null) return []
  return taxonomy.presets.filter((preset) => preset.categoryId === categoryId)
}

export function profileOf(
  taxonomy: Taxonomy | undefined,
  marketplaceId: string | null,
  categoryId: string | null,
): OutputProfile | null {
  if (!taxonomy || marketplaceId === null || categoryId === null) return null
  return (
    taxonomy.profiles.find(
      (profile) => profile.marketplaceId === marketplaceId && profile.categoryId === categoryId,
    ) ?? null
  )
}

export function titleOf(items: { id: string; title: string }[], id: string | null): string | null {
  return items.find((item) => item.id === id)?.title ?? null
}

export function useTaxonomy(): UseQueryResult<Taxonomy> {
  return useQuery({
    queryKey: ['taxonomy'],
    // Справочник за сессию не меняется: он правится миграцией, а не пользователем.
    staleTime: Infinity,
    queryFn: async (): Promise<Taxonomy> => {
      const [categories, presets, marketplaces, profiles] = await Promise.all([
        supabase.from('categories').select('id, title').order('sort_order'),
        supabase
          .from('presets')
          .select('id, category_id, title, description')
          .order('category_id')
          .order('sort_order'),
        supabase.from('marketplaces').select('id, title, note').order('sort_order'),
        supabase
          .from('marketplace_output_profiles')
          .select(
            'marketplace_id, category_id, width, height, min_width, min_height, aspect_label, formats, color_space, background_hex, background_title',
          ),
      ])

      const failed = [categories, presets, marketplaces, profiles].find((result) => result.error)
      if (failed?.error) throw new Error(failed.error.message)

      return {
        categories: (categories.data ?? []) as Category[],
        presets: (presets.data ?? []).map((row) => ({
          id: row.id as string,
          categoryId: row.category_id as string,
          title: row.title as string,
          description: row.description as string,
        })),
        marketplaces: (marketplaces.data ?? []) as Marketplace[],
        profiles: (profiles.data ?? []).map((row) => ({
          marketplaceId: row.marketplace_id as string,
          categoryId: row.category_id as string,
          width: row.width as number,
          height: row.height as number,
          minWidth: row.min_width as number,
          minHeight: row.min_height as number,
          aspectLabel: row.aspect_label as string,
          formats: row.formats as string[],
          colorSpace: row.color_space as string,
          backgroundHex: row.background_hex as string,
          backgroundTitle: row.background_title as string,
        })),
      }
    },
  })
}
