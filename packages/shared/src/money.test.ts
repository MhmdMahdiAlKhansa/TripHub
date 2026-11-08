import { describe, expect, it } from 'vitest';
import { addMoney, applyBps, money, subMoney } from './money';

describe('money', () => {
  it('adds and subtracts same currency', () => {
    expect(addMoney(money(150, 'USD'), money(250, 'USD')).minor).toBe(400n);
    expect(subMoney(money(500, 'USD'), money(150, 'USD')).minor).toBe(350n);
  });
  it('rejects mixed currencies and fractional minor units', () => {
    expect(() => addMoney(money(1, 'USD'), money(1, 'LBP'))).toThrow();
    expect(() => money(1.5, 'USD')).toThrow();
  });
  it('applies basis points with half-up rounding', () => {
    expect(applyBps(money(10000, 'USD'), 700).minor).toBe(700n);
    expect(applyBps(money(105, 'USD'), 1000).minor).toBe(11n);
    expect(applyBps(money(104, 'USD'), 1000).minor).toBe(10n);
  });
});
