import { writeFileSync } from 'node:fs';

// Заход D2 — экраны вехи M4. Палитра, шрифт и контролы подняты из `../d1-account/gen.mjs`
// ДОСЛОВНО: D2 продолжает визуальный словарь D1 и новых цветов не заводит (см. план
// `planning/active/d2-generation-screens_2026-08-29.md`, раздел Verification). Меняется
// палитра — правятся оба файла в одном изменении.
export const C = {
  bg: '#FFFFFF', fg: '#09090B', muted: '#F4F4F5', mutedFg: '#52525B',
  primary: '#15803D', primaryFg: '#FFFFFF', brand: '#16A34A', border: '#E4E4E7',
  destructive: '#DC2626', ph: '#52525B', green50: '#F0FDF4', green200: '#BBF7D0',
  red50: '#FEF2F2', red200: '#FECACA', red700: '#B91C1C', green700: '#15803D'
};
export const FONT = 'ui-sans-serif, system-ui, "Segoe UI", "Noto Sans", Arial, sans-serif';

export const doc = (inner) => `<!doctype html>
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

export const write = (name, html) => { writeFileSync(new URL(`./${name}.dc.html`, import.meta.url), doc(html)); };

/* ---------- Шапка и общие контролы (словарь D1) ---------- */

export const logo = (size = 28) => `<div style="display: flex; align-items: center; gap: 10px">
      <div style="width: ${size}px; height: ${size}px; border-radius: 8px; background: ${C.primary}; display: flex; align-items: center; justify-content: center">
        <svg width="${Math.round(size * 0.57)}" height="${Math.round(size * 0.57)}" viewBox="0 0 24 24" fill="none" stroke="${C.primaryFg}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 8-9-5-9 5v8l9 5 9-5Z"></path><path d="m3 8 9 5 9-5"></path><path d="M12 13v8"></path></svg>
      </div>
      <span style="font-size: 16px; font-weight: 600; letter-spacing: -0.01em; color: ${C.fg}">Merch Kit</span>
    </div>`;

export const navLink = (t, active) => `<span style="font-size: 14px; font-weight: ${active ? 500 : 400}; color: ${active ? C.fg : C.mutedFg}; padding: 8px 0; border-bottom: 2px solid ${active ? C.brand : 'transparent'}">${t}</span>`;

export const coinIcon = (size = 14, color = C.green700) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v10M9.5 9.5h3.5a1.75 1.75 0 0 1 0 3.5H9.5"></path></svg>`;

export const balancePill = (balance) => `<div style="display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 12px; border-radius: 16px; background: ${C.green50}; border: 1px solid ${C.green200}">
        ${coinIcon()}
        <span style="font-size: 13px; font-weight: 500; color: ${C.green700}">${balance}</span>
      </div>`;

export const appHeader = (active, balance) => `<header style="height: 64px; flex: none; background: ${C.bg}; border-bottom: 1px solid ${C.border}; padding: 0 40px; display: flex; align-items: center; justify-content: space-between">
    <div style="display: flex; align-items: center; gap: 40px">
      ${logo()}
      <nav style="display: flex; align-items: center; gap: 28px; height: 64px; padding-top: 22px">
        ${navLink('Создать генерацию', active === 'new')}
        ${navLink('Каталог', active === 'catalog')}
        ${navLink('Профиль', active === 'profile')}
      </nav>
    </div>
    <div style="display: flex; align-items: center; gap: 16px">
      ${balancePill(balance)}
      <div style="width: 32px; height: 32px; border-radius: 16px; background: ${C.muted}; border: 1px solid ${C.border}; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 500; color: ${C.mutedFg}">ИП</div>
    </div>
  </header>`;

// Гость: те же 64 px, но вместо баланса и аватара — вход и регистрация (FR-12).
export const guestHeader = () => `<header style="height: 64px; flex: none; background: ${C.bg}; border-bottom: 1px solid ${C.border}; padding: 0 40px; display: flex; align-items: center; justify-content: space-between">
    ${logo()}
    <div style="display: flex; align-items: center; gap: 10px">
      <div style="height: 40px; padding: 0 16px; border-radius: 6px; display: flex; align-items: center; font-size: 14px; font-weight: 500; color: ${C.fg}">Войти</div>
      <div style="height: 40px; padding: 0 16px; border-radius: 6px; display: flex; align-items: center; font-size: 14px; font-weight: 500; background: ${C.primary}; color: ${C.primaryFg}">Регистрация</div>
    </div>
  </header>`;

