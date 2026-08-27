import { writeFileSync } from 'node:fs';

// Палитра синхронизирована с токенами кода (`src/index.css`): значения текстовых пар
// подняты до порога WCAG 2.1 AA (NFR-07), рядом — посчитанный коэффициент.
//   primary     #16A34A → #15803D  (белый текст на кнопке: было 3.30, стало 5.02)
//   destructive #EF4444 → #DC2626  (белый текст: было 3.76, стало 4.83)
//   mutedFg     #71717A → #52525B  (на подложке #F4F4F5: было 4.40, стало 7.03)
//   ph          #A1A1AA → #52525B  (плейсхолдер — тоже текст: было 2.56, стало 7.03)
// Исходный оттенок #16A34A остался как `brand` — нетекстовый акцент: рамки, индикаторы.
const C = {
  bg: '#FFFFFF', fg: '#09090B', muted: '#F4F4F5', mutedFg: '#52525B',
  primary: '#15803D', primaryFg: '#FFFFFF', brand: '#16A34A', border: '#E4E4E7',
  destructive: '#DC2626', ph: '#52525B', green50: '#F0FDF4', green200: '#BBF7D0',
  red50: '#FEF2F2', red200: '#FECACA', red700: '#B91C1C', green700: '#15803D'
};
const FONT = 'ui-sans-serif, system-ui, "Segoe UI", "Noto Sans", Arial, sans-serif';

const doc = (inner) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>
    body { margin: 0; font-family: ${FONT}; -webkit-font-smoothing: antialiased; }
    * { box-sizing: border-box; }
    a { color: ${C.primary}; text-decoration: none; }
    a:hover { color: ${C.green700}; }
  </style>
</helmet>
${inner}
</x-dc>
</body>
</html>
`;

const logo = `<div style="display: flex; align-items: center; gap: 10px">
      <div style="width: 28px; height: 28px; border-radius: 8px; background: ${C.primary}; display: flex; align-items: center; justify-content: center">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${C.primaryFg}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 8-9-5-9 5v8l9 5 9-5Z"></path><path d="m3 8 9 5 9-5"></path><path d="M12 13v8"></path></svg>
      </div>
      <span style="font-size: 16px; font-weight: 600; letter-spacing: -0.01em; color: ${C.fg}">Merch Kit</span>
    </div>`;

const authHeader = (rightHtml) => `<header style="height: 64px; flex: none; background: ${C.bg}; border-bottom: 1px solid ${C.border}; padding: 0 40px; display: flex; align-items: center; justify-content: space-between">
    ${logo}
    <div style="display: flex; align-items: center; gap: 10px; font-size: 14px; color: ${C.mutedFg}">${rightHtml}</div>
  </header>`;

const navLink = (t, active) => `<span style="font-size: 14px; font-weight: ${active ? 500 : 400}; color: ${active ? C.fg : C.mutedFg}; padding: 8px 0; border-bottom: 2px solid ${active ? C.brand : 'transparent'}">${t}</span>`;

const appHeader = (active, balance) => `<header style="height: 64px; flex: none; background: ${C.bg}; border-bottom: 1px solid ${C.border}; padding: 0 40px; display: flex; align-items: center; justify-content: space-between">
    <div style="display: flex; align-items: center; gap: 40px">
      ${logo}
      <nav style="display: flex; align-items: center; gap: 28px; height: 64px; padding-top: 22px">
        ${navLink('Создать генерацию', active === 'new')}
        ${navLink('Каталог', active === 'catalog')}
        ${navLink('Профиль', active === 'profile')}
      </nav>
    </div>
    <div style="display: flex; align-items: center; gap: 16px">
      <div style="display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 12px; border-radius: 16px; background: ${C.green50}; border: 1px solid ${C.green200}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${C.green700}" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v10M9.5 9.5h3.5a1.75 1.75 0 0 1 0 3.5H9.5"></path></svg>
        <span style="font-size: 13px; font-weight: 500; color: ${C.green700}">${balance}</span>
      </div>
      <div style="width: 32px; height: 32px; border-radius: 16px; background: ${C.muted}; border: 1px solid ${C.border}; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 500; color: ${C.mutedFg}">ИП</div>
    </div>
  </header>`;

const field = ({ label, value = '', placeholder = '', error = '', hint = '', focus = false, icon = '' }) => `<div style="display: flex; flex-direction: column; gap: 6px">
        <label style="font-size: 14px; font-weight: 500; color: ${C.fg}">${label}</label>
        <div style="height: 40px; border: 1px solid ${error ? C.destructive : C.border}; border-radius: 6px; background: ${C.bg}; padding: 0 12px; display: flex; align-items: center; justify-content: space-between; ${focus ? `box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.25); border-color: ${C.brand}` : ''}">
          <span style="font-size: 14px; color: ${value ? C.fg : C.ph}">${value || placeholder}</span>
          ${icon}
        </div>
        ${error ? `<div style="display: flex; align-items: center; gap: 6px; font-size: 13px; color: ${C.destructive}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${C.destructive}" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 8v5M12 16h.01"></path></svg>
          <span>${error}</span>
        </div>` : ''}
        ${hint ? `<div style="font-size: 13px; color: ${C.mutedFg}">${hint}</div>` : ''}
      </div>`;

const eyeIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${C.ph}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;

const btn = (text, kind = 'primary') => {
  const styles = {
    primary: `background: ${C.primary}; color: ${C.primaryFg}; border: 1px solid ${C.primary}`,
    outline: `background: ${C.bg}; color: ${C.fg}; border: 1px solid ${C.border}`,
    ghost: `background: transparent; color: ${C.fg}; border: 1px solid transparent`
  }[kind];
  return `<div style="height: 40px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 500; ${styles}">${text}</div>`;
};

const card = (inner, width = 440) => `<div style="width: ${width}px; background: ${C.bg}; border: 1px solid ${C.border}; border-radius: 8px; box-shadow: 0 1px 3px rgba(9, 9, 11, 0.06); padding: 32px; display: flex; flex-direction: column; gap: 20px">${inner}</div>`;

const cardHead = (title, desc) => `<div style="display: flex; flex-direction: column; gap: 6px">
        <h1 style="margin: 0; font-size: 24px; font-weight: 600; letter-spacing: -0.02em; color: ${C.fg}">${title}</h1>
        <p style="margin: 0; font-size: 14px; line-height: 20px; color: ${C.mutedFg}">${desc}</p>
      </div>`;

const authPage = (headerRightHtml, cardInner, cardWidth) => `<div style="width: 1440px; height: 900px; background: ${C.muted}; display: flex; flex-direction: column">
  ${authHeader(headerRightHtml)}
  <main style="flex: 1; display: flex; align-items: center; justify-content: center; padding: 40px">
    ${card(cardInner, cardWidth)}
  </main>
