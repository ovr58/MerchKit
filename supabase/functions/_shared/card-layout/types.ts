/**
 * Язык макета карточки — шаг A1 плана
 * [`card-assembly-pipeline_2026-08-31.md`](../../../../planning/active/card-assembly-pipeline_2026-08-31.md).
 *
 * **Макет — это данные, а не картинка и не промпт.** Модель изображений рисует сцену;
 * заголовок, характеристики, плашки и логотип ставит наша программа по этому описанию
 * ([ADR-0012](../../../../docs/adr/0012-card-layout-is-ours-not-vendors.md)). Отсюда два
 * свойства, которых у прежней схемы не было: текст выходит ровно тот, что задан, а повторная
 * сборка ничего не стоит.
 *
 * **Геометрия — в долях холста, а не в пикселях.** Один и тот же макет собирается под кадр
 * любой площадки (FR-25): пиксели приходят из `OutputProfile` в момент сборки. Пиксели в
 * макете означали бы отдельный макет на каждую пару «маркетплейс × категория» — 21 копию
 * одного и того же.
 *
 * **Словари закрытые.** Тип слоя, режим наложения, эффект, роль шрифта — перечисления, а не
 * свободные строки. Причина не в аккуратности: макеты придёт сочинять модель (шаг A4 —
 * разбор образца, шаг B5 — арт-директор), и всё, чего нет в словаре, она сочинит. Закрытый
 * словарь превращает «сборщик не умеет такой эффект» из брака в кадре в отказ валидатора до
 * рендера.
 *
 * **Число и порядок слоёв не фиксированы** (решение пользователя 2026-08-31). Логотип может
 * лежать и перед моделью, и за ней — поэтому z-порядок хранится полем, а не подразумевается
 * жёстким шаблоном.
 *
 * Правило отсутствующего ассета (K-3) живёт в `validate.ts`, а не здесь: это поведение
 * сборки, а не форма записи.
 */

/** Доля стороны холста: 0 — левый (верхний) край, 1 — правый (нижний). Значения вне [0, 1]
 *  законны — так задаётся вылет за обрез, например слово-подложка, уходящее за правый край. */
export type Fraction = number

/** Прямоугольник в долях. У вложенного слоя — доли бокса группы, а не холста. */
export type Box = { x: Fraction; y: Fraction; w: Fraction; h: Fraction }

/** Точка интереса кадра в долях самого кадра: что не должно уйти под обрез при `cover`. */
export type Focus = { x: Fraction; y: Fraction }

export const LAYER_TYPES = ['frame', 'cutout', 'shape', 'asset', 'text', 'group'] as const
export type LayerType = (typeof LAYER_TYPES)[number]

/** Наложение. Три режима, а не пятнадцать из CSS: больше сборщик не умеет, а чего он не
 *  умеет — того нет в словаре. */
export const BLEND_MODES = ['normal', 'multiply', 'screen'] as const
export type BlendMode = (typeof BLEND_MODES)[number]

/** Роль шрифта, а не гарнитура (шаг A4): по растру образца гарнитуру достоверно не
 *  восстановить и чаще всего не лицензировать. Роль отображается в конкретный файл базой
 *  шрифтов на стороне сборщика. */
export const FONT_ROLES = ['display', 'heading', 'body', 'label', 'accent'] as const
export type FontRole = (typeof FONT_ROLES)[number]

/** Текстовые гнёзда карточки. Характеристики товара сюда не входят — у них своя привязка
 *  `prop`, потому что их число переменное. */
export const TEXT_SLOTS = ['title', 'subtitle', 'kicker', 'body', 'sizes', 'brand'] as const
export type TextSlot = (typeof TEXT_SLOTS)[number]

export const TEXT_ALIGNS = ['left', 'center', 'right'] as const
export type TextAlign = (typeof TEXT_ALIGNS)[number]

export const TEXT_VALIGNS = ['top', 'middle', 'bottom'] as const
export type TextValign = (typeof TEXT_VALIGNS)[number]

export const TEXT_TRANSFORMS = ['none', 'upper'] as const
export type TextTransform = (typeof TEXT_TRANSFORMS)[number]

export const FIT_MODES = ['cover', 'contain'] as const
export type FitMode = (typeof FIT_MODES)[number]

/** Заливка. Градиент — не украшение: им задаётся тёмная подложка под текстовой колонкой,
 *  без которой белый заголовок на светлом фоне нечитаем. */
export type Paint =
  | { kind: 'solid'; color: string; opacity?: number }
  | {
      kind: 'linear'
      /** Начало и конец градиента в долях бокса слоя. */
      from: Focus
      to: Focus
      stops: { at: Fraction; color: string; opacity?: number }[]
    }

