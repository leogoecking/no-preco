import { formatBRL, cn } from '@/lib/utils'

describe('formatBRL', () => {
  it('formata valor decimal com vírgula e símbolo R$', () => {
    const result = formatBRL(10.5)
    expect(result).toContain('R$')
    expect(result).toContain('10,50')
  })

  it('formata zero como R$ 0,00', () => {
    expect(formatBRL(0)).toContain('0,00')
  })

  it('formata valores grandes com separador de milhar', () => {
    expect(formatBRL(1000)).toContain('1.000')
  })

  it('formata centavos corretamente', () => {
    expect(formatBRL(0.99)).toContain('0,99')
  })
})

describe('cn', () => {
  it('combina classes simples', () => {
    expect(cn('a', 'b')).toBe('a b')
  })

  it('ignora valores falsy', () => {
    expect(cn('a', false && 'b', undefined, 'c')).toBe('a c')
  })

  it('resolve conflito de utilitários Tailwind — última vence', () => {
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500')
  })

  it('retorna string vazia sem argumentos', () => {
    expect(cn()).toBe('')
  })
})
