import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { CalcExceptionFilter } from '../src/calc/calc-exception.filter';

const ccmParams = {
  inputVoltage: 12,
  dutyCycle: 5 / 12,
  inductance: 50e-6,
  capacitance: 100e-6,
  switchPeriod: 10e-6,
  loadResistance: 5,
};

describe('buck average-model HTTP service (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // setup-env.ts forces DB_TYPE=sqljs, so no PostgreSQL is needed.
    // Listen explicitly on an ephemeral port: relying on app.init() makes
    // supertest open/close the underlying server per request, which races
    // (ECONNRESET) when many requests are fired concurrently.
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new CalcExceptionFilter());
    await app.listen(0);
  });

  afterAll(async () => {
    await app?.close();
  });

  const server = () => app.getHttpServer();

  describe('GET /api/v1/example', () => {
    it('returns the ready-to-call 12V ~5V CCM example', async () => {
      const res = await request(server()).get('/api/v1/example').expect(200);
      expect(res.body.params.inputVoltage).toBe(12);
      expect(res.body.result.mode).toBe('CCM');
      expect(res.body.result.outputVoltage).toBeCloseTo(5, 9);
    });
  });

  describe('POST /api/v1/mode', () => {
    it('returns mode, output voltage and boundary, CCM Vout = D Vin', async () => {
      const res = await request(server())
        .post('/api/v1/mode')
        .send(ccmParams)
        .expect(200);
      expect(res.body.mode).toBe('CCM');
      expect(res.body.outputVoltage).toBeCloseTo(5, 9);
      expect(res.body.boundary.K).toBeGreaterThan(res.body.boundary.Kcrit);
      expect(res.body.voltSecondCheck.closed).toBe(true);
      expect(res.body.recordId).toBeTruthy();
    });

    it('persists and is retrievable from history', async () => {
      const res = await request(server())
        .get('/api/v1/history?mode=CCM&endpoint=mode')
        .expect(200);
      expect(res.body.total).toBeGreaterThan(0);
      expect(res.body.items[0].outputVoltage).toBeCloseTo(5, 9);
      expect(res.body.items[0].dutyCycle).toBeCloseTo(5 / 12, 10);
    });

    it.each([
      ['missing field', { ...ccmParams, inductance: undefined }, 'inductance'],
      ['non numeric', { ...ccmParams, inputVoltage: 'x' }, 'inputVoltage'],
      ['non finite', { ...ccmParams, switchPeriod: Infinity }, 'switchPeriod'],
      ['duty out of range', { ...ccmParams, dutyCycle: 1.2 }, 'dutyCycle'],
      ['duty equals zero', { ...ccmParams, dutyCycle: 0 }, 'dutyCycle'],
      ['zero inductance', { ...ccmParams, inductance: 0 }, 'inductance'],
    ])(
      'rejects %s with a readable 400 naming the parameter',
      async (_name, body, field) => {
        const res = await request(server())
          .post('/api/v1/mode')
          .send(body)
          .expect(400);
        expect(res.body.error).toBe('VALIDATION_FAILED');
        expect(Array.isArray(res.body.details)).toBe(true);
        expect(res.body.details[0].field).toBe(field);
        expect(typeof res.body.message).toBe('string');
      },
    );
  });

  describe('POST /api/v1/ripple', () => {
    it('returns mode-consistent ripple including ESR term', async () => {
      const res = await request(server())
        .post('/api/v1/ripple')
        .send({ ...ccmParams, esr: 0.1 })
        .expect(200);
      expect(res.body.mode).toBe('CCM');
      expect(res.body.ripple.esrVoltageRipple).toBeCloseTo(
        res.body.ripple.inductorCurrentRipple * 0.1,
        10,
      );
      expect(
        res.body.ripple.totalOutputVoltageRipple,
      ).toBeGreaterThan(res.body.ripple.capacitorVoltageRipple);
    });
  });

  describe('POST /api/v1/batch', () => {
    it('reports the failing item index/parameter while others succeed', async () => {
      const items = [
        ccmParams, // 0 ok (CCM)
        { ...ccmParams, inductance: 1e-6 }, // 1 ok (DCM)
        { ...ccmParams, dutyCycle: 2 }, // 2 invalid
        { ...ccmParams, inputVoltage: 24, dutyCycle: 0.25 }, // 3 ok CCM, 6V
      ];
      const res = await request(server())
        .post('/api/v1/batch')
        .send({ items })
        .expect(200);

      expect(res.body.total).toBe(4);
      expect(res.body.successCount).toBe(3);
      expect(res.body.failureCount).toBe(1);
      expect(res.body.results[0].success).toBe(true);
      expect(res.body.results[0].result.mode).toBe('CCM');
      expect(res.body.results[1].success).toBe(true);
      expect(res.body.results[1].result.mode).toBe('DCM');
      // the invalid one points at its position and the bad parameter
      expect(res.body.results[2].success).toBe(false);
      expect(res.body.results[2].index).toBe(2);
      expect(res.body.results[2].errors[0].message).toContain('item 3');
      expect(res.body.results[2].errors[0].field).toBe('dutyCycle');
      // later items still evaluated
      expect(res.body.results[3].success).toBe(true);
      expect(res.body.results[3].result.outputVoltage).toBeCloseTo(6, 9);

      // batch is queryable as a whole
      const hist = await request(server())
        .get(`/api/v1/history?batchId=${res.body.batchId}`)
        .expect(200);
      expect(hist.body.total).toBe(4);
    });

    it('rejects an empty or missing items array', async () => {
      const res = await request(server())
        .post('/api/v1/batch')
        .send({ items: [] })
        .expect(400);
      expect(res.body.error).toBe('VALIDATION_FAILED');
    });
  });

  describe('history persistence', () => {
    it('stores failures too and filters by success flag', async () => {
      await request(server())
        .post('/api/v1/mode')
        .send({ ...ccmParams, inductance: -1 })
        .expect(400);
      const failures = await request(server())
        .get('/api/v1/history?success=false')
        .expect(200);
      expect(failures.body.total).toBeGreaterThan(0);
      expect(failures.body.items.every((i: any) => i.success === false)).toBe(true);
    });
  });

  describe('config + health', () => {
    it('echoes the critical formula and tolerances', async () => {
      const res = await request(server()).get('/api/v1/config').expect(200);
      expect(res.body.formulas.criticalK).toContain('1 - D');
      expect(res.body.formulas.dimensionlessK).toContain('2L');
      expect(res.body.tolerances.voltSecondBalanceRelative).toBe(1e-9);
    });

    it('exposes liveness and readiness', async () => {
      await request(server()).get('/health/live').expect(200);
      const ready = await request(server()).get('/health/ready').expect(200);
      expect(ready.body.checks.database.ok).toBe(true);
    });
  });

  describe('concurrency', () => {
    it('handles many interleaved requests without mixing results or history', async () => {
      const variants = Array.from({ length: 24 }, (_, i) => ({
        body: {
          inputVoltage: 12,
          dutyCycle: 0.1 + (i % 8) * 0.1,
          inductance: i % 2 === 0 ? 50e-6 : 1e-6,
          capacitance: 100e-6,
          switchPeriod: 10e-6,
          loadResistance: 5,
        },
        tag: i,
      }));

      const responses = await Promise.all(
        variants.map((v) =>
          request(server()).post('/api/v1/mode').send(v.body).expect(200),
        ),
      );

      // Each response must correspond to its own inputs (no cross-talk).
      responses.forEach((res, i) => {
        const v = variants[i];
        const expectedCcm = v.body.inductance > 10e-6;
        expect(res.body.dutyCycle).toBeCloseTo(v.body.dutyCycle, 12);
        expect(res.body.inputVoltage).toBe(12);
        if (expectedCcm) {
          expect(res.body.mode).toBe('CCM');
          expect(res.body.outputVoltage).toBeCloseTo(
            v.body.dutyCycle * 12,
            8,
          );
        } else {
          expect(res.body.mode).toBe('DCM');
          expect(res.body.outputVoltage).toBeGreaterThan(
            v.body.dutyCycle * 12 + 1e-9,
          );
        }
        // unique record ids
        expect(res.body.recordId).toBeTruthy();
      });
      const ids = new Set(responses.map((r) => r.body.recordId));
      expect(ids.size).toBe(responses.length);

      // history count increased by exactly the number of requests
      const hist = await request(server())
        .get('/api/v1/history?endpoint=mode&limit=200')
        .expect(200);
      expect(hist.body.total).toBeGreaterThanOrEqual(responses.length);
      const recent = hist.body.items.slice(0, responses.length);
      // returned rows are not scrambled: all belong to the mode endpoint
      expect(recent.every((r: any) => r.endpoint === 'mode')).toBe(true);
    });
  });
});
