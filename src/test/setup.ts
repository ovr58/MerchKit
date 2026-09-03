import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Vitest здесь без глобалей, поэтому автоуборка Testing Library не подключается сама:
// без этого разметка предыдущего теста остаётся в документе и ломает поиск по подписи.
afterEach(cleanup)

/**
 * `Blob.arrayBuffer` — пробел jsdom, а не браузеров: метод есть везде, куда мы целимся, и
 * им читается выбранный файл знака (`wizard.ts`, шаг B3). Дописываем его через `FileReader`,
 * который jsdom реализует, — иначе код пришлось бы писать под ограничение тестовой среды.
 */
if (typeof Blob.prototype.arrayBuffer !== 'function') {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = () => reject(reader.error ?? new Error('Файл не прочитался'))
      reader.readAsArrayBuffer(this)
    })
  }
}
