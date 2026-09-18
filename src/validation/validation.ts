import { BuckCircuitInput } from '../buck/physics';

/** 单个字段的校验问题 */
export interface FieldError {
  field: string;
  message: string;
}

/** 电压/模式核算必填字段（纹波接口额外要求 c，esr 可选） */
export type FieldSpec = 'vin' | 'duty' | 'l' | 'c' | 'ts' | 'r' | 'esr';

const POSITIVE_FIELDS: ReadonlyArray<{ key: FieldSpec; label: string }> = [
  { key: 'vin', label: '输入电压 vin' },
  { key: 'l', label: '电感 l' },
  { key: 'c', label: '电容 c' },
  { key: 'ts', label: '开关周期 ts' },
  { key: 'r', label: '负载电阻 r' },
];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 校验一组电路参数。requireC=false 用于模式/电压接口（该接口本身不需要电容），
 * 但本服务对外统一要求提供 c（纹波与完整核算都依赖它），默认全部必填。
 */
export function validateCircuitInput(
  raw: unknown,
  options: { requireCapacitance?: boolean } = {},
): { ok: true; value: BuckCircuitInput; errors: FieldError[] } | { ok: false; value: null; errors: FieldError[] } {
  const requireCapacitance = options.requireCapacitance ?? true;
  const errors: FieldError[] = [];

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      value: null,
      errors: [{ field: '(body)', message: '请求体必须是包含电路参数的 JSON 对象' }],
    };
  }

  const obj = raw as Record<string, unknown>;

  for (const { key, label } of POSITIVE_FIELDS) {
    if (key === 'c' && !requireCapacitance) {
      continue;
    }
    const v = obj[key];
    if (v === undefined || v === null) {
      errors.push({ field: key, message: `缺少字段：${label}（${key}）` });
      continue;
    }
    if (!isFiniteNumber(v)) {
      errors.push({ field: key, message: `${label}（${key}）必须是有限数值，收到：${describe(v)}` });
      continue;
    }
    if (v <= 0) {
      errors.push({ field: key, message: `${label}（${key}）必须严格为正，收到：${v}` });
    }
  }

  // 占空比必须落在开区间 (0, 1)
  const duty = obj.duty;
  if (duty === undefined || duty === null) {
    errors.push({ field: 'duty', message: '缺少字段：占空比 duty' });
  } else if (!isFiniteNumber(duty)) {
    errors.push({ field: 'duty', message: `占空比 duty 必须是有限数值，收到：${describe(duty)}` });
  } else if (duty <= 0 || duty >= 1) {
    errors.push({ field: 'duty', message: `占空比 duty 必须落在开区间 (0, 1) 内，收到：${duty}` });
  }

  // 可选 ESR：缺省为 0；给出则必须是非负有限数
  const esr = obj.esr;
  if (esr !== undefined && esr !== null) {
    if (!isFiniteNumber(esr)) {
      errors.push({ field: 'esr', message: `电容串联电阻 esr 必须是有限数值，收到：${describe(esr)}` });
    } else if (esr < 0) {
      errors.push({ field: 'esr', message: `电容串联电阻 esr 不能为负，收到：${esr}` });
    }
  }

  if (errors.length > 0) {
    return { ok: false, value: null, errors };
  }

  const value: BuckCircuitInput = {
    vin: obj.vin as number,
    duty: obj.duty as number,
    l: obj.l as number,
    c: (requireCapacitance ? obj.c : obj.c ?? 0) as number,
    ts: obj.ts as number,
    r: obj.r as number,
    esr: typeof obj.esr === 'number' ? (obj.esr as number) : 0,
  };
  return { ok: true, value, errors: [] };
}

/** 批量请求体外层校验 */
export function validateBatchEnvelope(raw: unknown): { items: unknown[] } | { error: FieldError } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: { field: '(body)', message: '请求体必须是形如 { "items": [...] } 的 JSON 对象' } };
  }
  const items = (raw as Record<string, unknown>).items;
  if (!Array.isArray(items)) {
    return { error: { field: 'items', message: '缺少字段或类型错误：items 必须是电路参数对象数组' } };
  }
  if (items.length === 0) {
    return { error: { field: 'items', message: 'items 至少要包含一组电路参数' } };
  }
  if (items.length > 200) {
    return { error: { field: 'items', message: '单次批量核算最多 200 组参数' } };
  }
  return { items };
}

/** 历史查询参数校验（分页与模式过滤） */
export function validateHistoryQuery(query: Record<string, unknown>): {
  errors: FieldError[];
  mode?: 'CCM' | 'DCM';
  success?: boolean;
  requestType?: string;
  limit: number;
  offset: number;
} {
  const errors: FieldError[] = [];
  let mode: 'CCM' | 'DCM' | undefined;
  let success: boolean | undefined;
  let requestType: string | undefined;

  if (query.mode !== undefined) {
    if (query.mode === 'CCM' || query.mode === 'DCM') {
      mode = query.mode;
    } else {
      errors.push({ field: 'mode', message: 'mode 只允许取 CCM 或 DCM' });
    }
  }
  if (query.success !== undefined) {
    if (query.success === 'true') {
      success = true;
    } else if (query.success === 'false') {
      success = false;
    } else {
      errors.push({ field: 'success', message: 'success 只允许取 true 或 false' });
    }
  }
  if (query.requestType !== undefined && query.requestType !== '') {
    if (['single', 'ripple', 'batch'].includes(query.requestType as string)) {
      requestType = query.requestType as string;
    } else {
      errors.push({ field: 'requestType', message: 'requestType 只允许取 single / ripple / batch' });
    }
  }

  let limit = 50;
  let offset = 0;
  if (query.limit !== undefined) {
    const n = Number(query.limit);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0 || n > 200) {
      errors.push({ field: 'limit', message: 'limit 必须是 1~200 之间的整数' });
    } else {
      limit = n;
    }
  }
  if (query.offset !== undefined) {
    const n = Number(query.offset);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      errors.push({ field: 'offset', message: 'offset 必须是非负整数' });
    } else {
      offset = n;
    }
  }

  return { errors, mode, success, requestType, limit, offset };
}

function describe(v: unknown): string {
  if (typeof v === 'string') {
    return `字符串 "${v.length > 20 ? v.slice(0, 20) + '…' : v}"`;
  }
  if (v === null) {
    return 'null';
  }
  if (Array.isArray(v)) {
    return '数组';
  }
  return String(v);
}
