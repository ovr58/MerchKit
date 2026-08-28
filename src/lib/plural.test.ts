import { describe, expect, it } from 'vitest'

import { plural } from './plural'

const objects = (count: number) => `${count} ${plural(count, 'объект', 'объекта', 'объектов')}`

describe('Склонение при числе', () => {
  it('берёт форму по последней цифре', () => {
    expect(objects(1)).toBe('1 объект')
    expect(objects(2)).toBe('2 объекта')
    expect(objects(5)).toBe('5 объектов')
    expect(objects(0)).toBe('0 объектов')
  })

  it('не путается на втором десятке, где правило другое', () => {
    expect(objects(11)).toBe('11 объектов')
    expect(objects(12)).toBe('12 объектов')
    expect(objects(21)).toBe('21 объект')
    expect(objects(22)).toBe('22 объекта')
    expect(objects(112)).toBe('112 объектов')
  })
})