</div>`;

const headerRight = (text, link) => `<span>${text}</span><a href="#" style="font-weight: 500">${link}</a>`;

const write = (name, html) => { writeFileSync(new URL(`./${name}.dc.html`, import.meta.url), doc(html)); };

/* ---------- 1. Вход ---------- */
write('Main', authPage(headerRight('Нет аккаунта?', 'Регистрация'), `
      ${cardHead('Вход', 'Войдите, чтобы вернуться к своему каталогу генераций и баллам.')}
      ${field({ label: 'Email', value: 'seller@example.com', focus: true })}
      <div style="display: flex; flex-direction: column; gap: 6px">
        <div style="display: flex; align-items: center; justify-content: space-between">
          <label style="font-size: 14px; font-weight: 500; color: ${C.fg}">Пароль</label>
          <a href="#" style="font-size: 13px; font-weight: 500">Забыли пароль?</a>
        </div>
        <div style="height: 40px; border: 1px solid ${C.border}; border-radius: 6px; background: ${C.bg}; padding: 0 12px; display: flex; align-items: center; justify-content: space-between">
          <span style="font-size: 14px; color: ${C.fg}">••••••••••</span>
          ${eyeIcon}
        </div>
      </div>
      ${btn('Войти')}
      <div style="text-align: center; font-size: 14px; color: ${C.mutedFg}">Нет аккаунта? <a href="#" style="font-weight: 500">Зарегистрироваться</a></div>`));

/* ---------- 2. Вход — ошибка ---------- */
write('SignInError', authPage(headerRight('Нет аккаунта?', 'Регистрация'), `
      ${cardHead('Вход', 'Войдите, чтобы вернуться к своему каталогу генераций и баллам.')}
      <div style="display: flex; gap: 10px; padding: 12px 14px; border-radius: 6px; background: ${C.red50}; border: 1px solid ${C.red200}">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${C.red700}" stroke-width="2" stroke-linecap="round" style="flex: none; margin-top: 1px"><circle cx="12" cy="12" r="9"></circle><path d="M12 8v5M12 16h.01"></path></svg>
        <div style="font-size: 13px; line-height: 18px; color: ${C.red700}">Неверный email или пароль. Проверьте раскладку и регистр — или <a href="#" style="color: ${C.red700}; text-decoration: underline">восстановите пароль</a>.</div>
      </div>
      ${field({ label: 'Email', value: 'seller@example.com' })}
      <div style="display: flex; flex-direction: column; gap: 6px">
        <div style="display: flex; align-items: center; justify-content: space-between">
          <label style="font-size: 14px; font-weight: 500; color: ${C.fg}">Пароль</label>
          <a href="#" style="font-size: 13px; font-weight: 500">Забыли пароль?</a>
        </div>
        <div style="height: 40px; border: 1px solid ${C.destructive}; border-radius: 6px; background: ${C.bg}; padding: 0 12px; display: flex; align-items: center; justify-content: space-between">
          <span style="font-size: 14px; color: ${C.fg}">••••••</span>
          ${eyeIcon}
        </div>
      </div>
      ${btn('Войти')}
      <div style="text-align: center; font-size: 14px; color: ${C.mutedFg}">Нет аккаунта? <a href="#" style="font-weight: 500">Зарегистрироваться</a></div>`));

/* ---------- 3. Регистрация ---------- */
write('SignUp', authPage(headerRight('Уже есть аккаунт?', 'Войти'), `
      ${cardHead('Регистрация', 'После подтверждения email на баланс придут 120 стартовых баллов — это две пробные генерации.')}
      ${field({ label: 'Email', value: '', placeholder: 'you@example.com' })}
      ${field({ label: 'Пароль', value: '', placeholder: 'Минимум 8 символов', icon: eyeIcon })}
      ${field({ label: 'Подтверждение пароля', value: '', placeholder: 'Повторите пароль', icon: eyeIcon })}
      ${btn('Создать аккаунт')}
      <p style="margin: 0; font-size: 13px; line-height: 18px; color: ${C.mutedFg}; text-align: center">Мы отправим письмо со ссылкой подтверждения. До перехода по ней запуск генерации недоступен.</p>`));

/* ---------- 4. Регистрация — ошибки полей ---------- */
write('SignUpErrors', authPage(headerRight('Уже есть аккаунт?', 'Войти'), `
      ${cardHead('Регистрация', 'После подтверждения email на баланс придут 120 стартовых баллов — это две пробные генерации.')}
      ${field({ label: 'Email', value: 'seller@example.com', error: 'Этот email уже зарегистрирован. Войдите или восстановите пароль.' })}
      ${field({ label: 'Пароль', value: '••••••••••', icon: eyeIcon })}
      ${field({ label: 'Подтверждение пароля', value: '••••••••', error: 'Подтверждение не совпадает с паролем', icon: eyeIcon })}
      ${btn('Создать аккаунт')}
      <p style="margin: 0; font-size: 13px; line-height: 18px; color: ${C.mutedFg}; text-align: center">Мы отправим письмо со ссылкой подтверждения. До перехода по ней запуск генерации недоступен.</p>`));

/* ---------- 5. Подтвердите email ---------- */
const mailArt = (stroke) => `<div style="width: 56px; height: 56px; border-radius: 28px; background: ${C.green50}; border: 1px solid ${C.green200}; display: flex; align-items: center; justify-content: center">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"></rect><path d="m2 7 10 6 10-6"></path></svg>
      </div>`;

write('ConfirmEmail', authPage(headerRight('Не тот адрес?', 'Выйти'), `
      <div style="display: flex; flex-direction: column; align-items: center; gap: 20px; text-align: center">
        ${mailArt(C.green700)}
        <div style="display: flex; flex-direction: column; gap: 8px">
          <h1 style="margin: 0; font-size: 24px; font-weight: 600; letter-spacing: -0.02em; color: ${C.fg}">Подтвердите email</h1>
          <p style="margin: 0; font-size: 14px; line-height: 20px; color: ${C.mutedFg}">Мы отправили письмо на <span style="color: ${C.fg}; font-weight: 500">seller@example.com</span>. Перейдите по ссылке из него — и на баланс придут 120 стартовых баллов.</p>
        </div>
        <div style="width: 100%; display: flex; flex-direction: column; gap: 10px">
          ${btn('Отправить письмо повторно', 'outline')}
          <div style="font-size: 13px; color: ${C.mutedFg}">Повторная отправка будет доступна через 0:47</div>
        </div>
        <div style="width: 100%; height: 1px; background: ${C.border}"></div>
        <p style="margin: 0; font-size: 13px; line-height: 18px; color: ${C.mutedFg}">Письма нет во «Входящих» — проверьте «Спам» и «Промоакции». До подтверждения аккаунт работает, но запуск генерации недоступен.</p>
      </div>`));

/* ---------- 6. Восстановление — запрос ---------- */
write('ResetRequest', authPage(headerRight('Вспомнили пароль?', 'Войти'), `
      ${cardHead('Восстановление пароля', 'Введите email аккаунта — пришлём ссылку для смены пароля.')}
      ${field({ label: 'Email', value: '', placeholder: 'you@example.com' })}
      ${btn('Отправить ссылку')}
      <div style="text-align: center; font-size: 14px; color: ${C.mutedFg}"><a href="#" style="font-weight: 500">Вернуться ко входу</a></div>`));

/* ---------- 7. Восстановление — отправлено (US-E7) ---------- */
write('ResetSent', authPage(headerRight('Вспомнили пароль?', 'Войти'), `
      <div style="display: flex; flex-direction: column; align-items: center; gap: 20px; text-align: center">
        ${mailArt(C.green700)}
        <div style="display: flex; flex-direction: column; gap: 8px">
          <h1 style="margin: 0; font-size: 24px; font-weight: 600; letter-spacing: -0.02em; color: ${C.fg}">Проверьте почту</h1>
          <p style="margin: 0; font-size: 14px; line-height: 20px; color: ${C.mutedFg}">Если аккаунт с адресом <span style="color: ${C.fg}; font-weight: 500">seller@example.com</span> существует, мы отправили на него ссылку для смены пароля. Ссылка действует 60 минут.</p>
        </div>
        <div style="width: 100%">${btn('Вернуться ко входу', 'outline')}</div>
      </div>`));

/* ---------- 8. Новый пароль ---------- */
write('ResetNewPassword', authPage('', `
      ${cardHead('Новый пароль', 'Задайте новый пароль — старый перестанет действовать сразу.')}
      ${field({ label: 'Новый пароль', value: '', placeholder: 'Минимум 8 символов', hint: 'Минимум 8 символов, буквы и цифры', icon: eyeIcon })}
      ${field({ label: 'Подтверждение пароля', value: '', placeholder: 'Повторите пароль', icon: eyeIcon })}
      ${btn('Сохранить пароль')}`));

/* ---------- Профиль ---------- */
const sectionTitle = (t, sub) => `<div style="display: flex; flex-direction: column; gap: 4px">
        <h2 style="margin: 0; font-size: 16px; font-weight: 600; color: ${C.fg}">${t}</h2>
        ${sub ? `<p style="margin: 0; font-size: 13px; color: ${C.mutedFg}">${sub}</p>` : ''}
      </div>`;

const panel = (inner, pad = 24) => `<section style="background: ${C.bg}; border: 1px solid ${C.border}; border-radius: 8px; box-shadow: 0 1px 3px rgba(9, 9, 11, 0.06); padding: ${pad}px; display: flex; flex-direction: column; gap: 16px">${inner}</section>`;

const pack = (name, points, price, per, featured) => `<div style="flex: 1; border: 1px solid ${featured ? C.primary : C.border}; border-radius: 8px; padding: 20px; display: flex; flex-direction: column; gap: 14px; background: ${featured ? C.green50 : C.bg}">
          <div style="display: flex; align-items: center; justify-content: space-between; min-height: 22px">
            <span style="font-size: 14px; font-weight: 600; color: ${C.fg}">${name}</span>
            ${featured ? `<span style="font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: ${C.green700}; background: ${C.bg}; border: 1px solid ${C.green200}; border-radius: 10px; padding: 3px 8px">Выгоднее</span>` : ''}
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px">
            <div style="display: flex; align-items: baseline; gap: 6px">
              <span style="font-size: 28px; font-weight: 600; letter-spacing: -0.02em; color: ${C.fg}">${points}</span>
              <span style="font-size: 14px; color: ${C.mutedFg}">баллов</span>
            </div>
            <div style="font-size: 13px; color: ${C.mutedFg}">${price} · ${per}</div>
          </div>
          ${btn('Пополнить', featured ? 'primary' : 'outline')}
        </div>`;

const historyRow = (date, op, delta, balance, positive) => `<div style="display: grid; grid-template-columns: 120px minmax(0, 1fr) 90px 90px; gap: 16px; align-items: center; padding: 12px 0; border-top: 1px solid ${C.border}; font-size: 14px">
          <span style="color: ${C.mutedFg}">${date}</span>
          <span style="color: ${C.fg}">${op}</span>
          <span style="text-align: right; font-weight: 500; color: ${positive ? C.green700 : C.fg}">${delta}</span>
          <span style="text-align: right; color: ${C.mutedFg}">${balance}</span>
        </div>`;

const accountPanel = () => panel(`
        ${sectionTitle('Аккаунт')}
        <div style="display: flex; flex-direction: column; gap: 12px; font-size: 14px">
          <div style="display: flex; flex-direction: column; gap: 2px">
            <span style="font-size: 13px; color: ${C.mutedFg}">Email</span>
            <div style="display: flex; align-items: center; gap: 8px">
              <span style="color: ${C.fg}">seller@example.com</span>
              <span style="display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 500; color: ${C.green700}; background: ${C.green50}; border: 1px solid ${C.green200}; border-radius: 10px; padding: 2px 8px">Подтверждён</span>
            </div>
          </div>
          <div style="display: flex; flex-direction: column; gap: 2px">
            <span style="font-size: 13px; color: ${C.mutedFg}">Аккаунт создан</span>
            <span style="color: ${C.fg}">27 августа 2026</span>
          </div>
        </div>
        <div style="height: 1px; background: ${C.border}"></div>
        <div style="display: flex; flex-direction: column; gap: 8px">
          ${btn('Сменить пароль', 'outline')}
          ${btn('Выйти', 'ghost')}
        </div>`);

// Артборда «профиль до подтверждения» здесь нет намеренно: подтверждение email закрывает
// вход целиком, и неподтверждённый пользователь профиля не видит (ADR-0008).
const profilePage = () => `<div style="width: 1440px; height: 1024px; background: ${C.muted}; display: flex; flex-direction: column">
  ${appHeader('profile', '120 баллов')}
  <main style="flex: 1; overflow: hidden; padding: 32px 40px">
    <div style="max-width: 1120px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px">
      <h1 style="margin: 0; font-size: 30px; font-weight: 600; letter-spacing: -0.02em; color: ${C.fg}">Профиль</h1>
      <div style="display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 20px; align-items: start">
        <div style="display: flex; flex-direction: column; gap: 20px">
          ${panel(`
          <div style="display: flex; align-items: flex-end; justify-content: space-between">
            <div style="display: flex; flex-direction: column; gap: 6px">
              ${sectionTitle('Баланс')}
              <div style="display: flex; align-items: baseline; gap: 8px">
                <span style="font-size: 40px; font-weight: 600; letter-spacing: -0.03em; color: ${C.fg}">120</span>
                <span style="font-size: 16px; color: ${C.mutedFg}">баллов</span>
              </div>
              <span style="font-size: 13px; color: ${C.mutedFg}">Хватит на 2 объекта — один объект стоит 50 баллов</span>
            </div>
            <div style="width: 180px">${btn('Пополнить баланс', 'primary')}</div>
          </div>`)}
          ${panel(`
          ${sectionTitle('Пакеты пополнения', 'Баллы зачисляются сразу: оплата в этой версии не подключена')}
          <div style="display: flex; gap: 16px; align-items: stretch">
            ${pack('Старт', '300', '390 ₽', '1,30 ₽ за балл', false)}
            ${pack('Стандарт', '1 000', '1 090 ₽', '1,09 ₽ за балл', true)}
            ${pack('Про', '3 000', '2 030 ₽', '0,68 ₽ за балл', false)}
          </div>`)}
          ${panel(`
          ${sectionTitle('История операций')}
          <div style="display: flex; flex-direction: column">
            <div style="display: grid; grid-template-columns: 120px minmax(0, 1fr) 90px 90px; gap: 16px; padding-bottom: 10px; font-size: 12px; font-weight: 500; letter-spacing: 0.03em; text-transform: uppercase; color: ${C.mutedFg}">
              <span>Дата</span><span>Операция</span><span style="text-align: right">Баллы</span><span style="text-align: right">Баланс</span>
            </div>
            ${historyRow('27.08.2026', 'Стартовые баллы за подтверждение email', '+120', '120', true)}
          </div>
          <p style="margin: 0; font-size: 13px; color: ${C.mutedFg}">Списания за генерации и возвраты по неудачным объектам появятся здесь же.</p>`)}
        </div>
        ${accountPanel()}
      </div>
    </div>
  </main>
