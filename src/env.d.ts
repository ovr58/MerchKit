/// <reference types="vite/client" />

// Дополняет ImportMetaEnv из vite/client: клиентские переменные проекта с точными типами.
// Читаются только через src/lib/env.ts — там же они и проверяются.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string | undefined
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string | undefined
}
