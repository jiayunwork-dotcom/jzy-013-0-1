import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { CalcService, ValidationFailure } from './calc.service';
import { CalcConfigService } from './calc-config.service';
import { HistoryService } from '../persistence/history.service';

@Controller('api/v1')
export class CalcController {
  constructor(
    private readonly calc: CalcService,
    private readonly calcConfig: CalcConfigService,
    private readonly historyService: HistoryService,
  ) {}

  /** Mode detection + averaged output voltage (ripple included). */
  @Post('mode')
  @HttpCode(200)
  async mode(@Body() body: unknown) {
    const { recordId, result } = await this.calc.evaluateMode(body);
    return { recordId, ...result };
  }

  /** Mode-consistent inductor current and capacitor voltage ripple. */
  @Post('ripple')
  @HttpCode(200)
  async ripple(@Body() body: unknown) {
    const { recordId, result } = await this.calc.evaluateRipple(body);
    return {
      recordId,
      mode: result.mode,
      outputVoltage: result.outputVoltage,
      ripple: result.ripple,
      boundary: result.boundary,
    };
  }

  /** Evaluate many independent circuit parameter sets in one request. */
  @Post('batch')
  @HttpCode(200)
  batch(@Body() body: unknown) {
    return this.calc.evaluateBatch(body);
  }

  /** Persisted calculation history with optional filters. */
  @Get('history')
  async getHistory(@Query() query: Record<string, string | undefined>) {
    const success =
      query.success === undefined
        ? undefined
        : query.success === 'true'
          ? true
          : query.success === 'false'
            ? false
            : badQuery('success must be "true" or "false"');

    const limit = parseOptionalInt(query.limit, 'limit');
    const offset = parseOptionalInt(query.offset, 'offset');
    const from = checkDate(query.from, 'from');
    const to = checkDate(query.to, 'to');

    const { total, items } = await this.historyService.query({
      endpoint: query.endpoint,
      mode: query.mode ? String(query.mode).toUpperCase() : undefined,
      success,
      batchId: query.batchId,
      from,
      to,
      limit,
      offset,
    });
    return { total, count: items.length, items };
  }

  /** Echo the critical-boundary formulas and the pinned tolerances. */
  @Get('config')
  getConfig() {
    return this.calcConfig.echoConfig();
  }

  /** The ready-to-call 12 V -> ~5 V CCM example. */
  @Get('example')
  example() {
    return this.calc.example();
  }
}

function parseOptionalInt(raw: string | undefined, name: string): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) badQuery(`${name} must be a non-negative integer`);
  return n;
}

function checkDate(raw: string | undefined, name: string): string | undefined {
  if (raw === undefined) return undefined;
  if (Number.isNaN(new Date(raw).getTime())) badQuery(`${name} must be an ISO date string`);
  return raw;
}

function badQuery(message: string): never {
  throw new ValidationFailure([
    { field: '(query)', code: 'OUT_OF_RANGE', message },
  ]);
}