export const btn = (text, kind = 'primary') => {
  const styles = {
    primary: `background: ${C.primary}; color: ${C.primaryFg}; border: 1px solid ${C.primary}`,
    outline: `background: ${C.bg}; color: ${C.fg}; border: 1px solid ${C.border}`,
    ghost: `background: transparent; color: ${C.fg}; border: 1px solid transparent`,
    // Неактивная кнопка: серый #52525B на подложке #F4F4F5 — 7.03, порог AA пройден.
    disabled: `background: ${C.muted}; color: ${C.mutedFg}; border: 1px solid ${C.border}`
  }[kind];
  return `<div style="height: 40px; padding: 0 16px; border-radius: 6px; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 14px; font-weight: 500; ${styles}">${text}</div>`;
};

export const panel = (inner, pad = 24) => `<section style="background: ${C.bg}; border: 1px solid ${C.border}; border-radius: 8px; box-shadow: 0 1px 3px rgba(9, 9, 11, 0.06); padding: ${pad}px; display: flex; flex-direction: column; gap: 16px">${inner}</section>`;

export const sectionTitle = (t, sub) => `<div style="display: flex; flex-direction: column; gap: 4px">
        <h2 style="margin: 0; font-size: 16px; font-weight: 600; color: ${C.fg}">${t}</h2>
        ${sub ? `<p style="margin: 0; font-size: 13px; line-height: 18px; color: ${C.mutedFg}">${sub}</p>` : ''}
      </div>`;

export const field = ({ label, value = '', placeholder = '', hint = '', badge = '', icon = '' }) => `<div style="display: flex; flex-direction: column; gap: 6px">
        <div style="display: flex; align-items: center; gap: 8px">
          <label style="font-size: 14px; font-weight: 500; color: ${C.fg}">${label}</label>
          ${badge}
        </div>
        <div style="height: 40px; border: 1px solid ${C.border}; border-radius: 6px; background: ${C.bg}; padding: 0 12px; display: flex; align-items: center; justify-content: space-between">
          <span style="font-size: 14px; color: ${value ? C.fg : C.ph}">${value || placeholder}</span>
          ${icon}
        </div>
        ${hint ? `<div style="font-size: 13px; line-height: 18px; color: ${C.mutedFg}">${hint}</div>` : ''}
      </div>`;

export const textarea = ({ label, value = '', placeholder = '', hint = '', height = 96 }) => `<div style="display: flex; flex-direction: column; gap: 6px">
        <label style="font-size: 14px; font-weight: 500; color: ${C.fg}">${label}</label>
        <div style="min-height: ${height}px; border: 1px solid ${C.border}; border-radius: 6px; background: ${C.bg}; padding: 10px 12px">
          <span style="font-size: 14px; line-height: 20px; color: ${value ? C.fg : C.ph}">${value || placeholder}</span>
        </div>
        ${hint ? `<div style="font-size: 13px; line-height: 18px; color: ${C.mutedFg}">${hint}</div>` : ''}
      </div>`;

export const chevron = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${C.mutedFg}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"></path></svg>`;

export const aiBadge = `<span style="display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 500; color: ${C.green700}; background: ${C.green50}; border: 1px solid ${C.green200}; border-radius: 10px; padding: 2px 8px">Определил ИИ</span>`;

/* ---------- Плашки-сообщения ---------- */

export const alertBox = (kind, inner) => {
  const s = {
    error: { bg: C.red50, bd: C.red200, fg: C.red700 },
    success: { bg: C.green50, bd: C.green200, fg: C.green700 },
    info: { bg: C.muted, bd: C.border, fg: C.mutedFg }
  }[kind];
  const icon = kind === 'error'
    ? '<circle cx="12" cy="12" r="9"></circle><path d="M12 8v5M12 16h.01"></path>'
    : kind === 'success'
      ? '<path d="M20 6 9 17l-5-5"></path>'
      : '<circle cx="12" cy="12" r="9"></circle><path d="M12 16v-5M12 8h.01"></path>';
  return `<div style="display: flex; gap: 10px; padding: 12px 14px; border-radius: 6px; background: ${s.bg}; border: 1px solid ${s.bd}">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${s.fg}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex: none; margin-top: 1px">${icon}</svg>
        <div style="display: flex; flex-direction: column; gap: 4px; font-size: 13px; line-height: 18px; color: ${s.fg}">${inner}</div>
      </div>`;
};

export const statusPill = (text, kind) => {
  const s = kind === 'success'
    ? { bg: C.green50, bd: C.green200, fg: C.green700 }
    : { bg: C.muted, bd: C.border, fg: C.mutedFg };
  return `<span style="display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 500; color: ${s.fg}; background: ${s.bg}; border: 1px solid ${s.bd}; border-radius: 10px; padding: 3px 9px">${text}</span>`;
};
