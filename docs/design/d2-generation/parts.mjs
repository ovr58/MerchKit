// Блоки экранов вехи M4: степпер мастера, зона загрузки, схематичные превью результата,
// карточки выбора типа и сценария показа. Базовый словарь — в `kit.mjs`.
//
// ПРО ПРЕВЬЮ. Изображений на артбордах нет намеренно: заглушка провайдера появляется на M4,
// а класть в канвас чужие карточки маркетплейса из V-10 незачем. Вместо фото — схематичный
// силуэт: белая фигура с контуром `border` на подложке `muted`. Это плейсхолдер, а не текст,
// поэтому порог контраста NFR-07 к нему не применяется.
import { C, btn } from './kit.mjs';

/* ---------- Схематичные силуэты товара ---------- */

const SIL = {
  // Куртка на фигуре — сценарий «На модели».
  model: `<circle cx="60" cy="26" r="11"></circle>
    <path d="M44 46 h32 l10 8 -4 46 h-44 l-4 -46 z"></path>
    <path d="M44 46 l-14 8 -5 34 10 3 9 -30"></path>
    <path d="M76 46 l14 8 5 34 -10 3 -9 -30"></path>
    <path d="M46 100 h28 v46 h-11 v-32 h-6 v32 h-11 z"></path>`,
  // На вешалке — сценарий «Как в магазине».
  hanger: `<path d="M60 20 a7 7 0 1 1 7 7 v5"></path>
    <path d="M30 50 L60 32 L90 50"></path>
    <path d="M44 50 h32 l10 8 -4 46 h-44 l-4 -46 z"></path>
    <path d="M44 50 l-14 8 -5 34 10 3 9 -30"></path>
    <path d="M76 50 l14 8 5 34 -10 3 -9 -30"></path>`,
  // Раскладка сверху — рукава в стороны, вид строго сверху.
  flat: `<path d="M46 44 h28 l6 10 h20 l6 14 -20 8 -4 -8 v52 h-38 v-52 l-4 8 -20 -8 6 -14 h20 z"></path>`,
  // Каталог (студийно) — объект на нейтральном фоне, лёгкая подставка.
  studio: `<ellipse cx="60" cy="132" rx="30" ry="6"></ellipse>
    <path d="M44 40 h32 l10 8 -4 46 h-44 l-4 -46 z"></path>
    <path d="M44 40 l-14 8 -5 34 10 3 9 -30"></path>
    <path d="M76 40 l14 8 5 34 -10 3 -9 -30"></path>`,
  // Обобщённые плейсхолдеры для каталога — товар не из категории «Одежда».
  bottle: `<path d="M52 30 h16 v14 l8 12 v76 a6 6 0 0 1 -6 6 h-20 a6 6 0 0 1 -6 -6 v-76 l8 -12 z"></path>
    <path d="M46 84 h28"></path>`,
  box: `<path d="M28 54 L60 38 L92 54 v52 L60 122 L28 106 z"></path>
    <path d="M28 54 L60 70 L92 54"></path>
    <path d="M60 70 v52"></path>`
};

// Кадр 3:4 с силуэтом. `kind` — ключ SIL, `radius` — под контейнер.
export const shot = (w, h, kind = 'model', radius = 6) => `<div style="width: ${w}px; height: ${h}px; flex: none; border-radius: ${radius}px; background: ${C.muted}; border: 1px solid ${C.border}; overflow: hidden; position: relative">
        <svg width="100%" height="100%" viewBox="0 0 120 160" preserveAspectRatio="xMidYMid slice" fill="${C.bg}" stroke="${C.border}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">${SIL[kind]}</svg>
      </div>`;

/* ---------- Карточка маркетплейса (V-10): ОДНО изображение с вёрсткой поверх фото ---------- */

