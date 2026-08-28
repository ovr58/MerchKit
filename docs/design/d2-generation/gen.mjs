// Артборды захода D2 — экраны вехи M4: мастер генерации по шагам, «идёт генерация»,
// результаты, каталог с данными, сценарии ошибок US-E1…US-E4, US-E6 и перехват гостя.
// Словарь — `kit.mjs`, блоки — `parts.mjs`. Запуск: node docs/design/d2-generation/gen.mjs
import {
  C, write, appHeader, guestHeader, btn, panel, sectionTitle, field, textarea,
  chevron, aiBadge, alertBox, statusPill, logo, balancePill
} from './kit.mjs';
import {
  shot, cardShot, stepper, dropzone, photoThumb, addSlot, typeCard, presetCard,
  summaryRow, divider, priceRow, priceBox, progressStep, catalogCard,
  marketplaceCard, outputParams, swatch, OZON_BG
} from './parts.mjs';

// Параметры конечного изображения для пары «маркетплейс × категория» (ТЗ §5.2).
// На артбордах везде показан один и тот же разрешённый набор: Ozon + «Одежда и обувь».
const OUT = [
  ['Кадр', '3 : 4'],
  ['Размер', '1200 × 1600'],
  ['Формат', 'JPEG, sRGB'],
  ['Фон', swatch(OZON_BG)]
];
const OUT_NOTE = 'Ozon требует серый фон <b>#F2F3F5</b> для категории «Одежда и обувь». Это параметр генерации, а не постобработки: фон рисуется вместе с кадром.';
const OUT_SHORT = '3 : 4 · 1200 × 1600 · JPEG';

const W = 1440;
const H = 1024;

/* ---------- Каркас страницы ---------- */

const shell = ({ header, body, overlay = '', w = W, h = H, pad = '32px 40px' }) => `<div style="width: ${w}px; height: ${h}px; background: ${C.muted}; display: flex; flex-direction: column; position: relative">
  ${header}
  <main style="flex: 1; overflow: hidden; padding: ${pad}">
    <div style="max-width: 1120px; margin: 0 auto; height: 100%; display: flex; flex-direction: column; gap: 20px">
      ${body}
    </div>
  </main>
  ${overlay}
</div>`;

const h1 = (t) => `<h1 style="margin: 0; font-size: 30px; font-weight: 600; letter-spacing: -0.02em; color: ${C.fg}">${t}</h1>`;

// Две колонки: слева мастер, справа блок «Результаты» (03 в V-06) и сводка заявки.
// После запуска колонки меняются пропорциями — результат заслуживает больше места.
const columns = (left, right, cols = 'minmax(0, 2fr) minmax(0, 1fr)') => `<div style="flex: 1; min-height: 0; display: grid; grid-template-columns: ${cols}; gap: 20px; align-items: start">
        <div style="display: flex; flex-direction: column; gap: 20px">${left}</div>
        <div style="display: flex; flex-direction: column; gap: 20px">${right}</div>
      </div>`;

const stepFooter = (hint, buttons) => `<div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-top: 16px; border-top: 1px solid ${C.border}">
        <span style="font-size: 13px; color: ${C.mutedFg}">${hint}</span>
        <div style="display: flex; gap: 10px">${buttons}</div>
      </div>`;

const backBtn = `<div style="width: 120px">${btn('Назад', 'outline')}</div>`;
const nextBtn = (kind = 'primary') => `<div style="width: 140px">${btn('Далее', kind)}</div>`;

/* ---------- Правая колонка ---------- */

const resultsWaiting = () => panel(`${sectionTitle('Результаты')}
        <div style="height: 268px; border: 1px dashed ${C.border}; border-radius: 8px; background: ${C.muted}; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; text-align: center; padding: 24px">
          <div style="width: 52px; height: 52px; border-radius: 26px; background: ${C.bg}; border: 1px solid ${C.border}; display: flex; align-items: center; justify-content: center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${C.mutedFg}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="9" r="1.5"></circle><path d="m21 15-5-5L5 21"></path></svg>
          </div>
          <div style="display: flex; flex-direction: column; gap: 6px; max-width: 260px">
            <span style="font-size: 15px; font-weight: 500; color: ${C.fg}">Здесь появятся результаты</span>
            <span style="font-size: 13px; line-height: 18px; color: ${C.mutedFg}">Готовое изображение можно будет скачать и найти потом в каталоге.</span>
          </div>
        </div>`);

