/**
 * Публичный интерфейс модуля `generation-wizard` (docs/SPEC.md §3): сборка параметров
 * генерации, запуск заявки и чтение её статуса. Черновик, распознавание и работа с
 * хранилищем остаются внутри.
 */

export {
  downloadResult,
  launchGeneration,
  previewCard,
  restoreDraftFrom,
  signedResultUrl,
  useCatalog,
  useGeneration,
  useInvalidateAfterLaunch,
  type CardPreview,
  type CardPreviewOverflow,
  type DraftRestore,
  type Generation,
  type GenerationStatus,
  type LaunchOutcome,
} from './api'
export {
  clearDraft,
  LAST_STEP,
  STEPS,
  type DraftLogo,
  type DraftPhoto,
  type WizardDraft,
} from './draft'
export {
  addProductProperty,
  moveProductProperty,
  removeProductProperty,
  updateProductProperty,
  type ProductProperty,
} from './properties'
export { blockedBy, useWizard, type Wizard } from './wizard'
