/**
 * Публичный интерфейс модуля `generation-wizard` (docs/SPEC.md §3): сборка параметров
 * генерации, запуск заявки и чтение её статуса. Черновик, распознавание и работа с
 * хранилищем остаются внутри.
 */

export {
  downloadResult,
  launchGeneration,
  restoreDraftFrom,
  signedResultUrl,
  useCatalog,
  useGeneration,
  useInvalidateAfterLaunch,
  type Generation,
  type GenerationStatus,
  type LaunchOutcome,
} from './api'
export { clearDraft, hasPendingDraft, type DraftPhoto, type WizardDraft } from './draft'
export { blockedBy, LAST_STEP, STEPS, useWizard, type Wizard } from './wizard'
