/**
 * Русское склонение существительного при числе: «1 объект», «2 объекта», «5 объектов».
 *
 * Свой десяток строк вместо `Intl.PluralRules`: правило выбора формы тот действительно
 * знает, но самих форм не хранит — их всё равно передавать списком, и без обёртки код на
 * месте вызова читался бы хуже, чем эта функция.
 */
export function plural(count: number, one: string, few: string, many: string): string {
  const absolute = Math.abs(count) % 100
  const lastDigit = absolute % 10

  if (absolute > 10 && absolute < 20) return many
  if (lastDigit > 1 && lastDigit < 5) return few
  if (lastDigit === 1) return one
  return many
}