// Сводка заявки. Цена пересчитывается по мере заполнения шагов (FR-11).
const summaryPanel = ({ photos = '—', product = '—', category = '—', market = '—', type = '—', preset = '—', total = '—' }) => panel(`${sectionTitle('Ваша генерация')}
        <div style="display: flex; flex-direction: column; gap: 10px">
          ${summaryRow('Фото', photos)}
          ${summaryRow('Товар', product)}
          ${summaryRow('Категория', category)}
          ${summaryRow('Площадка', market)}
          ${summaryRow('Тип', type)}
          ${summaryRow('Как показать', preset)}
        </div>
        ${divider}
        ${priceRow('К списанию', total, 'total')}
        <span style="font-size: 12px; line-height: 16px; color: ${C.mutedFg}">Одна генерация — один объект: вся мощность вызова идёт на один результат.</span>`);

/* ---------- 1. Мастер, шаг «фото» — пусто ---------- */

write('WizardPhotoEmpty', shell({
  header: appHeader('new', '120 баллов'),
  body: `${h1('Создать генерацию')}
      ${columns(
    panel(`${stepper(0)}
        ${divider}
        ${sectionTitle('Фото товара', 'До 4 фотографий с разных сторон — так товар на выходе получается узнаваемым')}
        ${dropzone(268)}
        <span style="font-size: 13px; color: ${C.mutedFg}">JPG, PNG, WebP или HEIC · до 10 МБ каждый файл — как принимают маркетплейсы</span>
        ${stepFooter('0 из 4 фото', `<div style="width: 140px">${btn('Далее', 'disabled')}</div>`)}`),
    `${resultsWaiting()}${summaryPanel({})}`
  )}`
}));

/* ---------- 2. Мастер, шаг «фото» — загружены ---------- */

const photoGrid = (kinds, withAdd) => `<div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px">
          ${kinds.map((k) => photoThumb(k, 168)).join('')}
          ${withAdd ? addSlot(168) : ''}
        </div>`;

write('WizardPhotoFilled', shell({
  header: appHeader('new', '120 баллов'),
  body: `${h1('Создать генерацию')}
      ${columns(
    panel(`${stepper(0)}
        ${divider}
        ${sectionTitle('Фото товара', 'До 4 фотографий с разных сторон — так товар на выходе получается узнаваемым')}
        ${photoGrid(['model', 'hanger', 'flat'], true)}
        <div style="display: flex; align-items: center; justify-content: space-between">
          <span style="font-size: 13px; color: ${C.mutedFg}">JPG, PNG, WebP или HEIC · до 10 МБ каждый файл — как принимают маркетплейсы</span>
          <span style="font-size: 13px; color: ${C.mutedFg}">Очистить</span>
        </div>
        ${stepFooter('3 из 4 фото', `${nextBtn()}`)}`),
    `${resultsWaiting()}${summaryPanel({ photos: '3 из 4' })}`
  )}`
}));

/* ---------- 3. Мастер, шаг «фото» — US-E1 ---------- */

write('WizardPhotoError', shell({
  header: appHeader('new', '120 баллов'),
  body: `${h1('Создать генерацию')}
      ${columns(
    panel(`${stepper(0)}
        ${divider}
        ${sectionTitle('Фото товара', 'До 4 фотографий с разных сторон — так товар на выходе получается узнаваемым')}
        ${alertBox('error', `<span>Два файла не подошли — остальные загружены.</span>
          <span><b>scan_01.tiff</b> — такой формат не принимаем. Подойдут JPG, PNG, WebP и HEIC.</span>
          <span><b>front-view.png</b> — 24 МБ, это больше предела в 10 МБ. Уменьшите файл и попробуйте снова.</span>`)}
        ${photoGrid(['model', 'hanger', 'flat', 'studio'], false)}
        <div style="display: flex; align-items: center; justify-content: space-between">
          <span style="font-size: 13px; color: ${C.mutedFg}">4 из 4 — больше фото за одну генерацию не принимаем</span>
          <span style="font-size: 13px; color: ${C.mutedFg}">Очистить</span>
        </div>
        ${stepFooter('4 из 4 фото', `${nextBtn()}`)}`),
    `${resultsWaiting()}${summaryPanel({ photos: '4 из 4' })}`
  )}`
}));

/* ---------- 4. Мастер, шаг «товар» ---------- */

const thumbStrip = (kinds) => `<div style="display: flex; gap: 8px">${kinds.map((k) => shot(58, 78, k)).join('')}</div>`;

const productDesc = 'Мужская куртка-бомбер, плащёвка на синтепоне, цвет хаки. Два боковых кармана на молнии, внутренний карман. Размерный ряд S–XXL.';

