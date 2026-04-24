import { EAN_REGEX } from '@/api/client'

describe('EAN_REGEX', () => {
  it.each(['12345678', '123456789012', '1234567890123', '12345678901234'])(
    'aceita sequência de dígitos com tamanho válido: %s',
    (ean) => expect(EAN_REGEX.test(ean)).toBe(true),
  )

  it.each([
    '1234567',        // 7 dígitos
    '123456789',      // 9 dígitos
    '1234567890',     // 10 dígitos
    '12345678901',    // 11 dígitos
    '123456789012345', // 15 dígitos
  ])('rejeita sequência com tamanho inválido: %s', (ean) =>
    expect(EAN_REGEX.test(ean)).toBe(false),
  )

  it.each(['abc12345678', '1234-5678', '1234 5678', ''])(
    'rejeita sequência com caracteres não numéricos: %s',
    (ean) => expect(EAN_REGEX.test(ean)).toBe(false),
  )
})
