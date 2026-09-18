import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AddressInfo } from 'net';
import request from 'supertest';
import { HistoryService } from '../src/history/history.service';

// 必须在 AppModule 被求值（require）前指定数据库后端为内存 SQLite
process.env.DB_TYPE = 'sqljs';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AppModule } = require('../src/app.module');

const ccmBody = { vin: 12, duty: 5 / 12, l: 60e-6, c: 50e-6, ts: 10e-6, r: 2 };

describe('Buck 核算服务 (HTTP e2e, sqljs)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    // 显式监听一个真实端口：supertest 拿到 URL 字符串后不会在请求间关闭 server，
    // 这样并发请求共享同一个监听中的 HTTP 服务。
    const server = app.getHttpServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  test('健康检查与存活探针', async () => {
    const res = await request(baseUrl).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database).toBe('up');
    await request(baseUrl).get('/health/live').expect(200);
  });

  test('配置接口回显临界公式与容差', async () => {
    const res = await request(baseUrl).get('/config').expect(200);
    expect(res.body.formulas.criticalK).toContain('1 - D');
    expect(res.body.tolerances.voltSecondTolerance).toBe(1e-9);
  });

  test('预置算例 /example 判 CCM 且输出接近 D·Vin≈5V', async () => {
    const res = await request(baseUrl).get('/example').expect(200);
    expect(res.body.result.voltage.mode).toBe('CCM');
    expect(res.body.result.voltage.outputVoltage).toBeCloseTo(5, 9);
  });

  test('POST /calculate：CCM 输出 = D·Vin', async () => {
    const res = await request(baseUrl).post('/calculate').send(ccmBody).expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.voltage.mode).toBe('CCM');
    expect(res.body.voltage.outputVoltage).toBeCloseTo(5, 9);
    expect(res.body.voltage.boundary.k).toBeGreaterThan(res.body.voltage.boundary.kCritical);
  });

  test('POST /calculate：电感过小翻 DCM 且输出高于 D·Vin', async () => {
    const body = { ...ccmBody, l: 1e-6 };
    const res = await request(baseUrl).post('/calculate').send(body).expect(200);
    expect(res.body.voltage.mode).toBe('DCM');
    expect(res.body.voltage.outputVoltage).toBeGreaterThan(body.duty * body.vin);
  });

  test('POST /calculate：占空比越界返回 400 且逐字段说明', async () => {
    const res = await request(baseUrl).post('/calculate').send({ ...ccmBody, duty: 1 }).expect(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.errors[0].field).toBe('duty');
    expect(res.body.message).toMatch(/校验失败/);
  });

  test('POST /calculate：缺字段 / 非数值 / 非有限值 / 电感激零返回 400', async () => {
    const missing = { vin: 12, duty: 0.5 };
    const r1 = await request(baseUrl).post('/calculate').send(missing).expect(400);
    expect(r1.body.errors.map((e: { field: string }) => e.field)).toEqual(
      expect.arrayContaining(['l', 'c', 'ts', 'r']),
    );

    const badTypes = { ...ccmBody, vin: '12V', l: null, ts: Number.NaN };
    const r2 = await request(baseUrl).post('/calculate').send(badTypes).expect(400);
    expect(r2.body.errors.map((e: { field: string }) => e.field)).toEqual(
      expect.arrayContaining(['vin', 'l', 'ts']),
    );

    const zeroL = await request(baseUrl).post('/calculate').send({ ...ccmBody, l: 0 }).expect(400);
    expect(zeroL.body.errors.some((e: { field: string }) => e.field === 'l')).toBe(true);

    // 非法 JSON 也不能让进程崩溃
    await request(baseUrl)
      .post('/calculate')
      .set('Content-Type', 'application/json')
      .send('{ broken json')
      .expect(400);
  });

  test('POST /ripple：CCM 周期加倍则电感纹波加倍；ESR 叠加', async () => {
    const r1 = await request(baseUrl).post('/ripple').send(ccmBody).expect(200);
    const r2 = await request(baseUrl)
      .post('/ripple')
      .send({ ...ccmBody, ts: ccmBody.ts * 2 })
      .expect(200);
    expect(r2.body.ripple.inductorCurrentRipple).toBeCloseTo(
      2 * r1.body.ripple.inductorCurrentRipple,
      9,
    );
    expect(r2.body.ripple.mode).toBe('CCM');

    const r3 = await request(baseUrl)
      .post('/ripple')
      .send({ ...ccmBody, esr: 0.02 })
      .expect(200);
    expect(r3.body.ripple.esrVoltageRipple).toBeCloseTo(r1.body.ripple.inductorCurrentRipple * 0.02, 9);
    expect(r3.body.ripple.outputVoltageRipple).toBeCloseTo(
      r3.body.ripple.capacitorVoltageRipple + r3.body.ripple.esrVoltageRipple,
      12,
    );
  });

  test('POST /batch：部分组非法时指出第几组、哪个参数，其余照常返回', async () => {
    const res = await request(baseUrl)
      .post('/batch')
      .send({
        items: [
          ccmBody, // 第1组合法 CCM
          { ...ccmBody, duty: 2 }, // 第2组占空比越界
          { ...ccmBody, l: 1e-6 }, // 第3组合法但 DCM
          { vin: 1 }, // 第4组缺字段
        ],
      })
      .expect(200);

    expect(res.body.successCount).toBe(2);
    expect(res.body.failureCount).toBe(2);
    expect(res.body.batchId).toBeTruthy();

    const [g1, g2, g3, g4] = res.body.results;
    expect(g1.ok).toBe(true);
    expect(g1.index).toBe(1);
    expect(g1.result.voltage.mode).toBe('CCM');

    expect(g2.ok).toBe(false);
    expect(g2.index).toBe(2);
    expect(g2.errors[0].field).toBe('duty');

    expect(g3.ok).toBe(true);
    expect(g3.index).toBe(3);
    expect(g3.result.voltage.mode).toBe('DCM');
    expect(g3.result.voltage.outputVoltage).toBeGreaterThan(ccmBody.duty * ccmBody.vin);

    expect(g4.ok).toBe(false);
    expect(g4.index).toBe(4);
    expect(g4.errors.map((e: { field: string }) => e.field)).toEqual(
      expect.arrayContaining(['duty', 'l', 'c', 'ts', 'r']),
    );
  });

  test('批量外层非法（items 为空）返回 400', async () => {
    const res = await request(baseUrl).post('/batch').send({ items: [] }).expect(400);
    expect(res.body.errors[0].field).toBe('items');
  });

  test('历史持久化：成功与失败请求都入库，可按条件查询', async () => {
    const history = app.get(HistoryService);
    const beforeCcm = await history.query({ mode: 'CCM', limit: 200, offset: 0 });
    expect(beforeCcm.items.length).toBeGreaterThan(0);
    expect(beforeCcm.items.every((r) => r.mode === 'CCM')).toBe(true);

    const failed = await history.query({ success: false, limit: 200, offset: 0 });
    expect(failed.items.length).toBeGreaterThan(0);
    expect(failed.items.every((r) => r.success === false)).toBe(true);

    const batch = await history.query({ requestType: 'batch', limit: 200, offset: 0 });
    // 上一用例的批量：4 组各一条
    expect(batch.items.length).toBe(4);
    const sameBatch = new Set(batch.items.map((r) => r.batchId));
    expect(sameBatch.size).toBe(1);
    expect(batch.items.every((r) => typeof r.batchIndex === 'number')).toBe(true);

    // HTTP 查询接口
    const res = await request(baseUrl)
      .get('/history?mode=DCM&requestType=single&limit=5')
      .expect(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items.every((r: { mode: string }) => r.mode === 'DCM')).toBe(true);
    expect(res.body.limit).toBe(5);

    const bad = await request(baseUrl).get('/history?mode=NOPE').expect(400);
    expect(bad.body.errors[0].field).toBe('mode');
  });

  test('并发多请求结果互不串扰、历史记录不错乱', async () => {
    // 40 个并发请求，参数两两不同；每个响应必须严格等于其自身输入对应的物理结果
    const variants = Array.from({ length: 40 }, (_, i) => ({
      tag: `c${i}`,
      body: {
        vin: 5 + i,
        duty: 0.1 + (i % 8) * 0.05,
        l: (i % 3 === 0 ? 1e-6 : 60e-6),
        c: 50e-6,
        ts: 10e-6,
        r: 1 + (i % 5),
      },
    }));

    const responses = await Promise.all(
      variants.map((v) => request(baseUrl).post('/calculate').send(v.body)),
    );

    responses.forEach((res, i) => {
      expect(res.status).toBe(200);
      const { body } = variants[i];
      const expectedCCM = body.duty * body.vin;
      if (res.body.voltage.mode === 'CCM') {
        expect(res.body.voltage.outputVoltage).toBeCloseTo(expectedCCM, 9);
      } else {
        expect(res.body.voltage.outputVoltage).toBeGreaterThan(expectedCCM);
      }
    });

    // 历史中这 40 条 single 记录的 input 必须各自对应，无串行
    const history = app.get(HistoryService);
    const records = await history.query({ requestType: 'single', limit: 200, offset: 0 });
    const recent = records.items.slice(0, 40);
    expect(recent.length).toBe(40);
    for (const v of variants) {
      expect(
        recent.some(
          (r) =>
            (r.input as { vin: number }).vin === v.body.vin &&
            (r.input as { duty: number }).duty === v.body.duty &&
            (r.input as { r: number }).r === v.body.r,
        ),
      ).toBe(true);
    }
  });
});