write('WizardProduct', shell({
  header: appHeader('new', '120 баллов'),
  body: `${h1('Создать генерацию')}
      ${columns(
    panel(`${stepper(1)}
        ${divider}
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 20px">
          ${sectionTitle('Это ваш товар?', 'Определили по фото — поправьте, если ошиблись')}
          ${thumbStrip(['model', 'hanger', 'flat'])}
        </div>
        ${field({ label: 'Наименование', value: 'Куртка-бомбер', badge: aiBadge })}
        ${field({ label: 'Категория', value: 'Одежда и обувь', badge: aiBadge, icon: chevron })}
        ${textarea({
      label: 'Описание товара',
      value: productDesc,
      height: 88,
      hint: 'Состав, цвет, размерный ряд, особенности — то, чего не видно на фото. Идёт в промпт генерации и в текст карточки.'
    })}
        ${stepFooter('Шаг 2 из 6', `${backBtn}${nextBtn()}`)}`),
    `${resultsWaiting()}${summaryPanel({ photos: '3 из 4', product: 'Куртка-бомбер', category: 'Одежда и обувь' })}`
  )}`
}));

/* ---------- 5. Мастер, шаг «товар» — US-E2 ---------- */

write('WizardProductUnknown', shell({
  header: appHeader('new', '120 баллов'),
  body: `${h1('Создать генерацию')}
      ${columns(
    panel(`${stepper(1)}
        ${divider}
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 20px">
          ${sectionTitle('Что на фото?', 'Укажите товар сами — дальше всё как обычно')}
          ${thumbStrip(['box', 'bottle'])}
        </div>
        ${alertBox('info', '<span>Не удалось определить товар по фото. Укажите категорию и наименование сами — на саму генерацию это не влияет.</span>')}
        ${field({ label: 'Наименование', placeholder: 'Например, куртка-бомбер' })}
        ${field({ label: 'Категория', placeholder: 'Выберите категорию', icon: chevron })}
        ${textarea({
      label: 'Описание товара',
      placeholder: 'Состав, цвет, размерный ряд, особенности',
      height: 88,
      hint: 'Чем подробнее описание, тем меньше провайдер додумывает за вас.'
    })}
        ${stepFooter('Заполните наименование и категорию', `${backBtn}<div style="width: 140px">${btn('Далее', 'disabled')}</div>`)}`),
    `${resultsWaiting()}${summaryPanel({ photos: '2 из 4' })}`
  )}`
}));

/* ---------- 6. Мастер, шаг «площадка» (FR-25) ---------- */

const MARKETS = [
  {
    name: 'Ozon',
    note: 'Для одежды, обуви и аксессуаров требует серый фон, а не белый. Еду показывает квадратом.',
    params: [['Кадр', '3 : 4'], ['Размер', '1200 × 1600'], ['Фон', 'серый']],
    selected: true
  },
  {
    name: 'Wildberries',
    note: 'Вертикальный кадр 3 : 4, минимум 700 × 900. Фон белый или светлый.',
    params: [['Кадр', '3 : 4'], ['Размер', '1200 × 1600'], ['Фон', 'белый']]
  },
  {
    name: 'Яндекс Маркет',
    note: 'Порог мягче — от 300 × 300, но витрина показывает всё в 3 : 4.',
    params: [['Кадр', '3 : 4'], ['Размер', '1200 × 1600'], ['Фон', 'белый']]
  }
];

write('WizardMarketplace', shell({
  header: appHeader('new', '120 баллов'),
  body: `${h1('Создать генерацию')}
      ${columns(
    panel(`${stepper(2)}
        ${divider}
        ${sectionTitle('Куда пойдёт изображение', 'Требования площадок разные — подгоним кадр, размер и фон под выбранную')}
        <div style="display: flex; gap: 16px; align-items: stretch">
          ${MARKETS.map(marketplaceCard).join('')}
        </div>
        ${outputParams(OUT, OUT_NOTE)}
        <span style="font-size: 13px; line-height: 18px; color: ${C.mutedFg}">Публиковать за вас мы не умеем — готовим файл, который площадка примет.</span>
        ${stepFooter('Шаг 3 из 6', `${backBtn}${nextBtn()}`)}`),
    `${resultsWaiting()}${summaryPanel({ photos: '3 из 4', product: 'Куртка-бомбер', category: 'Одежда и обувь', market: 'Ozon' })}`
  )}`
}));

/* ---------- 7. Мастер, шаг «тип» ---------- */

