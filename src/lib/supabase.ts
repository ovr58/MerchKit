import { createClient } from '@supabase/supabase-js'

import { env } from '@/lib/env'

/**
 * Единственный клиент Supabase на приложение. Работает под публикуемым ключом —
 * данные защищает RLS, а не секретность ключа (docs/SPEC.md §5).
 */
export const supabase = createClient(env.supabaseUrl, env.supabasePublishableKey)