export type ShapeForm =
  | { form: 'rect'; radius?: Fraction }
  | { form: 'ellipse' }
  | { form: 'line'; thickness: Fraction }

export const EFFECT_KINDS = ['shadow', 'blur'] as const
export type EffectKind = (typeof EFFECT_KINDS)[number]

/** Смещения и радиусы эффектов — тоже в долях холста: эффект обязан масштабироваться вместе
 *  с макетом, иначе тень, выверенная на 1200 px, на 2400 px станет вдвое тоньше. */
export type Effect =
  | { kind: 'shadow'; dx: Fraction; dy: Fraction; blur: Fraction; color: string; opacity: number }
  | { kind: 'blur'; radius: Fraction }

/**
 * Чем слой наполняется. Нет привязки — слой декоративный, его содержимое записано прямо в
 * макете (рамка, разделитель, слово-подложка).
 *
 * Привязка — единственный способ для слоя сослаться на содержимое, и именно она делает
 * исполнимым правило K-3: сборщик знает, чего именно не хватило, и снимает ровно этот слой.
 */
export type Binding =
  | { kind: 'frame' }
  | { kind: 'cutout' }
  | { kind: 'logo' }
  | { kind: 'text'; slot: TextSlot }
  /** Характеристика товара (шаг B1). `part` не задан — привязан весь модуль целиком:
   *  нет характеристики → группа не рисуется. */
  | { kind: 'prop'; index: number; part?: 'label' | 'value' | 'icon' }
  | { kind: 'swatch'; index: number }

export type TextStyle = {
  role: FontRole
  /** Кегль долей ВЫСОТЫ холста. Высотой, а не шириной: при смене профиля площадки меняется
   *  прежде всего высота кадра, и текст должен ехать вместе с ней. */
  size: Fraction
  weight: number
  italic?: boolean
  color: string
  align: TextAlign
  valign: TextValign
  /** Множитель к кеглю. */
  lineHeight: number
  /** Межбуквенный интервал долей кегля. */
  tracking?: number
  transform?: TextTransform
}

type LayerBase = {
  id: string
  /** Порядок отрисовки: больше — ближе к зрителю. Хранится числом, а не позицией в массиве,
   *  потому что арт-директор (шаг B5) вставляет слои между существующими, а не в конец. */
  z: number
  box: Box
  opacity?: number
  blend?: BlendMode
  effects?: Effect[]
  bind?: Binding
}

/** Кадр вендора целиком. */
export type FrameLayer = LayerBase & { type: 'frame'; fit: FitMode; focus?: Focus }

/** Вырез товара из того же кадра (K-2): нужен, только когда текст должен уходить за товар. */
export type CutoutLayer = LayerBase & { type: 'cutout'; fit: FitMode; focus?: Focus }

export type ShapeLayer = LayerBase & { type: 'shape'; shape: ShapeForm; fill?: Paint }

/** Картинка из базы: логотип, иконка, образец цвета. */
export type AssetLayer = LayerBase & { type: 'asset'; fit: FitMode }

/** Разбиение на строки задаётся макетом, а не подбирается сборщиком: перенос — решение
 *  вёрстки («КУРТКА» и «МУЖСКАЯ» — две строки разного кегля, а не одна фраза). */
export type TextLayer = LayerBase & { type: 'text'; style: TextStyle; lines?: string[] }

/** Модуль: иконка + подпись + плашка, которые появляются и исчезают вместе. */
export type GroupLayer = LayerBase & { type: 'group'; children: Layer[] }

export type Layer =
  | FrameLayer
  | CutoutLayer
  | ShapeLayer
  | AssetLayer
  | TextLayer
  | GroupLayer

export type LayoutCanvas = {
  /** Пропорция, под которую макет нарисован. Пиксели приходят из `OutputProfile`. */
  aspectW: number
  aspectH: number
  background: Paint
}

export type CardLayout = {
  id: string
  title: string
  canvas: LayoutCanvas
  layers: Layer[]
}

/** Картинка, готовая лечь в композицию: data-URI, потому что сборка обязана быть
 *  самодостаточной — внешних загрузок во время рендера нет. */
export type ImageRef = { dataUri: string; width: number; height: number }

/** Характеристика товара из шага B1. Любое поле может отсутствовать — это штатный случай,
 *  а не ошибка (решение 4 от 2026-08-31). */
export type CardProp = { label?: string; value?: string; icon?: ImageRef }

/** Чем наполняется макет на конкретной сборке. */
export type CardContent = {
  frame?: ImageRef
  cutout?: ImageRef
  logo?: ImageRef
  texts: Partial<Record<TextSlot, string[]>>
  props: CardProp[]
  swatches: (ImageRef | { color: string })[]
}
