/** 对外 DTO 仅用于描述请求形状；实际逐字段校验在 validation 模块完成 */

export class CircuitParamsDto {
  vin!: number;
  duty!: number;
  l!: number;
  c!: number;
  ts!: number;
  r!: number;
  esr?: number;
}

export class BatchDto {
  items!: CircuitParamsDto[];
}
