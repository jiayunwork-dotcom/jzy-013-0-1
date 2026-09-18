import { validateBatchEnvelope, validateCircuitInput, validateHistoryQuery } from './validation';

describe('输入校验', () => {
  const good = { vin: 12, duty: 0.5, l: 1e-5, c: 1e-5, ts: 1e-5, r: 2 };

  test('合法参数通过，esr 缺省为 0', () => {
    const r = validateCircuitInput(good);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.esr).toBe(0);
    }
  });

  test('缺字段逐字段报错', () => {
    const r = validateCircuitInput({ vin: 12, duty: 0.5 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const fields = r.errors.map((e) => e.field);
      expect(fields).toEqual(expect.arrayContaining(['l', 'c', 'ts', 'r']));
      expect(r.errors[0].message).toMatch(/缺少字段/);
    }
  });

  test('非数值 / 非有限值被拒', () => {
    const r = validateCircuitInput({ ...good, vin: 'abc', l: Number.NaN, c: Number.POSITIVE_INFINITY });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.field)).toEqual(expect.arrayContaining(['vin', 'l', 'c']));
    }
  });

  test('占空比越界（0、1、负数、>1）被拒', () => {
    for (const duty of [0, 1, -0.1, 1.2]) {
      const r = validateCircuitInput({ ...good, duty });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors.find((e) => e.field === 'duty')?.message).toMatch(/\(0, 1\)/);
      }
    }
  });

  test('电感、周期、电阻、电容激零或为负被拒', () => {
    for (const field of ['l', 'c', 'ts', 'r', 'vin'] as const) {
      const r = validateCircuitInput({ ...good, [field]: 0 });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors.some((e) => e.field === field)).toBe(true);
      }
    }
  });

  test('esr 为负被拒，非数值被拒', () => {
    expect(validateCircuitInput({ ...good, esr: -1 }).ok).toBe(false);
    expect(validateCircuitInput({ ...good, esr: 'x' }).ok).toBe(false);
  });

  test('请求体不是对象时给出可读错误', () => {
    expect(validateCircuitInput(null).ok).toBe(false);
    expect(validateCircuitInput([1, 2]).ok).toBe(false);
    expect(validateCircuitInput('string').ok).toBe(false);
  });

  test('批量外层：缺 items、空数组、超量都被拒', () => {
    expect(validateBatchEnvelope({})).toHaveProperty('error');
    expect(validateBatchEnvelope({ items: [] })).toHaveProperty('error');
    expect(validateBatchEnvelope({ items: 'x' })).toHaveProperty('error');
    const ok = validateBatchEnvelope({ items: [good] });
    expect(ok).toEqual({ items: [good] });
  });

  test('历史查询参数校验', () => {
    expect(validateHistoryQuery({ mode: 'CCM', limit: '10', offset: '0' }).errors).toEqual([]);
    expect(validateHistoryQuery({ mode: 'BOGUS' }).errors.length).toBeGreaterThan(0);
    expect(validateHistoryQuery({ limit: '0' }).errors.length).toBeGreaterThan(0);
    expect(validateHistoryQuery({ offset: '-1' }).errors.length).toBeGreaterThan(0);
  });
});