write('WizardType', shell({
  header: appHeader('new', '120 баллов'),
  body: `${h1('Создать генерацию')}
      ${columns(
    panel(`${stepper(3)}
        ${divider}
        ${sectionTitle('Что создаём?', 'Оба типа — один объект за генерацию')}
        <div style="display: flex; gap: 16px; align-items: stretch">
          ${typeCard({
      title: 'Фото',
      desc: 'Изображение товара в выбранном сценарии показа.',
      price: '50 баллов',
      preview: shot(168, 224, 'studio'),
      selected: false
    })}
          ${typeCard({
      title: 'Карточка',
      desc: 'Изображение с вёрсткой поверх фото — название, свойства, размеры. Плюс заголовок и описание текстом.',
      price: '55 баллов',
      preview: cardShot(168, 0.92),
      selected: true
    })}
        </div>
        <span style="font-size: 13px; line-height: 18px; color: ${C.mutedFg}">Карточка — <b style="color: ${C.fg}">одно</b> изображение, а не набор слайдов.</span>
        ${stepFooter('Шаг 4 из 6', `${backBtn}${nextBtn()}`)}`),
    `${resultsWaiting()}${summaryPanel({ photos: '3 из 4', product: 'Куртка-бомбер', category: 'Одежда и обувь', market: 'Ozon', type: 'Карточка', total: '55 баллов' })}`
  )}`
}));

/* ---------- 7. Мастер, шаг «как показать товар» ---------- */

const PRESETS = [
  { title: 'На модели', desc: 'Носимый контекст, акцент на посадке', kind: 'model', selected: true },
  { title: 'Как в магазине', desc: 'На вешалке или подставке', kind: 'hanger' },
  { title: 'Раскладка сверху', desc: 'Вид строго сверху', kind: 'flat' },
  { title: 'Каталог (студийно)', desc: 'Чистый объект на нейтральном фоне', kind: 'studio' }
];

write('WizardScenario', shell({
  header: appHeader('new', '120 баллов'),
  body: `${h1('Создать генерацию')}
      ${columns(
    panel(`${stepper(4)}
        ${divider}
        ${sectionTitle('Как показать товар', 'Одежда и обувь — 4 готовых сценария')}
        <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px">
          ${PRESETS.map((p) => presetCard({ ...p, previewH: 148 })).join('')}
        </div>
        ${textarea({
      label: 'Пожелания к генерации',
      placeholder: 'Например: тёплый вечерний свет, городская улица, модель в движении',
      height: 72,
      hint: 'Необязательно. Дополняет выбранный сценарий, а для категории «Прочее» заменяет его.'
    })}
        ${stepFooter('Шаг 5 из 6', `${backBtn}${nextBtn()}`)}`),
    `${resultsWaiting()}${summaryPanel({ photos: '3 из 4', product: 'Куртка-бомбер', category: 'Одежда и обувь', market: 'Ozon', type: 'Карточка', preset: 'На модели', total: '55 баллов' })}`
  )}`
}));

/* ---------- 8. Мастер, шаг «запуск» ---------- */

const launchSummary = () => `<div style="display: flex; flex-direction: column; gap: 10px">
          ${summaryRow('Фото', '3 файла')}
          ${summaryRow('Товар', 'Куртка-бомбер')}
          ${summaryRow('Категория', 'Одежда и обувь')}
          ${summaryRow('Описание', 'Плащёвка на синтепоне, хаки, S–XXL')}
          ${summaryRow('Площадка', 'Ozon')}
          ${summaryRow('Тип', 'Карточка')}
          ${summaryRow('Как показать', 'На модели')}
          ${summaryRow('Пожелания', 'не заполнено', true)}
        </div>
        ${outputParams(OUT, OUT_NOTE)}`;

write('WizardLaunch', shell({
  header: appHeader('new', '120 баллов'),
  body: `${h1('Создать генерацию')}
      ${columns(
    panel(`${stepper(5)}
        ${divider}
        ${sectionTitle('Проверьте и запускайте')}
        ${launchSummary()}
        ${priceBox(`${priceRow('Объект', '50 баллов')}
          ${priceRow('Надбавка за карточку', '+5 баллов')}
          ${divider}
          ${priceRow('К списанию', '55 баллов', 'total')}
          ${priceRow('Баланс после списания', '65 баллов')}`)}
        <div style="display: flex; gap: 10px; align-items: center">
          ${backBtn}
          <div style="flex: 1">${btn('Запустить генерацию за 55 баллов')}</div>
        </div>
        <span style="font-size: 13px; line-height: 18px; color: ${C.mutedFg}">Одна генерация — один объект: вся мощность вызова идёт на один результат.</span>`),
    `${resultsWaiting()}${summaryPanel({ photos: '3 из 4', product: 'Куртка-бомбер', category: 'Одежда и обувь', market: 'Ozon', type: 'Карточка', preset: 'На модели', total: '55 баллов' })}`
  )}`
}));

