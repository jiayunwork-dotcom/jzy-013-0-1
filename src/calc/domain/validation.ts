import { CircuitParams } from './types';

/** Machine-readable codes used in error responses. */
export type FieldErrorCode =
  | 'MISSING_FIELD'
  | 'NOT_A_NUMBER'
  | 'NOT_FINITE'
  | 'OUT_OF_RANGE'
  | 'NOT_AN_OBJECT';

export interface FieldError {
  field: string;
  code: FieldErrorCode;
  message: string;
}

/** Canonical ordering and human descriptions of every accepted input field. */
const FIELD_LABELS: Record<string, string> = {
  inputVoltage: 'input voltage (V)',
  dutyCycle: 'duty cycle',
  inductance: 'inductance (H)',
  capacitance: 'capacitance (F)',
  switchPeriod: 'switch period (s)',
  loadResistance: 'load resistance (ohm)',
  esr: 'capacitor ESR (ohm)',
};

/** Strictly-positive fields. */
const STRICTLY_POSITIVE = new Set([
  'inputVoltage',
  'inductance',
  'capacitance',
  'switchPeriod',
  'loadResistance',
]);

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Validate one set of circuit parameters.
 *
 * @param index optional 0-based position inside a batch (used in messages).
 * @returns a list of field errors; empty means the input is usable.
 */
export function validateParams(
  raw: unknown,
  index?: number,
): { errors: FieldError[]; params?: CircuitParams } {
  const prefix =
    typeof index === 'number' ? `item ${index + 1}: ` : '';
  const label = (field: string) => `${prefix}${FIELD_LABELS[field] ?? field}`;

  if (!isPlainObject(raw)) {
    return {
      errors: [
        {
          field: '(body)',
          code: 'NOT_AN_OBJECT',
          message: `${prefix}request body must be a JSON object of circuit parameters`,
        },
      ],
    };
  }

  const obj = raw as Record<string, unknown>;
  const errors: FieldError[] = [];

  const checkNumber = (field: string): number | undefined => {
    const value = obj[field];
    if (value === undefined || value === null) {
      errors.push({
        field,
        code: 'MISSING_FIELD',
        message: `${label(field)} is required`,
      });
      return undefined;
    }
    if (typeof value !== 'number' || Number.isNaN(value)) {
      errors.push({
        field,
        code: 'NOT_A_NUMBER',
        message: `${label(field)} must be a number, got ${safeDescribe(value)}`,
      });
      return undefined;
    }
    if (!Number.isFinite(value)) {
      errors.push({
        field,
        code: 'NOT_FINITE',
        message: `${label(field)} must be a finite number, got ${value}`,
      });
      return undefined;
    }
    return value;
  };

  // Required numeric fields.
  const values: Partial<Record<string, number>> = {};
  for (const field of [
    'inputVoltage',
    'dutyCycle',
    'inductance',
    'capacitance',
    'switchPeriod',
    'loadResistance',
  ]) {
    const n = checkNumber(field);
    if (n !== undefined) values[field] = n;
  }

  // Range: duty cycle strictly inside the open interval (0, 1).
  if (values.dutyCycle !== undefined) {
    const d = values.dutyCycle;
    if (d <= 0 || d >= 1) {
      errors.push({
        field: 'dutyCycle',
        code: 'OUT_OF_RANGE',
        message: `${label(
          'dutyCycle',
        )} must be strictly inside the open interval (0, 1), got ${d}`,
      });
    }
  }

  // Range: strictly positive physical quantities.
  for (const field of STRICTLY_POSITIVE) {
    const n = values[field];
    if (n !== undefined && n <= 0) {
      errors.push({
        field,
        code: 'OUT_OF_RANGE',
        message: `${label(field)} must be > 0, got ${n}`,
      });
    }
  }

  // Optional ESR: when present must be a finite, non-negative number.
  let esr = 0;
  if (obj.esr !== undefined) {
    const n = checkNumber('esr');
    if (n !== undefined) {
      if (n < 0) {
        errors.push({
          field: 'esr',
          code: 'OUT_OF_RANGE',
          message: `${label('esr')} must be >= 0, got ${n}`,
        });
      } else {
        esr = n;
      }
    }
  }

  if (errors.length > 0) {
    return { errors };
  }

  const params: CircuitParams = {
    inputVoltage: values.inputVoltage!,
    dutyCycle: values.dutyCycle!,
    inductance: values.inductance!,
    capacitance: values.capacitance!,
    switchPeriod: values.switchPeriod!,
    loadResistance: values.loadResistance!,
    esr,
  };
  return { errors: [], params };
}

function safeDescribe(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return 'array';
  return String(value);
}
