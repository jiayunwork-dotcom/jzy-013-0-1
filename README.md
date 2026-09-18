# 降压（Buck）变换器平均模型核算服务

一个**纯服务端**电力电子计算组件：上游提交输入电压、占空比、电感、电容、开关周期与负载电阻，
服务判定 **CCM（连续导通）/ DCM（断续导通）/ BOUNDARY（临界）**，返回平均输出电压、模式边界、
电感电流纹波与电容电压纹波，并把每次请求与结果持久化，支持历史条件查询。

不包含任何电源选型商城、前端页面或账户体系。

- 语言/框架：TypeScript + [NestJS](https://nestjs.io) 提供 HTTP 服务
- 持久化：PostgreSQL（生产 / Docker Compose），测试可切换到进程内 sql.js，无需外部数据库
- 部署：`docker compose up` 一键构建并启动服务与数据库

---

## 快速开始

### Docker Compose（推荐）

```bash
docker compose up --build
# API: http://localhost:3000
```

启动后：

```bash
curl http://localhost:3000/health/live
curl http://localhost:3000/api/v1/example     # 预置 12V -> ~5V 的 CCM 算例
```

### 本地运行（无数据库，用内存 sql.js）

```bash
npm ci
DB_TYPE=sqljs npm run start:prod
```

### 本地开发

```bash
npm run start:dev   # watch 模式
npm test            # 运行自动化测试（自动使用内存数据库）
npm run build       # 产物输出到 dist/
```

环境变量见 `.env.example`。核心项：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP 端口 |
| `DB_TYPE` | `postgres` | `postgres` 或 `sqljs`（无依赖本地/测试） |
| `DB_HOST/PORT/USER/PASSWORD/NAME` | `localhost…` | PostgreSQL 连接 |
| `DB_SYNCHRONIZE` | `true` | 自动建表（生产建议配合迁移关闭） |
| `VOLT_SECOND_TOL` | `1e-9` | CCM 伏秒平衡闭合的相对容差 |
| `BOUNDARY_TOL` | `1e-12` | K 与 Kcrit 判等的相对容差 |

---

## 平均模型

### 模式判定

无量纲参数

```
K = 2L / (R · Ts)
```

临界值（由电感电流谷值在开通瞬间恰好降到零、且 DCM 电压解在边界与 CCM 连续衔接导出）

```
Kcrit(D) = 1 - D

K > Kcrit -> CCM
K < Kcrit -> DCM
|K - Kcrit| <= tol -> BOUNDARY（按 CCM 公式计算，二者在边界相等）
```

> **关于题目文字的一处说明**：题面提到“占空比越大越容易进入断续”。对理想 Buck 严格推导得到的
> 临界值是 **Kcrit = 1 − D**，它随 D 增大而**减小**，即占空比越大越*容易维持连续导通*（关断时间
> 更短，电感电流来不及降到零）；只有 1−D 才能让 DCM 的输出电压解在边界与 `D·Vin` 连续衔接。
> 因此本服务采用物理自洽的 `1−D`，并在 `GET /api/v1/config` 中显式回显该公式与说明。
> 题目要求的全部行为不变量（减小 L 翻 DCM 且电压抬高、D 加倍 CCM 输出加倍、Ts 加倍纹波加倍、
> Vin 加倍输出与纹波同比放大）在此边界下均成立。

### 输出电压

- **CCM / 临界**：理想开关伏秒平衡 `Vout = D · Vin`
- **DCM**：由电感伏秒平衡 + 输出节点对电感电流的安秒平衡（三角波回零）：

```
M = Vout / Vin = 2D / (D + sqrt(D² + 4K))      （DCM 时 M > D，故 Vout > D·Vin）
D2 = D · (1 - M) / M                            （二极管续流占空比）
```

CCM 下把输出电压代回伏秒关系，`(Vin−Vout)·D·Ts` 与 `Vout·(1−D)·Ts` 必须在钉死容差
`VOLT_SECOND_TOL`（默认 1e-9，相对残差）内闭合，否则直接报错，绝不返回看似正常的数。

### 纹波

- **CCM**（梯形电感电流，峰峰 dI）：

```
dI = (Vin - Vout) · D · Ts / L
dQ = dI · Ts / 8                       （三角纹波对电容的半个周期积分）
dVc = dQ / C
dV_esr = dI · ESR                      （ESR 缺省为 0，给出时叠加）
Vout 纹波(峰峰) = dVc + dV_esr
```

- **DCM**（三角波自 0 升至 Ipk 再回 0）：

```
Ipk = (Vin - Vout) · D · Ts / L        （峰峰即 Ipk，谷值为 0）
dQ  = Ipk · Ts · D · (2M - D)² / (8 M³)
dVc = dQ / C
dV_esr = Ipk · ESR
```

在边界 M = D 处，DCM 的 `dQ` 严格退化为 `Ipk·Ts/8 = dI·Ts/8`，与 CCM 连续。

---

## HTTP 接口

所有接口前缀 `/api/v1`，请求/响应均为 JSON。

### `POST /mode` — 模式 + 平均输出电压（含纹波与边界）

请求体：

```json
{
  "inputVoltage": 12,
  "dutyCycle": 0.4166666667,
  "inductance": 0.00005,
  "capacitance": 0.0001,
  "switchPeriod": 0.00001,
  "loadResistance": 5,
  "esr": 0
}
```

`esr` 可选，缺省 0；其余必填。响应包含 `mode`、`outputVoltage`、`ccmOutputVoltage`、
`conversionRatio`、`diodeDutyFraction`、`averageInductorCurrent`、`boundary`（含 K、Kcrit、
临界电感/电阻/周期）、`voltSecondCheck`（on/off/residual/relativeResidual/closed）、`ripple`
与已持久化的 `recordId`。

### `POST /ripple` — 纹波核算

入参同上，返回 `mode`、`outputVoltage` 与模式一致的 `ripple`（电感电流峰峰、峰/谷电流、
电容电压纹波、ESR 压降、总纹波）。

### `POST /batch` — 批量核算

```json
{ "items": [ { ...一组电路参数... }, { ... } ] }
```

逐项独立计算。某组非法不会影响其余组：该组返回 `success:false`、`index`（0 基）与
`errors`，错误信息带 `item N`（1 基）前缀并指明参数；其余组照常返回结果。
整批（含失败项）在**单个数据库事务**中持久化，返回统一的 `batchId`。

### `GET /history` — 历史查询

可选查询参数：`endpoint`（mode/ripple/batch）、`mode`（CCM/DCM/BOUNDARY）、
`success`（true/false）、`batchId`、`from`、`to`（ISO 时间）、`limit`（≤200，默认 50）、
`offset`。返回 `{ total, count, items[] }`。成功与失败请求都会落库。

### `GET /config` — 回显临界公式与容差配置

返回 K、Kcrit、CCM/DCM 电压、纹波、ESR 公式，模式边界规则说明，以及当前容差与输入取值范围。

### `GET /example` — 预置可直接调用的算例

12 V 输入、5 V 量级输出（D=5/12, 100 kHz, L=50 µH, C=100 µF, R=5 Ω），判为 **CCM**，
`Vout = 5 V`，电感纹波 ≈ 0.583 A，电容纹波 ≈ 7.29 mV。

### 健康检查（供监控采集）

- `GET /health/live`：进程存活
- `GET /health/ready`：数据库可达（含 `SELECT 1` 延迟），不可达返回 503

### 错误格式

任何非法输入都返回 `400` 与可读、可机读的错误，**不会**算出错误数字，也不会使进程崩溃：

```json
{
  "error": "VALIDATION_FAILED",
  "message": "item 2: duty cycle must be strictly inside the open interval (0, 1), got 2",
  "details": [
    { "field": "dutyCycle", "code": "OUT_OF_RANGE", "message": "item 2: ..." }
  ]
}
```

校验覆盖：缺字段（`MISSING_FIELD`）、非数值（`NOT_A_NUMBER`）、NaN/±Infinity（`NOT_FINITE`/
`NOT_A_NUMBER`）、占空比越出开区间 `(0,1)`、电感等物理量 ≤ 0（`OUT_OF_RANGE`）、ESR < 0、
请求体不是对象或 JSON 语法错误。

---

## 代码结构

按职责拆分，模式判定 / 电压平均模型 / 纹波 / 输入校验 / 持久化互不混在同一文件：

```
src/
  calc/
    domain/
      constants.ts          # 容差、K 与 Kcrit 公式常量与边界说明
      types.ts              # 领域类型（入参、模式/纹波结果）
      validation.ts         # 纯输入校验（可读、带字段与错误码）
      mode.ts               # K、Kcrit、CCM/DCM/临界 判定与边界量
      voltage.ts            # CCM 与 DCM 平均输出电压、伏秒闭合校验
      ripple.ts             # CCM / DCM 电感电流与电容电压纹波
      engine.ts             # 组合校验+模式+电压+纹波的纯函数入口、预置算例
    calc-config.service.ts  # 容差配置与 /config 回显
    calc.service.ts         # 单次/批量编排 + 持久化（事务）
    calc.controller.ts      # mode / ripple / batch / history / config / example
    calc-exception.filter.ts# 统一可读错误信封（不崩溃、不返回误导数字）
    calc.module.ts
  persistence/
    entities/               # CalcRecord、BatchRecord（TypeORM 实体）
    history.service.ts      # 单次落库、批量事务、条件查询、SELECT 1
    data-source.ts          # Postgres / sql.js 连接配置
    persistence.module.ts
  health/                   # /health/live、/health/ready
  app.module.ts
  main.ts
test/
  domain.spec.ts            # 纯核算规则测试
  http.e2e-spec.ts          # HTTP + 持久化 + 批量 + 并发端到端测试
```

计算层（`src/calc/domain`）是无副作用纯函数：天然可重入，并发请求各自持有局部变量，互不串扰；
持久化通过单次插入与批量事务保证并发下历史记录不交错。

---

## 测试

```bash
npm test
```

覆盖（共 39 个用例，全部通过）：

- CCM 输出 `Vout = D·Vin`，且伏秒平衡在容差内闭合
- 仅减小电感至边界以下 → 模式翻为 DCM，且输出严格高于 `D·Vin`（不超过 Vin）
- 仅把占空比加倍且仍 CCM、未达 Vin → 输出加倍
- 仅把开关周期加倍 → CCM 电感电流纹波加倍
- 仅把输入电压加倍且仍 CCM → 输出电压与电流/电容纹波同比放大
- DCM 伏秒平衡（含 D2）闭合；DCM 三角波谷值为 0；边界处与 CCM 连续
- 电容纹波积分与 ESR 叠加
- 占空比越界、非数值/非有限值、缺字段、电感 ≤ 0、负 ESR、非对象体被拒
- 批量部分失败：指出第几组、哪个参数，其余组照常返回，整批可按 batchId 查询
- 历史持久化（成功与失败均落库、按条件过滤）
- 24 个不同参数请求并发：结果各自正确、recordId 唯一、历史归属不串扰
- `/config` 回显公式与容差，`/health/live|ready` 正常