// Анатомия из трёх референсов V-10: вертикальный кадр, товар справа, слева поверх фото —
// крупное название, подзаголовок, два выноса про свойства, размерный ряд отдельным блоком.
export const cardShot = (w, scale = 1) => {
  const h = Math.round(w * 4 / 3);
  const px = (n) => Math.round(n * scale);
  const callout = (num, word, tail) => `<div style="display: flex; align-items: flex-start; gap: ${px(6)}px">
            <span style="flex: none; width: ${px(16)}px; height: ${px(16)}px; border-radius: ${px(8)}px; background: ${C.green50}; border: 1px solid ${C.green200}; color: ${C.green700}; font-size: ${px(10)}px; font-weight: 600; display: flex; align-items: center; justify-content: center">${num}</span>
            <span style="font-size: ${px(11)}px; line-height: ${px(14)}px; color: ${C.fg}"><b>${word}</b> ${tail}</span>
          </div>`;
  return `<div style="width: ${w}px; height: ${h}px; flex: none; border-radius: 6px; background: ${C.muted}; border: 1px solid ${C.border}; overflow: hidden; position: relative">
        <div style="position: absolute; inset: 0; display: flex; justify-content: flex-end">
          <svg width="72%" height="100%" viewBox="0 0 120 160" preserveAspectRatio="xMidYMid slice" fill="${C.bg}" stroke="${C.border}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">${SIL.model}</svg>
        </div>
        <div style="position: absolute; inset: 0; padding: ${px(14)}px; display: flex; flex-direction: column; gap: ${px(10)}px">
          <div style="width: ${px(46)}px; height: ${px(8)}px; border-radius: ${px(4)}px; background: ${C.fg}; opacity: 0.85"></div>
          <div style="display: flex; flex-direction: column; gap: ${px(2)}px; max-width: 62%">
            <span style="font-size: ${px(20)}px; line-height: ${px(22)}px; font-weight: 700; letter-spacing: -0.02em; color: ${C.fg}">Куртка-бомбер</span>
            <span style="font-size: ${px(12)}px; color: ${C.mutedFg}">мужская · хаки</span>
          </div>
          <div style="display: flex; flex-direction: column; gap: ${px(6)}px; max-width: 58%">
            ${callout('1', 'Плащёвка', 'на синтепоне')}
            ${callout('2', 'Карманы', 'на молнии')}
          </div>
          <div style="margin-top: auto; display: flex; flex-direction: column; gap: ${px(5)}px">
            <span style="font-size: ${px(10)}px; letter-spacing: 0.06em; text-transform: uppercase; color: ${C.mutedFg}">Размеры</span>
            <div style="display: flex; gap: ${px(4)}px">
              ${['S', 'M', 'L', 'XL', 'XXL'].map((s) => `<span style="min-width: ${px(24)}px; height: ${px(22)}px; padding: 0 ${px(4)}px; border-radius: ${px(4)}px; background: ${C.bg}; border: 1px solid ${C.border}; font-size: ${px(11)}px; font-weight: 600; color: ${C.fg}; display: flex; align-items: center; justify-content: center">${s}</span>`).join('')}
            </div>
          </div>
        </div>
      </div>`;
};

/* ---------- Степпер мастера ---------- */

const STEPS = ['Фото', 'Товар', 'Площадка', 'Тип', 'Показ', 'Запуск'];

const stepCircle = (i, current, size = 28) => {
  const done = i < current;
  const active = i === current;
  const inner = done
    ? `<svg width="${Math.round(size * 0.5)}" height="${Math.round(size * 0.5)}" viewBox="0 0 24 24" fill="none" stroke="${C.primaryFg}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>`
    : `${i + 1}`;
  const style = done
    ? `background: ${C.primary}; border: 1px solid ${C.primary}; color: ${C.primaryFg}`
    : active
      ? `background: ${C.bg}; border: 2px solid ${C.primary}; color: ${C.primary}`
      : `background: ${C.muted}; border: 1px solid ${C.border}; color: ${C.mutedFg}`;
  return `<div style="width: ${size}px; height: ${size}px; flex: none; border-radius: ${size / 2}px; display: flex; align-items: center; justify-content: center; font-size: ${Math.round(size * 0.46)}px; font-weight: 600; ${style}">${inner}</div>`;
};