</div>`;

write('Profile', profilePage());

/* ---------- Каталог ---------- */
const catalogPage = (inner) => `<div style="width: 1440px; height: 900px; background: ${C.muted}; display: flex; flex-direction: column">
  ${appHeader('catalog', '120 баллов')}
  <main style="flex: 1; overflow: hidden; padding: 32px 40px">
    <div style="max-width: 1120px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; height: 100%">
      <div style="display: flex; align-items: center; justify-content: space-between">
        <h1 style="margin: 0; font-size: 30px; font-weight: 600; letter-spacing: -0.02em; color: ${C.fg}">Каталог генераций</h1>
        <div style="width: 200px">${btn('Создать генерацию')}</div>
      </div>
      ${inner}
    </div>
  </main>
</div>`;

write('CatalogEmpty', catalogPage(`<div style="flex: 1; background: ${C.bg}; border: 1px dashed ${C.border}; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; text-align: center; padding: 40px">
        <div style="width: 64px; height: 64px; border-radius: 32px; background: ${C.muted}; display: flex; align-items: center; justify-content: center">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="${C.mutedFg}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="9" r="1.5"></circle><path d="m21 15-5-5L5 21"></path></svg>
        </div>
        <div style="display: flex; flex-direction: column; gap: 6px; max-width: 420px">
          <span style="font-size: 18px; font-weight: 600; color: ${C.fg}">Здесь появятся ваши генерации</span>
          <span style="font-size: 14px; line-height: 20px; color: ${C.mutedFg}">Загрузите фото товара — ИИ определит, что это, и предложит сценарии показа. Готовую генерацию можно открыть и скачать снова, не платя повторно.</span>
        </div>
        <div style="width: 220px; margin-top: 4px">${btn('Загрузить фото товара')}</div>
      </div>`));

const skeletonCard = `<div style="background: ${C.bg}; border: 1px solid ${C.border}; border-radius: 8px; overflow: hidden">
          <div style="height: 160px; background: ${C.muted}"></div>
          <div style="padding: 16px; display: flex; flex-direction: column; gap: 10px">
            <div style="height: 14px; width: 70%; border-radius: 4px; background: ${C.muted}"></div>
            <div style="height: 12px; width: 40%; border-radius: 4px; background: ${C.muted}"></div>
          </div>
        </div>`;

write('CatalogLoading', catalogPage(`<div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 20px">
        ${skeletonCard}${skeletonCard}${skeletonCard}${skeletonCard}${skeletonCard}${skeletonCard}${skeletonCard}${skeletonCard}
      </div>`));

write('CatalogError', catalogPage(`<div style="flex: 1; background: ${C.bg}; border: 1px solid ${C.border}; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; text-align: center; padding: 40px">
        <div style="width: 64px; height: 64px; border-radius: 32px; background: ${C.red50}; border: 1px solid ${C.red200}; display: flex; align-items: center; justify-content: center">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="${C.red700}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20L12 3Z"></path><path d="M12 10v4M12 17h.01"></path></svg>
        </div>
        <div style="display: flex; flex-direction: column; gap: 6px; max-width: 420px">
          <span style="font-size: 18px; font-weight: 600; color: ${C.fg}">Не удалось загрузить каталог</span>
          <span style="font-size: 14px; line-height: 20px; color: ${C.mutedFg}">Генерации на месте — не дошёл запрос. Повторите попытку; если не помогает, обновите страницу.</span>
        </div>
        <div style="display: flex; gap: 10px; margin-top: 4px">
          <div style="width: 160px">${btn('Повторить')}</div>
          <div style="width: 160px">${btn('Создать генерацию', 'outline')}</div>
        </div>
      </div>`));

console.log('written');
