# Buck 降压变换器平均模型核算服务

可独立部署的纯服务端电力电子计算组件：上游提交输入电压、占空比、电感、电容、开关周期与负载电阻，
服务判定 **CCM（连续导通）/ DCM（断续导通）**，给出输出电压、模式边界、电感电流纹波、电容电压纹波，
支持批量核算与历史持久化查询。基于 **TypeScript + NestJS + TypeORM + PostgreSQL**，
Docker Compose 一键启动服务及其数据库依赖。

> 本组件只做平均模型核算，不涉及商城、前端页面或账户体系。

## 关于临界条件的一个重要说明

题目散文中写“占空比越大越容易进入断续”，这与标准 Buck 平均模型的结论相反，
且与题目要求的全部数值不变量（DCM 输出高于 `D·Vin`、减小电感翻 DCM、伏秒闭合、各项加倍测试）冲突。
标准模型给出：

- 无量纲参数 **K = 2L/(R·Ts)**，临界值 **Kcrit = 1 − D**；
- `K > Kcrit` 为 CCM，`K < Kcrit` 为 DCM，`K = Kcrit` 为边界；
- D 越大 Kcrit 越小，即**占空比越大越不容易进入断续**
  （导通伏秒增大 → 电感电流谷值抬高）。

本服务按标准模型实现，`GET /config` 会显式回显全部公式与容差以便审计。

## 平均模型

### 模式与电压

| 模式 | 判定 | 输出电压 |
|---|---|---|
| CCM | K ≥ 1−D | **Vo = D·Vin**（理想开关伏秒平衡） |
| DCM | K < 1−D | 解 **K·M² = D²(1−M)**，M = Vo/Vin = 2 / (1 + √(1 + 4K/D²))，严格 M > D |

DCM 三段时间：开关导通 D、二极管续流 **D2 = D(1−M)/M**、电感电流为零的空闲段 **D3 = 1 − D − D2**。

模式边界：Lcrit = (1−D)·R·Ts/2（电感低于它进入 DCM）；Rcrit = 2L/((1−D)·Ts)（电阻大于它即轻载进入 DCM）。

每次核算都把输出代回平衡关系做闭合校验（容差 1e-9）：

- CCM：伏秒平衡 `D·Vin − Vo` 归一化残差；
- DCM：伏秒平衡（两段之和）+ **安秒/电荷平衡** `ip(D+D2)/2 = Vo/R` 归一化残差。

### 纹波

- 电感电流峰峰值：**ΔiL = (Vin − Vo)·D·Ts / L**（CCM 为纹波；DCM 下即电感峰值，谷值为 0）。
- CCM 电容电压纹波（ESR=0，三角波对电容精确积分）：**ΔvC = ΔiL·Ts/(8C)**。
- DCM 电容电压纹波（ESR=0）：`ΔvC = (ip − Io)²·(D + D2)·Ts / (2·ip·C)`，Io = Vo/R。
- 给出电容串联电阻 Rc 时叠加：**Δv_esr = ΔiL·Rc**，总纹波 `Δvo = ΔvC + Δv_esr`。
- CCM 与 DCM 各走各的电压与纹波关系，模式判定与公式严格一致。

## 目录结构（按职责拆分）

```
src/
  buck/physics/        纯物理计算层（不依赖框架/数据库，可独立单测）
    types.ts           输入输出类型
    constants.ts       容差配置
    mode.ts            K、Kcrit、模式判定与边界
    voltage.ts         CCM/DCM 平均电压、伏秒与安秒闭合校验
    ripple.ts          电感电流纹波、电容电压纹波、ESR 叠加
  validation/          逐字段输入校验（缺字段/非数值/非有限/越界/激零）
  calculation/         核算服务、HTTP 控制器、DTO、预置算例
  history/             TypeORM 实体 + 持久化/条件查询服务
  health/              运行状态与存活探针
  config/              数据库配置
  common/              全局异常过滤器（不裸奔、不崩进程）
test/app.spec.ts       HTTP 端到端测试（内存 SQLite）
```

## 一键启动（Docker Compose）

```bash
docker compose up --build
# API: http://localhost:3000   PostgreSQL: localhost:5432
```

## 本地开发 / 测试