// Горизонтальный степпер десктопа. `current` — индекс активного шага, 0-based.
export const stepper = (current) => `<div style="display: flex; align-items: flex-start">
        ${STEPS.map((label, i) => {
    const lineColor = (c) => `<div style="flex: 1; height: 2px; margin-top: 13px; background: ${c}"></div>`;
    return `<div style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 8px">
          <div style="width: 100%; display: flex; align-items: flex-start">
            ${i === 0 ? '<div style="flex: 1"></div>' : lineColor(i <= current ? C.primary : C.border)}
            ${stepCircle(i, current)}
            ${i === STEPS.length - 1 ? '<div style="flex: 1"></div>' : lineColor(i < current ? C.primary : C.border)}
          </div>
          <span style="font-size: 13px; font-weight: ${i === current ? 500 : 400}; color: ${i <= current ? C.fg : C.mutedFg}">${label}</span>
        </div>`;
  }).join('')}
      </div>`;

/* ---------- Шаг 1: загрузка фото ---------- */

export const dropzone = (height = 244) => `<div style="height: ${height}px; border: 1px dashed ${C.border}; border-radius: 8px; background: ${C.muted}; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; text-align: center; padding: 24px">
        <div style="width: 56px; height: 56px; border-radius: 28px; background: ${C.bg}; border: 1px solid ${C.border}; display: flex; align-items: center; justify-content: center">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="${C.mutedFg}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"></path><path d="m7 9 5-5 5 5"></path><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"></path></svg>
        </div>
        <div style="display: flex; flex-direction: column; gap: 4px">
          <span style="font-size: 15px; font-weight: 500; color: ${C.fg}">Перетащите фото сюда</span>
          <span style="font-size: 13px; color: ${C.mutedFg}">или выберите файлы на компьютере</span>
        </div>
        <div style="width: 200px">${btn('Выбрать файлы', 'outline')}</div>
      </div>`;

// Миниатюра загруженного фото с кнопкой «убрать».
export const photoThumb = (kind = 'model', h = 132) => `<div style="position: relative; border-radius: 8px; overflow: hidden; border: 1px solid ${C.border}; background: ${C.muted}; height: ${h}px">
          <svg width="100%" height="100%" viewBox="0 0 120 160" preserveAspectRatio="xMidYMid slice" fill="${C.bg}" stroke="${C.border}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">${SIL[kind]}</svg>
          <div style="position: absolute; top: 6px; right: 6px; width: 24px; height: 24px; border-radius: 12px; background: ${C.bg}; border: 1px solid ${C.border}; display: flex; align-items: center; justify-content: center">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${C.fg}" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"></path></svg>
          </div>
        </div>`;

export const addSlot = (h = 132) => `<div style="height: ${h}px; border: 1px dashed ${C.border}; border-radius: 8px; background: ${C.muted}; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${C.mutedFg}" stroke-width="1.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"></path></svg>
          <span style="font-size: 13px; color: ${C.mutedFg}">Добавить</span>
        </div>`;

/* ---------- Карточки выбора: тип генерации и сценарий показа ---------- */

const checkMark = `<div style="width: 22px; height: 22px; flex: none; border-radius: 11px; background: ${C.primary}; display: flex; align-items: center; justify-content: center">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${C.primaryFg}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>
          </div>`;

export const typeCard = ({ title, desc, price, preview, selected }) => `<div style="flex: 1; display: flex; flex-direction: column; gap: 14px; padding: 16px; border-radius: 8px; border: ${selected ? `2px solid ${C.primary}` : `1px solid ${C.border}`}; background: ${selected ? C.green50 : C.bg}">
          <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px">
            <div style="display: flex; flex-direction: column; gap: 4px">
              <span style="font-size: 15px; font-weight: 600; color: ${C.fg}">${title}</span>
              <span style="font-size: 13px; line-height: 18px; color: ${C.mutedFg}">${desc}</span>
            </div>
            ${selected ? checkMark : `<div style="width: 22px; height: 22px; flex: none; border-radius: 11px; border: 1px solid ${C.border}; background: ${C.bg}"></div>`}
          </div>
          <div style="display: flex; justify-content: center">${preview}</div>
          <div style="display: flex; align-items: center; gap: 6px; padding-top: 12px; border-top: 1px solid ${selected ? C.green200 : C.border}">
            <span style="font-size: 15px; font-weight: 600; color: ${C.fg}">${price}</span>
            <span style="font-size: 13px; color: ${C.mutedFg}">за генерацию</span>
          </div>
        </div>`;

