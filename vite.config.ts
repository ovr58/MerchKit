import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Расчёты, обязанные совпадать на клиенте и на сервере, живут одним файлом рядом с
      // Edge Functions — см. шапку `supabase/functions/_shared/pricing.ts`.
      '@shared': fileURLToPath(new URL('./supabase/functions/_shared', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Общий с сервером код лежит вне `src/`, но проверяется тем же прогоном: тест рядом
    // с модулем, а не в другом дереве.
    include: [
      'src/**/*.test.{ts,tsx}',
      'supabase/functions/_shared/**/*.test.ts',
      'tools/**/*.test.ts',
    ],
  },
})
