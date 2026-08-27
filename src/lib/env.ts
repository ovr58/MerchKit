/**
 * Граница конфигурации фронтенда. Переменные проверяются один раз при загрузке модуля,
 * чтобы отсутствующий ключ падал понятной ошибкой на старте, а не `undefined` где-то
 * в середине запроса.
 *
 * Сюда попадает ТОЛЬКО то, что можно показывать любому посетителю: всё с префиксом
 * `VITE_` попадает в бандл. Ключ AI-шлюза и service-role здесь появиться не могут —
 * их место в секретах Edge Functions (docs/SPEC.md §5).
 */

function required(name: string, value: string | undefined): string {
  if (value === undefined || value.trim() === '') {
    throw new Error(
      `Переменная окружения ${name} не задана. Скопируйте .env.example в .env и заполните её.`,
    )
  }
  return value
}

export const env = {
  supabaseUrl: required('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL),
  supabasePublishableKey: required(
    'VITE_SUPABASE_PUBLISHABLE_KEY',
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  ),
} as const