export const presetCard = ({ title, desc, kind, selected, previewH = 136 }) => `<div style="display: flex; flex-direction: column; gap: 10px; padding: 10px; border-radius: 8px; border: ${selected ? `2px solid ${C.primary}` : `1px solid ${C.border}`}; background: ${selected ? C.green50 : C.bg}">
          <div style="position: relative; height: ${previewH}px; border-radius: 6px; overflow: hidden; background: ${C.muted}; border: 1px solid ${selected ? C.green200 : C.border}">
            <svg width="100%" height="100%" viewBox="0 0 120 160" preserveAspectRatio="xMidYMid slice" fill="${C.bg}" stroke="${C.border}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">${SIL[kind]}</svg>
            ${selected ? `<div style="position: absolute; top: 8px; right: 8px">${checkMark}</div>` : ''}
          </div>
          <div style="display: flex; flex-direction: column; gap: 2px; padding: 0 2px 2px">
            <span style="font-size: 14px; font-weight: 500; color: ${C.fg}">${title}</span>
            <span style="font-size: 12px; line-height: 16px; color: ${C.mutedFg}">${desc}</span>
          </div>
        </div>`;

/* ---------- Шаг «Площадка»: выбор маркетплейса (FR-25) ---------- */

// Логотипов площадок на артбордах нет намеренно: это чужие товарные знаки, и рисовать их в
// своём макете незачем — названия текстом однозначны.
//
// `#F2F3F5` ниже — НЕ новый токен палитры, а цитата требования Ozon к фону для категории
// «Одежда и обувь» (ТЗ §5.2). Показан образцом рядом со значением, потому что «серый» без
// конкретного оттенка требованием не является. В интерфейсных элементах не используется.
export const OZON_BG = '#F2F3F5';

const paramRow = (k, v) => `<div style="display: flex; align-items: baseline; justify-content: space-between; gap: 10px; font-size: 12px">
            <span style="color: ${C.mutedFg}">${k}</span>
            <span style="color: ${C.fg}; font-weight: 500; text-align: right">${v}</span>
          </div>`;

export const swatch = (hex) => `<span style="display: inline-flex; align-items: center; gap: 5px">
          <span style="width: 12px; height: 12px; border-radius: 3px; background: ${hex}; border: 1px solid ${C.border}"></span>
          <span>${hex}</span>
        </span>`;

export const marketplaceCard = ({ name, note, params, selected }) => `<div style="flex: 1; display: flex; flex-direction: column; gap: 12px; padding: 16px; border-radius: 8px; border: ${selected ? `2px solid ${C.primary}` : `1px solid ${C.border}`}; background: ${selected ? C.green50 : C.bg}">
          <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 10px">
            <span style="font-size: 15px; font-weight: 600; color: ${C.fg}">${name}</span>
            ${selected ? checkMark : `<div style="width: 22px; height: 22px; flex: none; border-radius: 11px; border: 1px solid ${C.border}; background: ${C.bg}"></div>`}
          </div>
          <span style="font-size: 13px; line-height: 18px; color: ${C.mutedFg}">${note}</span>
          <div style="display: flex; flex-direction: column; gap: 6px; padding-top: 12px; border-top: 1px solid ${selected ? C.green200 : C.border}">
            ${params.map(([k, v]) => paramRow(k, v)).join('')}
          </div>
        </div>`;

// Разрешённые параметры конечного изображения: пара «маркетплейс × категория» (ТЗ §5.2).
export const outputParams = (rows, note) => `<div style="display: flex; flex-direction: column; gap: 10px; padding: 14px; border-radius: 8px; background: ${C.muted}; border: 1px solid ${C.border}">
        <span style="font-size: 13px; font-weight: 600; color: ${C.fg}">Что получится на выходе</span>
        <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px">
          ${rows.map(([k, v]) => `<div style="display: flex; flex-direction: column; gap: 3px">
            <span style="font-size: 12px; color: ${C.mutedFg}">${k}</span>
            <span style="font-size: 13px; font-weight: 500; color: ${C.fg}">${v}</span>
          </div>`).join('')}
        </div>
        ${note ? `<span style="font-size: 12px; line-height: 17px; color: ${C.mutedFg}">${note}</span>` : ''}
      </div>`;

