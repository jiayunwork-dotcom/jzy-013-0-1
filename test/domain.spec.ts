import { evaluate } from '../src/calc/domain/engine';
import { validateParams } from '../src/calc/domain/validation';
import {
  criticalK,
  dimensionlessK,
} from '../src/calc/domain/mode';

const ccmParams = {
  inputVoltage: 12,
  dutyCycle: 5 / 12,
  inductance: 50e-6,
  capacitance: 100e-6,
  switchPeriod: 10e-6,
  loadResistance: 5,
};

function expectOk(raw: unknown) {
  const out = evaluate(raw);
  if (!out.ok) throw new Error('expected success, got ' + JSON.stringify(out.errors));
  return out.result;
}

describe('mode boundary geometry', () => {
  it('uses K = 2L/(R Ts) and Kcrit = 1 - D', () => {
    const K = dimensionlessK(ccmParams);
    expect(K).toBeCloseTo(2, 12);
    expect(criticalK(0.4)).toBeCloseTo(0.6, 15);
  });

  it('classifies the 12V -> 5V preset as continuous CCM', () => {
    const r = expectOk(ccmParams);
    expect(r.mode).toBe('CCM');
    // Vout = D Vin, within floating point tolerance.
    expect(r.outputVoltage).toBeCloseTo(5, 10);
    expect(r.ccmOutputVoltage).toBeCloseTo(5, 12);
    // CCM volt-second balance closes within the pinned tolerance.
    expect(r.voltSecondCheck.closed).toBe(true);
    expect(r.voltSecondCheck.relativeResidual).toBeLessThanOrEqual(1e-9);
  });
});

describe('CCM averaged output voltage', () => {
  it('equals duty cycle times input voltage', () => {
    for (const D of [0.1, 0.35, 0.5, 0.72, 0.9]) {
      const r = expectOk({ ...ccmParams, dutyCycle: D });
      expect(r.mode).toBe('CCM');
      expect(r.outputVoltage).toBeCloseTo(D * 12, 10);
    }
  });

  it('doubles the output when only the duty cycle is doubled (still CCM, below Vin)', () => {
    const d1 = 0.2;
    const d2 = 0.4;
    const a = expectOk({ ...ccmParams, dutyCycle: d1 });
    const b = expectOk({ ...ccmParams, dutyCycle: d2 });
    expect(a.mode).toBe('CCM');
    expect(b.mode).toBe('CCM');
    expect(b.outputVoltage).toBeLessThan(ccmParams.inputVoltage);
    expect(b.outputVoltage).toBeCloseTo(2 * a.outputVoltage, 10);
  });

  it('scales output and current ripple together when only Vin is doubled (still CCM)', () => {
    const a = expectOk(ccmParams);
    const b = expectOk({ ...ccmParams, inputVoltage: 24 });
    expect(a.mode).toBe('CCM');
    expect(b.mode).toBe('CCM');
    expect(b.outputVoltage).toBeCloseTo(2 * a.outputVoltage, 10);
    expect(b.ripple.inductorCurrentRipple).toBeCloseTo(
      2 * a.ripple.inductorCurrentRipple,
      10,
    );
    expect(b.ripple.capacitorVoltageRipple).toBeCloseTo(
      2 * a.ripple.capacitorVoltageRipple,
      10,
    );
  });
});

describe('CCM ripple', () => {
  it('inductor p-p ripple = (Vin - Vout) D Ts / L', () => {
    const r = expectOk(ccmParams);
    const expected =
      ((12 - 5) * (5 / 12) * 10e-6) / 50e-6;
    expect(r.ripple.inductorCurrentRipple).toBeCloseTo(expected, 12);
  });

  it('doubles inductor current ripple when only the switching period is doubled', () => {
    const a = expectOk(ccmParams);
    const b = expectOk({ ...ccmParams, switchPeriod: 20e-6 });
    expect(b.mode).toBe('CCM');
    expect(b.ripple.inductorCurrentRipple).toBeCloseTo(
      2 * a.ripple.inductorCurrentRipple,
      10,
    );
  });

  it('capacitor voltage ripple integrates the triangular current, zero ESR', () => {
    const r = expectOk(ccmParams);
    const dI = r.ripple.inductorCurrentRipple;
    const expectedDv = (dI * 10e-6) / 8 / 100e-6;
    expect(r.ripple.capacitorVoltageRipple).toBeCloseTo(expectedDv, 12);
    expect(r.ripple.esrVoltageRipple).toBe(0);
    expect(r.ripple.totalOutputVoltageRipple).toBeCloseTo(expectedDv, 12);
  });

  it('adds dI * ESR when a capacitor series resistance is supplied', () => {
    const r = expectOk({ ...ccmParams, esr: 0.05 });
    const dI = r.ripple.inductorCurrentRipple;
    expect(r.ripple.esrVoltageRipple).toBeCloseTo(dI * 0.05, 12);
    expect(r.ripple.totalOutputVoltageRipple).toBeCloseTo(
      r.ripple.capacitorVoltageRipple + dI * 0.05,
      12,
    );
  });
});