/* ---------- 9. Мастер, шаг «запуск» — US-E3, баллов не хватает ---------- */

write('WizardLaunchNoCredits', shell({
  header: appHeader('new', '30 баллов'),
  body: `${h1('Создать генерацию')}
      ${columns(
    panel(`${stepper(5)}
        ${divider}
        ${sectionTitle('Проверьте и запускайте')}
        ${alertBox('error', '<span>Не хватает <b>25 баллов</b>. Генерация стоит 55, на балансе — 30. Баллы не списаны, настройки сохранены.</span>')}
        ${launchSummary()}
        ${priceBox(`${priceRow('К списанию', '55 баллов', 'total')}
          ${priceRow('На балансе', '30 баллов')}
          ${divider}
          ${priceRow('Не хватает', '25 баллов', 'short')}`)}
        <div style="display: flex; gap: 10px; align-items: center">
          <div style="flex: 1">${btn('Пополнить баланс')}</div>
          <div style="flex: 1">${btn('Запустить генерацию', 'disabled')}</div>
        </div>
        <span style="font-size: 13px; line-height: 18px; color: ${C.mutedFg}">Пакет «Старт» — 300 баллов за 390 ₽. Баллы зачисляются сразу, без оплаты.</span>`),
    `${resultsWaiting()}${summaryPanel({ photos: '3 из 4', product: 'Куртка-бомбер', category: 'Одежда и обувь', market: 'Ozon', type: 'Карточка', preset: 'На модели', total: '55 баллов' })}`
  )}`
}));

/* ---------- 10. Мастер, шаг «запуск» — перехват гостя (FR-12, US-E6) ---------- */

const guestModal = `<div style="position: absolute; inset: 0; background: rgba(9, 9, 11, 0.45); display: flex; align-items: center; justify-content: center">
    <div style="width: 460px; background: ${C.bg}; border: 1px solid ${C.border}; border-radius: 8px; box-shadow: 0 12px 32px rgba(9, 9, 11, 0.22); padding: 32px; display: flex; flex-direction: column; gap: 20px">
      <div style="display: flex; flex-direction: column; gap: 6px">
        <h2 style="margin: 0; font-size: 22px; font-weight: 600; letter-spacing: -0.02em; color: ${C.fg}">Нужен аккаунт, чтобы запустить</h2>
        <p style="margin: 0; font-size: 14px; line-height: 20px; color: ${C.mutedFg}">Настройки генерации сохранены. После регистрации вы вернётесь на этот шаг — фото, товар и сценарий останутся на месте.</p>
      </div>
      ${alertBox('success', '<span><b>120 стартовых баллов</b> после подтверждения email — это две пробные генерации.</span>')}
      <div style="display: flex; flex-direction: column; gap: 10px">
        ${btn('Зарегистрироваться')}
        ${btn('У меня уже есть аккаунт', 'outline')}
      </div>
    </div>
  </div>`;

write('WizardLaunchGuest', shell({
  header: guestHeader(),
  overlay: guestModal,
  body: `${h1('Создать генерацию')}
      ${columns(
    panel(`${stepper(5)}
        ${divider}
        ${sectionTitle('Проверьте и запускайте')}
        ${launchSummary()}
        ${priceBox(`${priceRow('Объект', '50 баллов')}
          ${priceRow('Надбавка за карточку', '+5 баллов')}
          ${divider}
          ${priceRow('К списанию', '55 баллов', 'total')}`)}
        <div style="display: flex; gap: 10px; align-items: center">
          ${backBtn}
          <div style="flex: 1">${btn('Запустить генерацию за 55 баллов')}</div>
        </div>`),
    `${resultsWaiting()}${summaryPanel({ photos: '3 из 4', product: 'Куртка-бомбер', category: 'Одежда и обувь', market: 'Ozon', type: 'Карточка', preset: 'На модели', total: '55 баллов' })}`
  )}`
}));

/* ---------- Правая колонка после запуска ---------- */

