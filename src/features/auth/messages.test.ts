import { describe, expect, it } from 'vitest'

import {
  describeAuthError,
  MESSAGES,
  validateEmail,
  validatePassword,
  validatePasswordConfirmation,
} from '@/features/auth/messages'

describe('describeAuthError', () => {
  it('переводит неверную пару в текст артборда и не привязывает её к полю', () => {
    // Артборд «Вход — неверная пара» показывает ошибку над формой, а не под полем:
    // какое из двух полей неверно — мы пользователю не сообщаем.
    expect(describeAuthError({ code: 'invalid_credentials' })).toEqual({
      message: MESSAGES.invalidCredentials,
      field: null,
    })
  })

  it('отличает неподтверждённый email от неверной пары', () => {
    // ADR-0008: до подтверждения вход отклоняется. Человека надо отправить в почту,
    // а не гонять менять пароль, поэтому текст обязан быть другим.
    const failure = describeAuthError({ code: 'email_not_confirmed' })
    expect(failure.message).toBe(MESSAGES.emailNotConfirmed)
    expect(failure.message).not.toBe(MESSAGES.invalidCredentials)
  })

  it('привязывает занятый email к полю email', () => {
    expect(describeAuthError({ code: 'user_already_exists' }).field).toBe('email')
    expect(describeAuthError({ code: 'email_exists' }).field).toBe('email')
  })

  it('объясняет лимит писем вместо общего «что-то пошло не так»', () => {
    expect(describeAuthError({ code: 'over_email_send_rate_limit' }).message).toBe(
      MESSAGES.emailSendRateLimit,
    )
  })

  it('неверный текущий пароль привязан к своему полю, а не к форме', () => {
    // Ошибку показывает поле «Текущий пароль»: человек должен видеть, что именно он ввёл
    // не так, а не гадать между тремя полями формы смены пароля.
    expect(describeAuthError({ code: 'same_password' }).field).toBe('password')
    expect(MESSAGES.currentPasswordWrong).toBeTruthy()
  })

  it('незнакомый код не протекает наружу английским текстом', () => {
    expect(describeAuthError({ code: 'some_new_code_from_gotrue' })).toEqual({
      message: MESSAGES.unknown,
      field: null,
    })
    expect(describeAuthError(null)).toEqual({ message: MESSAGES.unknown, field: null })
    expect(describeAuthError(undefined)).toEqual({ message: MESSAGES.unknown, field: null })
  })
})

describe('валидация формы', () => {
  it('ловит несовпадение подтверждения пароля (US-02)', () => {
    expect(validatePasswordConfirmation('password123', 'password124')).toBe(
      MESSAGES.passwordMismatch,
    )
    expect(validatePasswordConfirmation('password123', 'password123')).toBeNull()
  })

  it('требует минимум 8 символов — столько же, сколько требует Supabase', () => {
    expect(validatePassword('1234567')).toBe(MESSAGES.passwordTooShort)
    expect(validatePassword('12345678')).toBeNull()
    expect(validatePassword('')).toBe(MESSAGES.passwordRequired)
  })

  it('пропускает живые адреса и ловит явные опечатки', () => {
    expect(validateEmail('seller@example.com')).toBeNull()
    expect(validateEmail('  seller@example.com  ')).toBeNull()
    expect(validateEmail('seller+tag@sub.example.co.uk')).toBeNull()
    expect(validateEmail('seller@example')).toBe(MESSAGES.emailMalformed)
    expect(validateEmail('seller.example.com')).toBe(MESSAGES.emailMalformed)
    expect(validateEmail('')).toBe(MESSAGES.emailRequired)
  })
})