```bash
npm install
npm test            # 单元 + e2e（测试使用内存 SQLite，零外部依赖）
npm run build       # 产物在 dist/
DB_TYPE=sqljs npm run start:prod   # 免数据库本地试跑（内存 SQLite，重启数据清空）
# 或对接本地 PostgreSQL：
DB_TYPE=postgres PG_HOST=localhost npm run start:prod
```

环境变量：`PORT`（默认 3000）、`DB_TYPE`（`postgres` 默认 / `sqljs`）、
`PG_HOST` `PG_PORT` `PG_USER` `PG_PASSWORD` `PG_DATABASE`、`DB_SYNCHRONIZE`（默认 true 自动建表）。

## HTTP 接口

所有核算接口（成功/失败）都会持久化一条历史记录。POST 返回 200；参数非法返回 400 与逐字段可读错误。

### `POST /calculate` — 模式与输出电压

```bash
curl -X POST localhost:3000/calculate -H 'Content-Type: application/json' -d '{
  "vin": 12, "duty": 0.4166666666666667,
  "l": 0.00006, "c": 0.00005, "ts": 0.00001, "r": 2
}'
```

响应（节选）：`mode=CCM`、`outputVoltage=5`、`boundary.{k,kCritical,criticalInductance,criticalResistance}`、
`voltSecondResidual=0`、`voltSecondClosed=true`。

### `POST /ripple` — 纹波（可选 `esr`）

```bash
curl -X POST localhost:3000/ripple -H 'Content-Type: application/json' -d '{
  "vin": 12, "duty": 0.4166666666666667,
  "l": 0.00006, "c": 0.00005, "ts": 0.00001, "r": 2, "esr": 0.01
}'
```

返回 `inductorCurrentRipple`、`capacitorVoltageRipple`、`esrVoltageRipple`、`outputVoltageRipple`。

### `POST /batch` — 批量核算

请求体 `{ "items": [ {...}, {...} ] }`（最多 200 组）。某组非法时只该组 `ok:false`，
响应指出 `index`（从 1 开始）与具体字段错误，其余各组照常返回；全批共享一个 `batchId`，每组各写一条历史。

### `GET /history` — 历史查询

查询参数：`mode=CCM|DCM`、`success=true|false`、`requestType=single|ripple|batch`、
`batchId=<uuid>`、`limit`（1~200，默认 50）、`offset`。

### `GET /config` — 回显临界公式与容差配置

### `GET /example` — 预置算例

12V 输入、D=5/12、L=60µH、C=50µF、Ts=10µs、R=2Ω：判 CCM，Vo = 5V（K=6 ≫ Kcrit≈0.583）。

### `GET /health` 与 `GET /health/live`

供监控采集：状态、运行时长、数据库连通性、时间戳；数据库不可用时返回 503。

## 输入规则与错误

- `duty` 必须在开区间 **(0, 1)** 内（0 与 1 都拒绝）；
- `vin / l / c / ts / r` 必须是严格为正的有限数；
- 可选 `esr` 必须是非负有限数；
- 缺字段、字符串、`null`、`NaN`、`Infinity` 都返回 400 与逐字段中文说明，不会算出“看似正常”的错误结果；
- 非法 JSON、未知内部错误由全局过滤器统一兜底，进程不崩溃。

## 并发正确性

物理核算是只依赖入参的纯函数，无共享可变状态；每次请求独立建结果对象。
持久化逐请求/逐组落库（批量每组独立成行并带 `batchId` + `batchIndex`）。
e2e 中以 40 个并发不同参数请求验证响应各自对应、历史无串扰（`test/app.spec.ts`）。

## 已覆盖的自动化测试（31 个）

- CCM 输出 = D·Vin、伏秒钉死闭合；边界 K=Kcrit 连续；
- 电感减小到 Lcrit 以下翻 DCM 且输出 > D·Vin，伏秒与安秒均闭合；
- DCM 解析解与教科书数值一致（D=0.3, K=0.02 → M≈0.8423）；
- 占空比加倍（仍 CCM）输出加倍；开关周期加倍电流纹波加倍；输入加倍输出与纹波同比放大；
- CCM/DCM 电容纹波公式、ESR 叠加；
- 占空比越界、缺字段、非数值/非有限、激零、负 ESR 全部被拒；
- 批量部分失败指出组号与字段、其余成功；
- 成功/失败历史持久化与条件查询；
- 40 并发请求结果与历史互不串扰；健康检查、配置回显、预置算例。