const requestPanel = (ledgerLine, actions = '') => panel(`${sectionTitle('Заявка')}
        <div style="display: flex; flex-direction: column; gap: 10px">
          ${summaryRow('Фото', '3 файла')}
          ${summaryRow('Товар', 'Куртка-бомбер')}
          ${summaryRow('Категория', 'Одежда и обувь')}
          ${summaryRow('Площадка', 'Ozon')}
          ${summaryRow('Тип', 'Карточка')}
          ${summaryRow('Как показать', 'На модели')}
          ${summaryRow('Файл', OUT_SHORT)}
        </div>
        ${divider}
        <div style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: ${C.fg}">${ledgerLine}</div>
        ${actions}`);

const WIDE = 'minmax(0, 1fr) minmax(0, 2fr)';

/* ---------- 11. «Идёт генерация» (NFR-02, V-07) ---------- */

write('GenerationRunning', shell({
  header: appHeader('new', '65 баллов'),
  body: `${h1('Куртка-бомбер хаки, мужская')}
      ${columns(
    requestPanel('Списано 55 баллов · баланс 65'),
    panel(`<div style="display: flex; align-items: center; justify-content: space-between">
          ${sectionTitle('Результаты')}
          ${statusPill('Идёт генерация', 'neutral')}
        </div>
        <div style="height: 300px; border: 1px dashed ${C.border}; border-radius: 8px; background: ${C.muted}; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 24px">
          <div style="width: 56px; height: 56px; border-radius: 28px; border: 3px solid ${C.brand}; border-top-color: ${C.border}; background: ${C.bg}"></div>
          <span style="font-size: 16px; font-weight: 500; color: ${C.fg}">Провайдер рисует изображение</span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 12px">
          ${progressStep('Заявка принята, списано 55 баллов', 'done')}
          ${progressStep('Собран промпт по сценарию «На модели»', 'done')}
          ${progressStep('Провайдер рисует изображение', 'active')}
          ${progressStep('Сохраняем результат в каталог', 'pending')}
        </div>
        ${alertBox('info', '<span>Можно закрыть вкладку или обновить страницу — статус генерации сохранится и вернётся сюда.</span>')}`),
    WIDE
  )}`
}));

/* ---------- 12. Результаты — готово ---------- */

const textBlock = (label, value, empty = false) => `<div style="display: flex; flex-direction: column; gap: 6px">
            <div style="display: flex; align-items: center; justify-content: space-between">
              <span style="font-size: 13px; font-weight: 500; color: ${C.fg}">${label}</span>
              ${empty ? '' : `<span style="font-size: 13px; color: ${C.mutedFg}">Скопировать</span>`}
            </div>
            <div style="border: 1px ${empty ? 'dashed' : 'solid'} ${C.border}; border-radius: 6px; background: ${empty ? C.muted : C.bg}; padding: 10px 12px">
              <span style="font-size: 13px; line-height: 19px; color: ${empty ? C.mutedFg : C.fg}">${value}</span>
            </div>
          </div>`;

const cardTexts = `${textBlock('Заголовок карточки', 'Куртка-бомбер хаки, мужская — плащёвка на синтепоне')}
          ${textBlock('Описание', 'Тёплый бомбер из плотной плащёвки на синтепоне. Два боковых кармана на молнии и внутренний карман для документов. Держит форму, не мнётся в дороге. Размерный ряд S–XXL.')}`;

write('ResultsDone', shell({
  header: appHeader('new', '65 баллов'),
  body: `${h1('Куртка-бомбер хаки, мужская')}
      ${columns(
    requestPanel('Списано 55 баллов · баланс 65', `<div style="display: flex; flex-direction: column; gap: 10px">${btn('Создать ещё одну', 'outline')}</div>`),
    panel(`<div style="display: flex; align-items: center; justify-content: space-between">
          ${sectionTitle('Результаты')}
          ${statusPill('Готово', 'success')}
        </div>
        <div style="display: flex; gap: 20px; align-items: flex-start">
          ${cardShot(288)}
          <div style="flex: 1; display: flex; flex-direction: column; gap: 16px">
            ${cardTexts}
            <div style="display: flex; gap: 10px">
              <div style="flex: 1">${btn('Скачать изображение')}</div>
              <div style="flex: 1">${btn('В каталог', 'outline')}</div>
            </div>
          </div>
        </div>
        ${outputParams(OUT, 'Файл готов под требования Ozon для категории «Одежда и обувь» — загружается в карточку как есть.')}
        <span style="font-size: 13px; line-height: 18px; color: ${C.mutedFg}">Изображение скачивается в полном разрешении. Генерация уже в каталоге — открыть и скачать её снова можно бесплатно.</span>`),
    WIDE
  )}`
}));

/* ---------- 13. Результаты — сбой (US-E4) ---------- */

