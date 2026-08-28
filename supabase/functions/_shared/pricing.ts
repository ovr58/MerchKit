/**
 * Модуль `pricing` (docs/SPEC.md §3): цена генерации в баллах.
 *
 * **Лежит в `supabase/functions/_shared/`, а не в `src/`, намеренно.** Спека требует
 * одинакового расчёта на клиенте и на сервере при серверном источнике правды. Две копии
 * одной формулы расходятся — вопрос времени, поэтому копия здесь одна: клиент подключает
 * её алиасом `@shared`, Edge Functions — относительным путём. Обратное направление
 * (файл в `src/`, импорт из Deno) не годится: Supabase CLI выкладывает содержимое
 * `supabase/functions/`, и код за его пределами в облако может не доехать.
 *
 * Зависимостей нет и не будет: файл собирается и Vite, и Deno.
 */

/** Что именно создаём — `generations.kind` (CONTEXT.md «Тип генерации»). */
export type GenerationKind = 'photo' | 'card'

/** Цена одного объекта. Утверждено пользователем 2026-08-27, docs/TZ.md §11. */
export const OBJECT_PRICE = 50

/** Надбавка за тип «карточка»: сверх объектов пишутся заголовок и описание. */
export const CARD_SURCHARGE = 5

/**
 * Потолок объектов за генерацию. Это **политика продаж, а не техническое ограничение**
 * (docs/TZ.md §11): вся мощность вызова идёт на один результат.
 */
export const MAX_OBJECTS_PER_GENERATION = 1

/**
 * Цена генерации в баллах.
 *
 * Надбавка за «карточку» берётся один раз за генерацию, а не за каждый объект: тексты
 * карточки пишутся на генерацию целиком. При нынешнем потолке в один объект оба прочтения
 * §11 дают одно и то же число — различие проявится, только если потолок поднимут.
 */
export function generationPrice(kind: GenerationKind, objects: number): number {
  if (!Number.isInteger(objects) || objects < 1 || objects > MAX_OBJECTS_PER_GENERATION) {
    throw new Error(
      `Недопустимое число объектов: ${objects}. Допустимо от 1 до ${MAX_OBJECTS_PER_GENERATION}`,
    )
  }

  return objects * OBJECT_PRICE + (kind === 'card' ? CARD_SURCHARGE : 0)
}

/**
 * Сколько объектов ещё по карману. Считается по базовой цене объекта без надбавки — это
 * подсказка в профиле («хватит на N объектов»), а не проверка перед списанием.
 */
export function affordableObjects(balance: number): number {
  return Math.max(0, Math.floor(balance / OBJECT_PRICE))
}