/* ---------- Сводка и цена ---------- */

export const summaryRow = (k, v, muted = false) => `<div style="display: flex; align-items: baseline; justify-content: space-between; gap: 12px; font-size: 13px">
          <span style="flex: none; color: ${C.mutedFg}">${k}</span>
          <span style="text-align: right; color: ${muted ? C.mutedFg : C.fg}; font-weight: ${muted ? 400 : 500}">${v}</span>
        </div>`;

export const divider = `<div style="height: 1px; background: ${C.border}"></div>`;

// Строка цены в блоке расчёта. `tone`: 'plain' | 'total' | 'short' (не хватает баллов).
// В 'short' взят `red700`, а не `destructive`: блок расчёта стоит на подложке `muted`, где
// #DC2626 даёт 4.39 — ниже порога AA (NFR-07). #B91C1C на той же подложке даёт 5.71.
export const priceRow = (k, v, tone = 'plain') => {
  const size = tone === 'total' ? 15 : 13;
  const color = tone === 'short' ? C.red700 : C.fg;
  return `<div style="display: flex; align-items: baseline; justify-content: space-between; gap: 12px">
          <span style="font-size: ${size}px; color: ${tone === 'total' ? C.fg : C.mutedFg}; font-weight: ${tone === 'total' ? 500 : 400}">${k}</span>
          <span style="font-size: ${size}px; font-weight: 600; color: ${color}">${v}</span>
        </div>`;
};

export const priceBox = (inner) => `<div style="display: flex; flex-direction: column; gap: 10px; padding: 14px; border-radius: 8px; background: ${C.muted}; border: 1px solid ${C.border}">${inner}</div>`;

/* ---------- Шаги прогресса генерации (V-07) ---------- */

export const progressStep = (text, state) => {
  const dot = state === 'done'
    ? `<div style="width: 20px; height: 20px; flex: none; border-radius: 10px; background: ${C.primary}; display: flex; align-items: center; justify-content: center"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="${C.primaryFg}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg></div>`
    : state === 'active'
      ? `<div style="width: 20px; height: 20px; flex: none; border-radius: 10px; border: 2px solid ${C.brand}; border-top-color: ${C.border}; background: ${C.bg}"></div>`
      : `<div style="width: 20px; height: 20px; flex: none; border-radius: 10px; border: 1px solid ${C.border}; background: ${C.muted}"></div>`;
  return `<div style="display: flex; align-items: center; gap: 10px">
          ${dot}
          <span style="font-size: 14px; color: ${state === 'pending' ? C.mutedFg : C.fg}; font-weight: ${state === 'active' ? 500 : 400}">${text}</span>
        </div>`;
};

/* ---------- Карточка каталога ---------- */

export const catalogCard = ({ title, date, kind, market, silhouette, pill = '' }) => `<div style="background: ${C.bg}; border: 1px solid ${C.border}; border-radius: 8px; overflow: hidden; display: flex; flex-direction: column">
          <div style="height: 190px; background: ${C.muted}; border-bottom: 1px solid ${C.border}; position: relative">
            <svg width="100%" height="100%" viewBox="0 0 120 160" preserveAspectRatio="xMidYMid slice" fill="${C.bg}" stroke="${C.border}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">${SIL[silhouette]}</svg>
            ${pill ? `<div style="position: absolute; top: 8px; left: 8px">${pill}</div>` : ''}
          </div>
          <div style="padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 8px">
            <span style="font-size: 14px; font-weight: 500; line-height: 19px; color: ${C.fg}">${title}</span>
            <div style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: ${C.mutedFg}">
              <span>${date}</span><span>·</span><span>${kind}</span><span>·</span><span>${market}</span>
            </div>
          </div>
        </div>`;