// Промежуточного исхода нет: решение пользователя 2026-08-29 — либо всё, либо ничего.
// Неполная карточка (изображение есть, тексты нет) — тот же сбой: полный возврат, клиент
// не получает ничего, ему предлагается повторить генерацию с теми же параметрами.
write('ResultsFailed', shell({
  header: appHeader('new', '120 баллов'),
  body: `${h1('Генерация не удалась')}
      ${columns(
    requestPanel('Списано 55 · возврат 55 · баланс 120', `<div style="display: flex; flex-direction: column; gap: 10px">${btn('Изменить настройки', 'outline')}</div>`),
    panel(`<div style="display: flex; align-items: center; justify-content: space-between">
          ${sectionTitle('Результаты')}
          ${statusPill('Сбой', 'neutral')}
        </div>
        ${alertBox('error', '<span>Карточка не собралась целиком. Вернули все <b>55 баллов</b> — баланс снова 120, платить дважды за одну попытку не придётся.</span>')}
        <div style="height: 300px; border: 1px dashed ${C.border}; border-radius: 8px; background: ${C.muted}; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; text-align: center; padding: 24px">
          <div style="width: 56px; height: 56px; border-radius: 28px; background: ${C.red50}; border: 1px solid ${C.red200}; display: flex; align-items: center; justify-content: center">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="${C.red700}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20L12 3Z"></path><path d="M12 10v4M12 17h.01"></path></svg>
          </div>
          <div style="display: flex; flex-direction: column; gap: 6px; max-width: 420px">
            <span style="font-size: 16px; font-weight: 500; color: ${C.fg}">Результата нет</span>
            <span style="font-size: 13px; line-height: 18px; color: ${C.mutedFg}">Половину карточки не отдаём: если не получилось изображение или не получились тексты — не получилась вся генерация. В каталог она не попадает и списка не засоряет.</span>
          </div>
          <div style="width: 320px; margin-top: 4px">${btn('Повторить с теми же параметрами')}</div>
          <span style="font-size: 13px; color: ${C.mutedFg}">Повторный запуск стоит те же 55 баллов</span>
        </div>`),
    WIDE
  )}`
}));

/* ---------- 15. Каталог с данными (FR-01) ---------- */

const CATALOG = [
  { title: 'Куртка-бомбер хаки, мужская', date: '29.08.2026', kind: 'Карточка', market: 'Ozon', silhouette: 'model' },
  { title: 'Кроссовки беговые, серые', date: '29.08.2026', kind: 'Фото', market: 'Wildberries', silhouette: 'box' },
  { title: 'Термокружка стальная, 450 мл', date: '28.08.2026', kind: 'Карточка', market: 'Яндекс Маркет', silhouette: 'bottle' },
  { title: 'Платье миди в мелкий цветок', date: '28.08.2026', kind: 'Фото', market: 'Wildberries', silhouette: 'hanger' },
  { title: 'Крем для рук с ромашкой', date: '27.08.2026', kind: 'Карточка', market: 'Ozon', silhouette: 'bottle' },
  { title: 'Наушники накладные, чёрные', date: '27.08.2026', kind: 'Фото', market: 'Ozon', silhouette: 'box' },
  { title: 'Футболка оверсайз, белая', date: '27.08.2026', kind: 'Карточка', market: 'Wildberries', silhouette: 'flat' },
  { title: 'Кофе в зёрнах, 1 кг', date: '26.08.2026', kind: 'Фото', market: 'Яндекс Маркет', silhouette: 'bottle' }
];

write('CatalogData', shell({
  header: appHeader('catalog', '120 баллов'),
  body: `<div style="display: flex; align-items: center; justify-content: space-between">
        ${h1('Каталог генераций')}
        <div style="width: 200px">${btn('Создать генерацию')}</div>
      </div>
      <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 20px">
        ${CATALOG.map(catalogCard).join('')}
      </div>
      <span style="font-size: 13px; color: ${C.mutedFg}">Материалы любой генерации скачиваются повторно без списания баллов.</span>`
}));

/* ---------- Мобильные артборды (NFR-09) ---------- */

const MW = 390;
// Кадр выше телефонного вьюпорта намеренно: артборд показывает шаг целиком, без обрезки.
// Ограничение NFR-09 — по ШИРИНЕ (360 px порог, рисуем на 390), высота роли не играет.
const MH = 940;

const mobileHeader = (balance) => `<header style="height: 56px; flex: none; background: ${C.bg}; border-bottom: 1px solid ${C.border}; padding: 0 16px; display: flex; align-items: center; justify-content: space-between">
    ${logo(24)}
    <div style="display: flex; align-items: center; gap: 12px">
      ${balancePill(balance)}
      <div style="width: 44px; height: 44px; display: flex; align-items: center; justify-content: center">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${C.fg}" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"></path></svg>
      </div>
    </div>
  </header>`;