describe('DCM behaviour', () => {
  // Reducing ONLY the inductance below the boundary flips the mode to DCM.
  const smallL = { ...ccmParams, inductance: 1e-6 };

  it('flips to DCM when only L is reduced below the boundary', () => {
    const ccm = expectOk(ccmParams);
    expect(ccm.mode).toBe('CCM');
    // boundary inductance for this duty / R / Ts
    const Lcrit = ccm.boundary.criticalInductance;
    expect(ccmParams.inductance).toBeGreaterThan(Lcrit);
    expect(smallL.inductance).toBeLessThan(Lcrit);

    const dcm = expectOk(smallL);
    expect(dcm.mode).toBe('DCM');
    expect(dcm.boundary.K).toBeLessThan(dcm.boundary.Kcrit);
  });

  it('produces an output voltage strictly above the CCM prediction D * Vin', () => {
    const dcm = expectOk(smallL);
    const ccmPrediction = dcm.ccmOutputVoltage;
    expect(dcm.outputVoltage).toBeGreaterThan(ccmPrediction);
    expect(dcm.outputVoltage).toBeLessThanOrEqual(dcm.inputVoltage);
    expect(dcm.conversionRatio).toBeGreaterThan(dcm.dutyCycle);
  });

  it('DCM volt-second balance with the diode duty D2 closes', () => {
    const dcm = expectOk(smallL);
    expect(dcm.voltSecondCheck.closed).toBe(true);
    expect(dcm.diodeDutyFraction).toBeGreaterThan(0);
    expect(dcm.dutyCycle + dcm.diodeDutyFraction).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('uses DCM ripple equations (triangular waveform returning to zero)', () => {
    const dcm = expectOk(smallL);
    expect(dcm.ripple.valleyInductorCurrent).toBeCloseTo(0, 12);
    expect(dcm.ripple.peakInductorCurrent).toBeCloseTo(
      dcm.ripple.inductorCurrentRipple,
      12,
    );
    const ipkExpected =
      ((12 - dcm.outputVoltage) * (5 / 12) * 10e-6) / 1e-6;
    expect(dcm.ripple.peakInductorCurrent).toBeCloseTo(ipkExpected, 9);
  });

  it('is continuous with the CCM solution exactly at the boundary', () => {
    const ccm = expectOk(ccmParams);
    const Lcrit = ccm.boundary.criticalInductance;
    const boundary = expectOk({ ...ccmParams, inductance: Lcrit });
    expect(boundary.mode).toBe('BOUNDARY');
    expect(boundary.outputVoltage).toBeCloseTo(5, 9);
  });
});

describe('input validation', () => {
  it('reports a missing field with its name', () => {
    const { errors } = validateParams({ ...ccmParams, inductance: undefined });
    expect(errors.some((e) => e.field === 'inductance' && e.code === 'MISSING_FIELD')).toBe(true);
  });

  it('rejects non-numeric and non-finite values', () => {
    expect(
      validateParams({ ...ccmParams, inputVoltage: 'twelve' }).errors[0].code,
    ).toBe('NOT_A_NUMBER');
    expect(
      validateParams({ ...ccmParams, switchPeriod: Infinity }).errors[0].code,
    ).toBe('NOT_FINITE');
    expect(
      validateParams({ ...ccmParams, capacitance: -Infinity }).errors[0].code,
    ).toBe('NOT_FINITE');
    // NaN is of type number but not a usable number -> NOT_A_NUMBER
    expect(
      validateParams({ ...ccmParams, capacitance: NaN }).errors[0].code,
    ).toBe('NOT_A_NUMBER');
  });

  it.each([0, -0.5, 1, 2])(
    'rejects duty cycle outside the open interval (0,1): %s',
    (D) => {
      const { errors } = validateParams({ ...ccmParams, dutyCycle: D });
      expect(errors.some((e) => e.field === 'dutyCycle' && e.code === 'OUT_OF_RANGE')).toBe(true);
    },
  );

  it('rejects zero or negative inductance (激零防护)', () => {
    expect(
      validateParams({ ...ccmParams, inductance: 0 }).errors.some(
        (e) => e.field === 'inductance',
      ),
    ).toBe(true);
    expect(
      validateParams({ ...ccmParams, inductance: -1e-6 }).errors[0].code,
    ).toBe('OUT_OF_RANGE');
  });

  it('rejects non-object bodies', () => {
    expect(validateParams(null).errors[0].code).toBe('NOT_AN_OBJECT');
    expect(validateParams([1, 2]).errors[0].code).toBe('NOT_AN_OBJECT');
  });

  it('rejects a negative ESR but accepts ESR = 0', () => {
    expect(
      validateParams({ ...ccmParams, esr: -0.01 }).errors[0].code,
    ).toBe('OUT_OF_RANGE');
    expect(validateParams({ ...ccmParams, esr: 0 }).errors).toHaveLength(0);
  });
});
