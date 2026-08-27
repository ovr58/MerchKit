import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from '@/App'
import './index.css'

// Состояние сервера в UI живёт в TanStack Query (docs/SPEC.md §2): кэш, инвалидация
// и ретраи для баланса и списков генераций приезжают вместе с ним начиная с M2.
const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