const mobileShell = (header, inner, bottomBar = '') => `<div style="width: ${MW}px; height: ${MH}px; background: ${C.muted}; display: flex; flex-direction: column">
  ${header}
  <main style="flex: 1; min-height: 0; overflow: hidden; padding: 16px; display: flex; flex-direction: column; gap: 12px">${inner}</main>
  ${bottomBar}
</div>`;

const mh1 = (t) => `<h1 style="margin: 0; font-size: 22px; font-weight: 600; letter-spacing: -0.02em; color: ${C.fg}">${t}</h1>`;

// Вертикальный степпер: пройденные шаги свёрнуты в строку с выбранным значением,
// текущий — раскрыт, будущие — компактной строкой. Высота строк 48 px (NFR-07).
const mStepRow = (n, label, value, state) => {
  const dot = state === 'done'
    ? `<div style="width: 26px; height: 26px; flex: none; border-radius: 13px; background: ${C.primary}; display: flex; align-items: center; justify-content: center"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${C.primaryFg}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg></div>`
    : `<div style="width: 26px; height: 26px; flex: none; border-radius: 13px; background: ${C.muted}; border: 1px solid ${C.border}; color: ${C.mutedFg}; font-size: 13px; font-weight: 600; display: flex; align-items: center; justify-content: center">${n}</div>`;
  return `<div style="min-height: 48px; display: flex; align-items: center; gap: 12px; padding: 0 14px; background: ${C.bg}; border: 1px solid ${C.border}; border-radius: 8px">
          ${dot}
          <span style="flex: 1; font-size: 14px; color: ${state === 'done' ? C.fg : C.mutedFg}">${label}</span>
          <span style="font-size: 13px; color: ${C.mutedFg}; text-align: right">${value}</span>
        </div>`;
};

const mobileBottomBar = (price, action) => `<div style="flex: none; background: ${C.bg}; border-top: 1px solid ${C.border}; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px">
    <div style="display: flex; flex-direction: column">
      <span style="font-size: 12px; color: ${C.mutedFg}">К списанию</span>
      <span style="font-size: 16px; font-weight: 600; color: ${C.fg}">${price}</span>
    </div>
    <div style="width: 150px; height: 48px">
      <div style="height: 48px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 500; background: ${C.primary}; color: ${C.primaryFg}; border: 1px solid ${C.primary}">${action}</div>
    </div>
  </div>`;

write('MobileWizard', mobileShell(
  mobileHeader('120'),
  `${mh1('Создать генерацию')}
    ${mStepRow(1, 'Фото', '3 из 4', 'done')}
    ${mStepRow(2, 'Товар', 'Куртка-бомбер', 'done')}
    ${mStepRow(3, 'Площадка', 'Ozon', 'done')}
    ${mStepRow(4, 'Тип', 'Карточка', 'done')}
    <section style="background: ${C.bg}; border: 2px solid ${C.primary}; border-radius: 8px; padding: 16px; display: flex; flex-direction: column; gap: 12px">
      <div style="display: flex; align-items: center; gap: 12px">
        <div style="width: 26px; height: 26px; flex: none; border-radius: 13px; background: ${C.bg}; border: 2px solid ${C.primary}; color: ${C.primary}; font-size: 13px; font-weight: 600; display: flex; align-items: center; justify-content: center">5</div>
        <span style="flex: 1; font-size: 15px; font-weight: 600; color: ${C.fg}">Как показать товар</span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px">
        ${PRESETS.map((p) => presetCard({ ...p, previewH: 88 })).join('')}
      </div>
      ${textarea({ label: 'Пожелания к генерации', placeholder: 'Например: тёплый вечерний свет', height: 56 })}
    </section>
    ${mStepRow(6, 'Запуск', '', 'upcoming')}`,
  mobileBottomBar('55 баллов', 'Далее')
));

write('MobileCatalog', mobileShell(
  mobileHeader('120'),
  `${mh1('Каталог генераций')}
    <div style="height: 48px">
      <div style="height: 48px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 500; background: ${C.primary}; color: ${C.primaryFg}; border: 1px solid ${C.primary}">Создать генерацию</div>
    </div>
    <div style="display: flex; flex-direction: column; gap: 12px">
      ${CATALOG.slice(0, 3).map(catalogCard).join('')}
    </div>`
));

console.log('D2: written 17 artboards');
