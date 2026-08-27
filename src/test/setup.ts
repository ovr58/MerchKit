import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Vitest здесь без глобалей, поэтому автоуборка Testing Library не подключается сама:
// без этого разметка предыдущего теста остаётся в документе и ломает поиск по подписи.
afterEach(cleanup)
