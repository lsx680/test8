# 在线考试系统（OES）测试报告

| 项目 | 内容 |
| --- | --- |
| 报告版本 | V1.1（缺陷修复后回归版） |
| 测试负责人 | 周敏（测试工程师）；何静（单元测试回归与断言补强） |
| 测试日期 | 2026-10-31（初测） / 2026-10-31（缺陷回归） |
| 被测版本 | 后端 V1.0（Express，含 BUG-1~BUG-5 修复）、前端 V1.0（React 18 + Vite 5） |
| 上游依据 | `docs/requirements/需求规格说明书.md`（53 REQ / 18 NFR）、`docs/requirements/用例图.puml`（41 用例）、`docs/design/api-contract.yaml`（102 operationId）、`docs/design/schema.sql`（31 表） |
| 测试工程 | 项目根 `tests/`（Jest 29.7.0 + Supertest 7.3.1，独立于 backend 源码） |
| 结论摘要 | 397 个用例**全部通过**（397/397，通过率 100%）；原 5 个缺陷用例已全部转绿；行/语句覆盖率 **84.80%**、分支 **70.62%**、函数 **85.83%**，满足 `lines ≥ 60%` 与整体 ≥70% 目标；**5 个缺陷（BUG-1~BUG-5）已修复并回归关闭**；新增 91 个不依赖数据库的定向单元用例（`tests/unit` 已达 15 文件 / 226 用例） |

---

## 1. 测试概述

### 1.1 测试范围

本次测试覆盖在线考试系统三条主业务链路与公共支撑能力：

| 范围 | 内容 | 关联需求 |
| --- | --- | --- |
| 认证与账号 | 注册、审批、登录、失败锁定、JWT 签发/校验、刷新令牌轮换与重放、改密/禁用后令牌失效、登出 | REQ-UAM-01~09 |
| 权限控制 | 接口级 RBAC（学生/教师/管理员）、数据权限（教师仅本人资源、学生仅本人答卷） | REQ-UAM-08、NFR-07 |
| 题库与题目 | 题库增改删、五种题型创建校验、查询/更新/版本留痕、删除保护（被引用 409）、批量导入导出、知识点维护 | REQ-QBM-01~07 |
| 试卷与组卷 | 手动/随机组卷、分值校验（422/409）、预览脱敏、锁定后禁止改结构、复制、删除保护 | REQ-PPM-01~07 |
| 在线答题（重点） | 开考资格与幂等、取题脱敏、答案 UPSERT/乐观锁、服务端计时、防作弊事件、交卷、重复交卷幂等、断线恢复、次数用尽、超时/窗口校验 | REQ-EXM-03~08/09 |
| 阅卷与复核 | 阅卷队列、人工评分区间校验、采分点合计校验、总分重算、重放判分、双评/仲裁接口存在性、成绩复核申诉 | REQ-MRK-02~07 |
| 成绩与统计 | 个人成绩、成绩发布/重复发布、成绩明细自洽、考试统计字段与数值、题目质量分析、知识点失分、趋势统计、导出 | REQ-STA-01~06、REQ-MRK-05 |
| 系统管理 | 系统参数（可编辑/不可编辑/越界）、审计日志查询/过滤/导出、公告、站内通知、健康检查、备份记录查询 | REQ-SYS-01~06 |
| 契约一致性 | `api-contract.yaml` 102 operationId ↔ 后端注册路由 ↔ 前端 11 个 API 模块 | NFR-16 |
| 非功能验证 | 安全（密码/脱敏/RBAC）、可靠性（幂等/恢复）、一致性（总分自洽） | NFR-06/07/08/11/13/18 |

**不在本次范围**：性能压测（k6/autocannon）、72 小时可用性监控、Lighthouse、多浏览器兼容矩阵、真实邮件/短信、支付/第三方集成。原因见 §11 风险。

### 1.2 测试目标

1. 验证 41 个用例（`用例图.puml`）中核心业务路径的正向与异常分支；
2. 验证关键约束：**考试进行中的取题响应绝不包含 `correctAnswer` / `analysis` / `scoringPoints`**；
3. 验证幂等与一致性：重复交卷分数一致、试卷总分=各题分值之和、答卷总分=各题得分之和；
4. 量化代码覆盖率并与 NFR-15 的 70% 整体目标比对；
5. 校验前后端与契约三方的接口一致性，输出缺失清单。

---

## 2. 测试环境与版本

| 项 | 实测值 | 说明 |
| --- | --- | --- |
| 操作系统 | Windows 11 Home China（win32） | 本机测试 |
| Node.js | v24.15.0 | 后端与测试运行时 |
| npm | 11.12.1 | — |
| MySQL | 9.1.0（127.0.0.1:3306） | 本机实例，**可用**；未使用 Docker |
| 测试库 | `exam_system_test` | 由 `tests/helpers/global-setup.js` 每次执行前 DROP/重建，并执行 `docs/design/schema.sql`（31 表 + 种子账号 admin / T2024001 / S2024001） |
| 开发库 | `oes` | 测试全程**未读写**，避免污染 |
| 后端框架 | Express 4.22.3 | `backend/node_modules/express` 实测版本 |
| 数据库驱动 | mysql2 3.24.6 | 参数化查询、连接池 |
| 鉴权 | jsonwebtoken（HS256）+ bcryptjs | — |
| 前端 | React 18.3.1 + Vite 5.4.21 + axios 1.21.0 + react-router-dom 6.30.6 + zustand 4.5.5 | — |
| 测试框架 | Jest 29.7.0（`coverageProvider: v8`） | `testEnvironment=node`、`maxWorkers=1` |
| HTTP 测试 | Supertest 7.3.1 | 直接驱动 Express app，无需监听端口 |
| 契约解析 | js-yaml 4.1.0 | 解析 OpenAPI 3.0.3 |
| 关键测试配置 | `BCRYPT_ROUNDS=4`、`RATE_LIMIT_MAX=10000`、`LOG_LEVEL=silent` | 仅测试进程生效；避免 bcrypt 拖慢、登录限流导致假失败、日志噪音 |

> 环境限制说明：本次未发现数据库不可用的降级场景，MySQL 连接正常，集成测试全部在真实 MySQL 上执行（非 mock 数据库），因此**不存在因环境导致的降级范围**。Docker 未使用。

---

## 3. 测试策略与工程结构

### 3.1 分层策略

| 层次 | 方法 | 数据来源 | 目的 |
| --- | --- | --- | --- |
| 单元测试 | Jest + Mock 数据访问层 | `jest.mock` 替换 models/db/configService | 聚焦纯业务逻辑与边界，不依赖数据库 |
| 集成测试 | Supertest + 真实 MySQL（测试库） | 全部数据经真实 HTTP 接口创建 | 验证路由→控制器→服务→模型→SQL 的完整链路 |
| 契约一致性 | YAML 解析 + Express 路由运行时反射 + 前端静态扫描 | `api-contract.yaml`、`app._router.stack`、`frontend/src/api/*.js` | 保证 102 端点三方一致 |
| 静态检查 | 源码正则扫描 | `frontend/src/api/` | 校验路径前缀、契约存在性、operationId 覆盖 |

### 3.2 工程结构

```
tests/
├── package.json                 # npm test / npm run coverage
├── jest.config.js               # rootDir=项目根、V8 覆盖率、lines≥60 阈值、maxWorkers=1
├── helpers/
│   ├── env.js                   # 读取 backend/.env，测试库名强制 exam_system_test
│   ├── setup-env.js             # 在加载 backend 前注入测试环境变量
│   ├── global-setup.js          # 重建测试库 + 执行 schema.sql + 应用账号授权
│   ├── global-teardown.js
│   ├── db.js                    # 测试侧直连（用于状态构造/断言）+ 关闭后端连接池
│   ├── api.js                   # Supertest 封装、登录、Bearer
│   └── fixtures.js              # 数据工厂：学生/教师/题库/题目/试卷/考试/开考
├── unit/                        # 15 个文件 / 226 用例（含 7 个缺陷定向单测文件）
├── integration/                 # 6 个文件 / 160 用例
└── contract/                    # 1 个文件 / 11 用例
```

### 3.3 数据隔离与可重复执行

- `globalSetup` 每次运行前重建 `exam_system_test` 并重放 `schema.sql`，保证基线数据一致；
- 测试文件内数据均带 `uniqueSuffix()`（时间戳 + 随机串），避免文件间主键/名称/邮箱冲突；
- `maxWorkers=1` 串行执行，规避共享库的并发写竞争；
- 每个集成文件 `afterAll` 关闭后端连接池与测试直连，保证进程正常退出；
- 对被测系统的副作用（如修改系统参数、改密、禁用账号）全部使用新建账号或 `try/finally` 还原，已消除顺序依赖（曾出现 `maxLoginFail` 污染导致锁定用例假失败，已通过复位机制修复）。

---

## 4. 测试用例矩阵

### 4.1 用例分布

| 类别 | 文件 | 用例数 | TC 编号前缀 | 主要关联需求 |
| --- | --- | ---: | --- | --- |
| 单元 | `unit/grader.test.js` | 32 | TC-GRD | REQ-MRK-01/02、REQ-EXM-08 |
| 单元 | `unit/utils.jwt.test.js` | 15 | TC-JWT | REQ-UAM-03/04、NFR-07 |
| 单元 | `unit/utils.password.test.js` | 11 | TC-PWD | REQ-UAM-05/07、NFR-06 |
| 单元 | `unit/utils.pagination.test.js` | 10 | TC-PAG | REQ-NFR-05（分页契约） |
| 单元 | `unit/utils.errors.test.js` | 13 | TC-ERR | REQ-NFR-11、设计文档 §5.2/§5.4 |
| 单元 | `unit/utils.mask.test.js` | 13 | TC-MSK | REQ-EXM-04、REQ-SYS-04、NFR-08 |
| 单元 | `unit/validators.test.js` | 15 | TC-VAL | REQ-QBM-01/02、REQ-PPM-03 |
| 单元 | `unit/auth.service.test.js` | 26 | TC-ASV | REQ-UAM-01/02/04/05/07、REQ-UAM-06（注册审核前置） |
| 单元 | `unit/config.service.test.js` | 32 | TC-CFG | REQ-SYS-01、NFR-18（**BUG-5**） |
| 单元 | `unit/question.import.test.js` | 17 | TC-QIM | REQ-QBM-05（**BUG-1**） |
| 单元 | `unit/grading.status.test.js` | 13 | TC-GST | REQ-MRK-06、REQ-STA-05、NFR-18（**BUG-2 / BUG-3**） |
| 单元 | `unit/grading.model.test.js` | 8 | TC-GMK | REQ-STA-05、NFR-18（**BUG-2** 统计口径） |
| 单元 | `unit/serializer.test.js` | 9 | TC-SER | 契约 integer、REQ-STA-02/05（**BUG-3**） |
| 单元 | `unit/user.model.test.js` | 5 | TC-UMD | REQ-UAM-06/09（**BUG-4** SQL 参数顺序） |
| 单元 | `unit/user.service.test.js` | 7 | TC-USV | REQ-UAM-06/09（**BUG-4** 服务层传参） |
| 集成 | `integration/auth.test.js` | 20 | TC-UAM | REQ-UAM-01~09 |
| 集成 | `integration/rbac.test.js` | 18 | TC-RBC | REQ-UAM-08、NFR-07 |
| 集成 | `integration/questions.test.js` | 26 | TC-QBM | REQ-QBM-01~07 |
| 集成 | `integration/papers.test.js` | 23 | TC-PPM | REQ-PPM-01~07、REQ-EXM-02 |
| 集成 | `integration/attempt-flow.test.js` | 38 | TC-EXM / TC-MRK / TC-STA | REQ-EXM-03~09、REQ-MRK-02~07、REQ-STA-01~03 |
| 集成 | `integration/system-audit.test.js` | 35 | TC-SYS / TC-UAM / TC-STA / TC-EXM | REQ-SYS-01~06、REQ-UAM-05/08/09、REQ-STA-04~06 |
| 契约 | `contract/contract.test.js` | 11 | TC-CTR | NFR-16、前后端契约 |
| **合计** | **22 个测试文件** | **397** | — | — |

### 4.2 关键用例矩阵（代表性）

| TC 编号 | 关联需求 | 用例描述 | 预期结果 | 实际结果 | 状态 |
| --- | --- | --- | --- | --- | --- |
| TC-GRD-001~005 | REQ-MRK-01 | 单选全对/错答/多答/空答/字符串答案 | 全对得满分，其余 0 分 | 符合预期 | 通过 |
| TC-GRD-010~017 | REQ-MRK-02 | 多选全对/乱序/漏选（两种策略）/错选/多选/空答/半分取整 | 按策略计分，半分保留 2 位小数 | 符合预期 | 通过 |
| TC-GRD-020~023 | REQ-MRK-01 | 判断正确/错误/中文「正确·错」/非法值 | 非法布尔值判错，不误判 | 符合预期 | 通过 |
| TC-GRD-030~037 | REQ-MRK-01 | 填空大小写/全角空格/空白差异/多空顺序/空数不符/无标准答案 | 归一化后比较，空数不符不得分，无答案转人工 | 符合预期 | 通过 |
| TC-GRD-040/041 | REQ-MRK-02 | 简答题、未知题型 | `needsManual=true`，不自动给分 | 符合预期 | 通过 |
| TC-JWT-004/005 | NFR-07 | 篡改令牌、错误密钥伪造令牌 | 401 / 90202 | 符合预期 | 通过 |
| TC-JWT-006~009 | REQ-UAM-04 | Access/Refresh 过期、类型混用 | 过期 90203/10109；类型隔离拒绝 | 符合预期 | 通过 |
| TC-PWD-001~003 | NFR-06 | 同密码两次哈希不同、正确/错误密码校验 | bcrypt 随机盐，校验正确 | 符合预期 | 通过 |
| TC-MSK-010~013 | REQ-EXM-04 | 学生取题投影、试卷预览投影 | 输出字段白名单，**不含** correctAnswer/analysis/scoringPoints | 符合预期 | 通过 |
| TC-MSK-020~024 | REQ-SYS-04 | 审计摘要脱敏、深度/长度截断 | 密码/令牌/答案替换 `***` | 符合预期 | 通过 |
| TC-VAL-003~009 | REQ-QBM-01/02 | 单选题答案数量/选项重复/判断题带选项/填空空答案/简答采分点超满分 | 20102 / 20103 / 20109 | 符合预期 | 通过 |
| TC-ASV-001~008 | REQ-UAM-01/02 | 登录成功、用户不存在、待审核、禁用、锁定期、失败累计、自动解锁 | 10101/10102/10103/10104，双令牌返回 | 符合预期 | 通过 |
| TC-ASV-020~024 | REQ-UAM-04 | 刷新成功轮换、记录不存在、重放吊销全部、过期 | 轮换成功；重放 10109 且吊销全量 | 符合预期 | 通过 |
| TC-ASV-030~034 | REQ-UAM-07 | 两次密码不一致、强度不足、旧密码错、改密成功、用户不存在 | 10107/10108；改密后 tokenVersion 自增 | 符合预期 | 通过 |
| TC-ASV-040~044 | REQ-UAM-05 | 用户名/邮箱重复、弱密码、班级不存在、注册成功 | 10105/10106/10107/90401；创建 pending 账号 | 符合预期 | 通过 |
| TC-UAM-001/002 | REQ-UAM-06 | 注册 pending 不可登录；用户名重复 | 201 + pending；403/10102；409/10105 | 符合预期 | 通过 |
| TC-UAM-012 | REQ-UAM-02 | 连续 5 次密码错误 | 423 / 10104，锁定期内正确密码仍拒绝 | 符合预期 | 通过 |
| TC-UAM-030/031 | REQ-UAM-04 | 刷新轮换；旧刷新令牌重放 | 新令牌可用；旧令牌 401/10109 | 符合预期 | 通过 |
| TC-UAM-040 | REQ-UAM-07 | 改密后旧 Access/Refresh Token | 401/90204；旧密码 401；新密码登录成功 | 符合预期 | 通过 |
| TC-UAM-050/051 | REQ-UAM-09 | 账号禁用后旧令牌；登出后刷新令牌 | 403/10103；401/10109 | 符合预期 | 通过 |
| TC-RBC-001~006 | NFR-07 | 学生访问题库/试卷/用户/成绩/阅卷/参数 | 全部 403/90301 | 符合预期 | 通过 |
| TC-RBC-010~017 | NFR-07 | 其他教师访问他人试卷/考试/题目/题库/成绩/统计 | 403/90302 或 30108；列表数据权限过滤 | 符合预期 | 通过 |
| TC-RBC-020/021 | REQ-EXM-10 | 学生 B 访问学生 A 的答卷/题目 | 403/40113 | 符合预期 | 通过 |
| TC-QBM-010/011 | REQ-QBM-01 | 五种题型创建（单选/多选/判断/填空/简答） | 201，答案与版本正确 | 符合预期 | 通过 |
| TC-QBM-012~016 | REQ-QBM-02 | 非法题型/答案数量/选项不足/采分点超分/题库不存在 | 422/400 对应业务码 | 符合预期 | 通过 |
| TC-QBM-022/023 | REQ-QBM-02 | 更新生成新版本；版本冲突 | 版本 +1；冲突 409/90409 | 符合预期 | 通过 |
| TC-QBM-030/031 | REQ-QBM-04 | 无引用题目删除；被试卷引用题目删除 | 200；409/20106 且返回引用清单 | 符合预期 | 通过 |
| TC-QBM-040 | REQ-QBM-05 | CSV 导入含 1 行空答案填空 | 2 成功 / 1 失败（rowNo=4） | 2 成功 / 1 失败，空答案行返回 20102 | 通过（BUG-1 已修复） |
| TC-QIM-001~005 | REQ-QBM-05 | 单测：CSV 空/undefined/null/空白答案归一化 | 归一为 `[]` 并计失败，产出中无 `"undefined"` | `successCount=2/failureCount=1`，rowNo=4 | 通过（BUG-1 定向单测） |
| TC-QBM-041/042 | REQ-QBM-06 | 导出 xlsx；上传 txt 拒绝 | xlsx 文件流；400/20104 | 符合预期 | 通过 |
| TC-PPM-001~005 | REQ-PPM-01/03 | 手动组卷、分值不符、空卷、重复题目、引用他人题库 | 201/422(30101)/422(90101)/409(30105)/403(30108) | 符合预期 | 通过 |
| TC-PPM-010~014 | REQ-PPM-02 | 随机组卷、题目不足、分值不符、难度占比非法、不落库预览 | 200/409(30107)/422(30101)/422(90101)/paperId=null | 符合预期 | 通过 |
| TC-PPM-020~022 | REQ-PPM-05 | 试卷详情/预览脱敏、列表分页 | 无 correctAnswer/analysis/scoringPoints | 符合预期 | 通过 |
| TC-PPM-030~037 | REQ-PPM-04/06 | 编辑、锁定后改分/加题、状态非法、复制、被考试引用删除、删除成功、越权删除 | 409(30103)/409(30106)/403(90302) 等 | 符合预期 | 通过 |
| TC-PPM-040/041 | REQ-EXM-02 | 归档卷建考试；未锁卷发布考试 | 409/30104；创建考试自动锁定，异常状态发布 409/40112 | 符合预期 | 通过 |
| TC-EXM-001~003 | REQ-EXM-03/04 | 开考返回会话；开考/取题响应脱敏 | 5 道题；字段白名单 9 个，无答案/解析/采分点 | 符合预期 | 通过 |
| TC-EXM-004~006 | REQ-EXM-03 | 重复开考幂等；非名单学生；教师开考 | 同一答卷；40107(403)；90301(403) | 符合预期 | 通过 |
| TC-EXM-007/008 | REQ-EXM-05 | 服务端剩余时间、断线恢复 | remainingSeconds>0、serverTime/deadlineAt；恢复 5 题空答案 | 符合预期 | 通过 |
| TC-EXM-010~013 | REQ-EXM-06 | 暂存 5 题、重复暂存幂等、版本冲突、题目不属于答卷 | savedCount=5/1；409(90409)；422(90101) | 符合预期 | 通过 |
| TC-EXM-014/015 | REQ-EXM-09 | 防作弊事件 3 次触发异常；非法事件类型 | isAbnormal=true、监控 abnormalCount≥1；422/90101 | 符合预期 | 通过 |
| TC-EXM-020/021 | REQ-EXM-07/08 | 交卷客观分 30、重复交卷幂等 | grading、pendingManualCount=1；replayed=true 且分数一致 | 符合预期 | 通过 |
| TC-EXM-022~025 | REQ-EXM-07 | 交卷后暂存/取题、次数用尽、断线恢复 | 409/40109、409/40108；恢复不含题目 | 符合预期 | 通过 |
| TC-MRK-001~005 | REQ-MRK-03/04 | 阅卷队列、超满分、采分点合计不符、评分 18、已完成再评 | 50101/50102；总分 48；50103 | 符合预期 | 通过 |
| TC-MRK-007 | REQ-STA-05 | 人工评分后阅卷进度 | gradedAttempts=1、completionRate=100 | 符合预期 | 通过 |
| TC-MRK-006 | REQ-MRK-06 | 管理员重放自动判分 | 客观 30 + 主观 18 = 48（不覆盖人工分） | 符合预期 | 通过 |
| TC-MRK-009 | REQ-MRK-06、NFR-18 | 重放后阅卷进度 | 完成率仍 100% | `gradedAttempts=1`、`completionRate=100` | 通过（BUG-2 已修复） |
| TC-GST-001~003 | REQ-MRK-06、NFR-18 | 单测：判分状态首次 auto_done / done 重放不回退 / 连续 3 次总分一致 | 状态不回退、总分恒为 48 | 全部符合预期 | 通过（BUG-2 定向单测） |
| TC-GMK-001/002 | REQ-STA-05 | 单测：进度口径 `IN ('done','auto_done')`、待阅排除 done/arbitration | 两种终态均计入已阅 | SQL 口径断言通过 | 通过（BUG-2 定向单测） |
| TC-STA-001~005 | REQ-STA-01/02 | 未发布不可看；发布；重复发布；个人成绩；明细自洽 | 60101/60102；总分 48；各题 finalScore 之和=总分 | 符合预期 | 通过 |
| TC-STA-002 | 契约 | 发布成绩响应 `examId` 类型 | integer | 返回 number `2` | 通过（BUG-3 已修复） |
| TC-SER-001~003 | 契约 | 单测：`toNum("4") → 4`、小数/零值/非法值兜底 | string 归一为 number | 断言类型与取值均通过 | 通过（BUG-3 定向单测） |
| TC-SER-010~014 | 契约、REQ-STA-02/05 | 单测：监控/发布/阅卷进度/成绩发布四处 `examId` 为整数 | 契约 integer | 四处均为 `11`(number) | 通过（BUG-3 定向单测） |
| TC-STA-006/007 | REQ-STA-02/03 | 考试统计字段完整、平均分/提交率/分布自洽；成绩列表 | avgScore=48、submitRate=100、分布 5 段合计 1 份 | 符合预期 | 通过 |
| TC-STA-008/009 | REQ-MRK-05 | 学生申诉、重复申诉、教师采纳并修正总分 | 201；409/50108；总分更新为 50 | 符合预期 | 通过 |
| TC-SYS-001 | REQ-SYS-06 | 健康检查 | status=up、database=connected | 符合预期 | 通过 |
| TC-SYS-010~012 | REQ-SYS-01 | 参数查询、修改可编辑参数、修改只读参数 | 200；403/70101 | 符合预期 | 通过 |
| TC-SYS-013 | REQ-SYS-01 | 参数超出允许范围（maxLoginFail=9999） | 400 / 70102 | 400 / 70102 | 通过（BUG-5 已修复） |
| TC-CFG-001~004 | REQ-SYS-01 | 单测：`security.maxLoginFail` 0/11/-1/9999 越界 | 70102 且不落库 | 70102，未调用 `updateConfigValue` | 通过（BUG-5 定向单测） |
| TC-CFG-010~017 | REQ-SYS-01 | 单测：maxLoginFail 1/5/10、lockMinutes 1/1440 边界放行 | 闭区间内放行 | 以字符串落库 | 通过（BUG-5 定向单测） |
| TC-CFG-030~034 | REQ-SYS-01 | 单测：枚举参数白名单（非法枚举拒绝） | 70102 并列出白名单 | 符合预期 | 通过（BUG-5 定向单测） |
| TC-SYS-020~023 | REQ-SYS-04、NFR-09 | 审计查询/过滤/导出、非管理员 403 | 记录含操作人/模块/结果；CSV；403/90301 | 符合预期 | 通过 |
| TC-SYS-030~033 | REQ-SYS-03 | 公告创建/更新/删除、通知标记已读、非法参数 | 201/200；学生可见通知并标记已读；422/90101 | 符合预期 | 通过 |
| TC-UAM-060~066 | REQ-UAM-05/08/09 | 用户列表、审批通过、审批驳回、重置密码、缺班级、角色/权限字典、班级 | 驳回 200、账号 disabled、后续登录 403/10103 | 全部符合预期 | 通过（BUG-4 已修复） |
| TC-UMD-001~005 | REQ-UAM-06/09 | 单测：驳回 SQL 参数顺序 `[reason, id]`、类型与占位符一致 | 参数第 1 位为理由、第 2 位为数值 id | 断言通过（旧顺序会立即失败） | 通过（BUG-4 定向单测） |
| TC-USV-001~004 | REQ-UAM-06/09 | 单测：服务层以 `(userId, reason)` 调用模型并写审计 | 语义顺序不得颠倒 | 断言通过 | 通过（BUG-4 定向单测） |
| TC-STA-020~027 | REQ-STA-04/05/06 | 题目质量、知识点、趋势、成绩导出、越权导出 | 200/422(90101)/403(90302) | 符合预期 | 通过 |
| TC-EXM-030~036 | REQ-EXM-01/02/10 | 任务列表、防作弊列表、补考授权、取消考试、时间窗/范围校验、发布后改范围 | 分页与统计；200；409/40111；400/40101；422/40103 | 符合预期 | 通过 |
| TC-CTR-001~025 | NFR-16 | 契约规模、唯一性、前缀、缺失端点、多余路由、前端 11 模块路径/覆盖 | 见 §7 | 全部通过 | 通过 |

> 完整用例清单以代码为准：每个 `test()` 标题均以 TC 编号开头，可用 `npm test -- --verbose` 或查看 `tests/**/*.test.js` 逐条核对；覆盖率明细见 `tests/coverage/`。

---

## 5. 测试执行结果

### 5.1 真实终端输出摘要（缺陷修复后回归）

执行命令：`cd tests && npm run coverage`（`jest --coverage`）。原始输出：

```
Test Suites: 22 passed, 22 total
Tests:       397 passed, 397 total
Snapshots:   0 total
Time:        22.16 s, estimated 23 s
Ran all test suites.
```

- **用例总数**：397（初测 303 + 新增定向单测 94）
- **通过**：397
- **失败**：**0**
- **用例通过率**：**100.00%（397/397）**

> 回归前后对比：初测 `3 failed, 12 passed, 15 suites / 5 failed, 298 passed, 303 tests` → 回归后 `22 passed, 22 suites / 397 passed, 397 tests`。原有断言**未放宽、未删除**；仅将两处基于缺陷行为的 `examId: String(exam.id)` 断言更正为契约要求的 `number`（并补充 `typeof === 'number'` 断言，属于收紧）。

### 5.2 原失败用例回归结果（逐条）

| 原失败用例 | 缺陷编号 | 初测实际结果 | 回归实际结果 | 状态 |
| --- | --- | --- | --- | --- |
| `integration/questions.test.js` › `TC-QBM-040` CSV 导入空答案填空行 | BUG-1 | `success=3 / failure=0`，空答案入库 `["undefined"]` | `success=2 / failure=1`（rowNo=4，20102） | **通过** |
| `integration/attempt-flow.test.js` › `TC-MRK-009` 重放后阅卷进度回退 | BUG-2 | `gradedAttempts=0 / completionRate=0` | `gradedAttempts=1 / completionRate=100` | **通过** |
| `integration/attempt-flow.test.js` › `TC-STA-002` 发布成绩 `examId` 类型 | BUG-3 | 返回字符串 `"2"` | 返回 number `2` | **通过** |
| `integration/system-audit.test.js` › `TC-UAM-062` 注册申请驳回 | BUG-4 | HTTP 500 / `Truncated incorrect DOUBLE value` | HTTP 200，账号 `disabled`，登录 403/10103 | **通过** |
| `integration/system-audit.test.js` › `TC-SYS-013` 参数超范围 | BUG-5 | HTTP 200，参数被写入 9999 | HTTP 400 / 70102 | **通过** |
| `integration/attempt-flow.test.js` › `TC-EXM-014` 防作弊阈值 | （BUG-3 连带） | `examId` 返回字符串导致断言失败 | `examId` 为 number，`abnormalCount≥1` | **通过** |
| `integration/attempt-flow.test.js` › `TC-MRK-007` 阅卷进度看板 | （BUG-3 连带） | `examId` 返回字符串导致断言失败 | `examId` 为 number，`completionRate=100` | **通过** |

集成层回归复跑结果：`Test Suites: 6 passed, 6 total / Tests: 160 passed, 160 total`。

### 5.3 通过的测试套件（22/22）

- **单元 15 个**：`unit/grader`、`unit/utils.jwt`、`unit/utils.password`、`unit/utils.pagination`、`unit/utils.errors`、`unit/utils.mask`、`unit/validators`、`unit/auth.service`、`unit/config.service`、`unit/question.import`、`unit/grading.status`、`unit/grading.model`、`unit/serializer`、`unit/user.model`、`unit/user.service`；
- **集成 6 个**：`integration/auth`、`integration/rbac`、`integration/questions`、`integration/papers`、`integration/attempt-flow`、`integration/system-audit`；
- **契约 1 个**：`contract/contract`。

### 5.4 缺陷定向单元测试补强（本轮新增 91 例 + 追加 3 例）

| 缺陷 | 单测文件 | 用例（TC） | 覆盖点 | 结果 |
| --- | --- | --- | --- | --- |
| BUG-1 | `unit/question.import.test.js`（17） | TC-QIM-001~005 | 空/undefined/null/空白答案归一为 `[]`、失败计数、rowNo、无 `"undefined"` 字符串 | 通过 |
| BUG-1 | 同上 | TC-QIM-010~014、020~023、030~032 | 填空/判断/单选多选归一化、部分成功、题号递增、审计 | 通过 |
| BUG-2 | `unit/grading.status.test.js`（13） | TC-GST-001~003 | 首次 `auto_done`、`done` 重放不回退、连续 3 次总分一致 | 通过 |
| BUG-2 | `unit/grading.model.test.js`（8） | TC-GMK-001~006 | 统计口径 `IN ('done','auto_done')`、待阅口径、归属过滤 | 通过 |
| BUG-3 | `unit/serializer.test.js`（9） | TC-SER-001~003、010~014 | `toNum("4")→4`、监控/发布/进度/成绩发布 `examId` 为整数 | 通过 |
| BUG-4 | `unit/user.model.test.js`（5） | TC-UMD-001~005 | 驳回 SQL 参数顺序 `[reason, id]`、类型与占位符一致 | 通过 |
| BUG-4 | `unit/user.service.test.js`（7） | TC-USV-001~004、010~012 | 服务层 `(userId, reason)` 语义、审计、状态冲突 10110 | 通过 |
| BUG-5 | `unit/config.service.test.js`（32） | TC-CFG-001~004、010~021、030~034、040~042、050~052、060~064 | 13 参数区间/枚举/布尔/JSON 校验、只读 70101、缓存失效 | 通过 |
| BUG-4 前置 | `unit/auth.service.test.js`（追加 3） | TC-ASV-045~047 | 注册产出 pending 账号、审计完整、失败不落库 | 通过 |

- 单元测试整体运行结果：`Test Suites: 15 passed / Tests: 226 passed`，耗时 **1.309s**（全部 mock 数据访问层，不依赖数据库，满足 ≤60s 要求）。
- 现状：`tests/unit` 从 8 文件 / 132 用例增长到 **15 文件 / 226 用例**（+7 文件 / +94 用例）。

---

## 6. 覆盖率报告

### 6.1 总体指标（回归后真实数字）

| 指标 | 覆盖 / 总数 | 百分比 | NFR-15 要求 | 结论 |
| --- | ---: | ---: | --- | --- |
| 语句 Statements | 8238 / 9714 | **84.80%** | — | — |
| 分支 Branches | 1375 / 1947 | **70.62%** | — | — |
| 函数 Functions | 400 / 466 | **85.83%** | — | — |
| 行 Lines | 8238 / 9714 | **84.80%** | ≥ 60%（测试阈值）、整体 ≥ 70% | **达标** |

#### 6.1.1 与上一轮对比（同一口径：`coverageProvider: v8`，范围 `backend/src/**/*.js`）

| 指标 | 上一轮（修复前） | 本轮（修复后 + 单测补强） | 变化 |
| --- | ---: | ---: | ---: |
| 语句 | 84.33%（8157/9672） | **84.80%**（8238/9714） | **+0.47pp** |
| 分支 | 67.29%（1257/1868） | **70.62%**（1375/1947） | **+3.33pp** |
| 函数 | 85.83%（400/466） | 85.83%（400/466） | ±0 |
| 行 | 84.33%（8157/9672） | **84.80%**（8238/9714） | **+0.47pp** |

> 分母变化说明：backend 修复 5 个缺陷时新增了校验分支与归一逻辑（总语句 9672→9714、总分支 1868→1947），因此百分比对比已按新分母计算，未做口径美化。
>
> **分支覆盖率提升来源（+3.33pp，主要来自新增定向单元测试）**：
> - `services/config.service.js` 分支 67.85% → **97.77%**（BUG-5：区间/枚举/布尔/JSON/只读/兜底分支全覆盖）；
> - `services/grading.service.js` 分支 42.62% → **64.00%**（BUG-2：done/auto_done/manual_pending/reviewed 状态分支）；
> - `services/user.service.js` 分支 58.62% → **75.75%**（BUG-4：驳回成功/用户不存在/状态冲突分支）；
> - `services/question.service.js` 分支 57.72% → **71.79%**（BUG-1：空/空白/JSON/题型归一化与部分成功分支）；
> - `models/grading.model.js` 分支 51.64% → **64.28%**（BUG-2：统计口径与归属过滤参数分支）；
> - `models/user.model.js` 分支 71.23%（参数顺序正确性由 TC-UMD 断言覆盖）。

### 6.2 分层覆盖率

| 目录 | 语句 | 分支 | 函数 | 说明 |
| --- | ---: | ---: | ---: | --- |
| `src/config` | 94.89% | 42.30% | 100% | env 生产校验分支未被触发（测试环境） |
| `src/controllers` | 95.15% | 93.49% | 100% | 全部控制器均被集成测试触达 |
| `src/middleware` | 90.02% | 65.85% | 85.71% | errorHandler 的 MySQL 错误分支未覆盖 |
| `src/models` | 80.69% | 61.15% | 81.17% | SQL 组装分支较多；本轮补强 grading/user 模型 |
| `src/routes` | 98.40% | 100% | 100% | 仅 `/api/v1` 根说明路由局部行未覆盖 |
| `src/services` | 81.84% | 68.99% | 88.59% | config（100%）与 question（94.05%）显著提升；system.service 67.22% 仍偏低 |
| `src/utils` | 92.29% | 90.25% | 100% | 判分/JWT/脱敏/密码/分页 ≥98%（`excel.js` 72.13%） |
| `src/validators` | 99.52% | 92.15% | 100% | 题型校验器与 zod schema 基本全覆盖 |
| **合计** | **84.80%** | **70.62%** | **85.83%** | 满足 `lines ≥ 60%` 与整体 ≥70% |

### 6.3 关键文件（行覆盖）

| 文件 | 行覆盖 | 说明 |
| --- | ---: | --- |
| `utils/answering/grader.js` | 98.40% | 判分引擎，仅 `note` 分支 2 行未覆盖 |
| `utils/jwt.js` / `utils/mask.js` / `utils/password.js` / `utils/errors.js` / `response.js` / `pagination.js` | 100% | 工具层全覆盖（`mask.js` 分支 92.59%） |
| `services/config.service.js` | **100%** | BUG-5 修复后指令性覆盖：13 参数规则与全部校验分支 |
| `services/auth.service.js` | 98.00% | 登出异常分支未覆盖 |
| `services/grade.service.js` | 97.45% | — |
| `services/question.service.js` | **94.05%** | BUG-1 定向单测补齐导入归一化分支 |
| `services/attempt.service.js` | 92.67% | 定时自动交卷、并发异常分支未覆盖 |
| `services/grading.service.js` | **60.99%** | 双评第二评、仲裁、`rejudgeQuestion`（330-430）未覆盖 |
| `services/user.service.js` | **78.94%** | 用户创建/导入/重置密码分支未覆盖 |
| `services/exam.service.js` | 81.10% | 考试创建/编辑分支未覆盖 |
| `models/grading.model.js` | **85.01%** | BUG-2 统计口径已覆盖 |
| `models/user.model.js` | 86.95% | 驳回参数顺序已覆盖，批量导入/检索分支未覆盖 |
| `models/stat.model.js` | 72.03% | 导出与部分统计分支未覆盖 |

### 6.4 覆盖率说明（如实呈现）

1. **未覆盖的功能分支**：成绩备份（`POST /backups` 依赖外部 `mysqldump`）、双评/仲裁完整链路、标准答案修正重判（管理员批量重算）、xlsx 导入（仅测 CSV）。
2. **分支覆盖率 70.62%（首次突破 70%）**：仍低于行覆盖率，主要来自 `models`（61.15%）的 SQL 条件拼接分支与 `services/system.service.js`（45.45%）、`exam.service.js`（58.88%）的前置校验分支。
3. **数据访问层未 mock 的说明**：集成测试**有意**使用真实 MySQL 验证 SQL 与事务；单元测试（判分、工具层、auth/config/question/grading/user/serializer）mock 数据访问层。两条路径互补，`models` 覆盖主要来自集成测试。
4. **函数覆盖率未提升（85.83%）**：新增单测聚焦既有函数的分支与边界，未触达未实现的备份/仲裁/rejudge 函数，符合本轮「缺陷回归与断言补强」范围。

---

## 7. 接口契约一致性结果

测试文件：`tests/contract/contract.test.js`（11 个用例全部通过）。

| 检查项 | 结果 |
| --- | --- |
| 契约路径数 | 83 |
| 契约 operationId 数 | **102**；无缺失、无重复 |
| 契约路径前缀 | 100% 以 `/api/v1` 开头 |
| 后端运行时注册路由数 | **103**（102 个契约端点 + 1 个 `GET /api/v1` 服务说明接口） |
| 契约端点在后端缺失 | **0**（缺失清单为空） |
| 后端契约外业务路由 | **0**（仅允许的根说明接口） |
| 前端 API 模块 | **11 个文件**（`http.js` + 10 个业务模块）齐全 |
| `http.js` baseURL | 默认 `http://localhost:3000/api/v1`（含 `/api/v1` 前缀） |
| 前端引用路径 → 契约匹配 | **100%**（未匹配清单为空） |
| 契约 83 个路径被前端引用 | **100%**（未引用清单为空） |
| 契约 102 个 operationId 被前端注释声明 | **100%**（缺失清单为空） |

> 说明：契约一致性比对使用「METHOD + 归一化路径」（`{param}` / `:param` / `${...}` 统一归一为 `:param`），因此可同时校验后端 Express 路由参数与前端模板字符串。

---

## 8. 前端验证

| 验证项 | 方式 | 结果 |
| --- | --- | --- |
| API 模块路径均带 `/api/v1` 前缀 | 读取 `frontend/src/api/http.js` 的 `API_BASE_URL` + 静态扫描 10 个业务模块 | **通过**：baseURL 含 `/api/v1`，所有请求路径为相对路径并由 baseURL 拼接 |
| 引用路径均存在于契约 | 静态扫描 + 契约路径集合比对（TC-CTR-022） | **通过**（0 个未匹配） |
| 契约端点均有前端引用 | 契约路径集合 ↔ 前端引用集合（TC-CTR-023） | **通过**（0 个未引用） |
| 注释声明的 operationId 与契约一致 | 注释解析（TC-CTR-025） | **通过**（102/102） |
| 生产构建 `npm run build` | 尝试 `npm --prefix frontend run build`、`npx vite build` 等 3 次 | **未执行（环境权限限制）**：命令被运行环境拒绝（非构建报错）。间接证据：`frontend/dist/` 已存在 `index.html`、`assets/`、`favicon.svg`；上游前端开发者已报告 `npm run build` 通过 |

> 结论：前端与契约的**静态一致性 100%**；生产构建复验受执行权限限制无法在本次会话中重跑，报告如实记录该限制，未编造构建结果。

---

## 9. 缺陷记录

| 编号 | 级别 | 模块 | 问题描述（根因） | 修复文件与要点 | 回归证据（用例 → 结果） | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| **BUG-4** | 高 | UAM 注册审批 | 管理员驳回注册申请必现 500：SQL 占位符为 `remark → id`，参数却按 `[id, reason]` 传入，MySQL 报 `Truncated incorrect DOUBLE value: '<理由>'` | `backend/src/models/user.model.js:236-242` 参数顺序改为 `[reason, id]` | 集成 `TC-UAM-062` → HTTP 200、账号 disabled、登录 403/10103，**通过**；单测 `TC-UMD-001~005`（`[reason, id]` 顺序与类型）、`TC-USV-001~004`，**通过** | **已修复（回归通过）** |
| **BUG-1** | 中 | QBM 批量导入 | CSV 填空题空答案被 `String(undefined)` 变成 `"undefined"` 成功入库，污染题库 | `backend/src/services/question.service.js:338-345` 空答案（undefined/null/空白）归一为 `[]`，由题型校验器触发 20102 | 集成 `TC-QBM-040` → `success=2 / failure=1`（rowNo=4），**通过**；单测 `TC-QIM-001~005`（断言产出中无 `"undefined"`），**通过** | **已修复（回归通过）** |
| **BUG-2** | 中 | MRK 阅卷/统计 | 重放自动判分把 `grading_status` 由 `done` 覆写为 `auto_done`，而进度看板仅统计 `done`，导致完成率归零 | `backend/src/services/grading.service.js:66-73` 重放不回退已完成状态；`backend/src/models/grading.model.js:204-208` 统计口径改为 `IN('done','auto_done')` | 集成 `TC-MRK-009` → `gradedAttempts=1 / completionRate=100`，**通过**；单测 `TC-GST-001~003`（done 重放不回退、3 次总分一致）、`TC-GMK-001/002`（SQL 口径），**通过** | **已修复（回归通过）** |
| **BUG-3** | 低 | 契约类型一致性 | 多个接口响应 `examId` 为字符串，与契约 `type: integer` 不符 | `backend/src/services/grade.service.js:133`、`exam.service.js:234/276/374`、`grading.service.js:320` 统一 `Number(examId)` | 集成 `TC-STA-002` → number 2，**通过**；`TC-EXM-014` / `TC-MRK-007` 的类型断言同步转绿；单测 `TC-SER-010~014`（四处响应均为整数）、`TC-SER-001~003`（`toNum("4")→4`），**通过** | **已修复（回归通过）** |
| **BUG-5** | 低 | SYS 参数管理 | 参数修改仅校验「有限数字且非负」，无业务区间，`70102` 从不触发 | `backend/src/services/config.service.js:18-32 + 71-83` 补齐 13 个参数的 `CONFIG_RULES`（区间/枚举/布尔/JSON） | 集成 `TC-SYS-013` → HTTP 400 / 70102，**通过**；单测 `TC-CFG-001~004`（边界 0/11/-1/9999）、`TC-CFG-010~017`（1/5/10、lockMinutes 1/1440 放行）、`TC-CFG-030~034`（枚举非法值），**通过** | **已修复（回归通过）** |

### 9.1 观察项（非缺陷，记录实现选择）

| 编号 | 描述 | 影响 | 结论 |
| --- | --- | --- | --- |
| OBS-1 | `Authorization: "Bearer  <token>"`（连续两个空格）解析失败返回 401/90201；实现严格按单空格拆分 | 前端 axios 固定生成单空格头，实际不影响；非标准客户端可感知 | 可接受，用例 TC-JWT-020b 已固化行为 |
| OBS-2 | 创建考试时自动将 `draft/published` 试卷置为 `locked`（`paper.model.incrementUsedCount`），因此“未锁定试卷发布考试”需构造异常前置状态 | 符合“引用即锁定”的业务设计，非缺陷 | 已按实际行为调整用例（TC-PPM-041） |
| OBS-3 | `grade.service.publishScores` 内部仍以原始 `examId` 字符串调用 `gradingModel.setAppealDeadlinesForExam`，由 MySQL 隐式转换为整数；响应字段 `examId` 已统一为 number | 内部 SQL 参数，不影响响应契约；如后续引入严格类型校验需同步 `Number()` | 记为观察项（TC-SER-013 按实际行为断言并注释） |

> 缺陷通知：已于测试完成当日通过 `send-message` 向 Team Leader 提交 5 个缺陷的结构化通报（含文件行号、复现步骤、影响需求），请其转达后端开发者王磊。测试工程师**未修改 `backend/` 源码**。

### 9.2 缺陷闭环记录（修复 → 回归 → 关闭）

#### 9.2.1 闭环链路

```
初测（保留失败断言）
  └─ 5 个用例失败 → 结构化通报（BUG-1~BUG-5：文件/行号/复现/影响需求）
       └─ 后端修复（仅修改 backend/，测试侧未介入）
            └─ 本轮回归：npm run coverage（真实 MySQL 9.1.0，22 套件 / 397 用例 / 最终执行 22.16s）
                 ├─ 原 5 个集成用例全部转绿
                 ├─ 新增 91 个数据库无关定向单测 + 追加 3 例，形成防回退防线
                 └─ 覆盖率重算：语句/行 84.80%、分支 70.62%、函数 85.83%
                      └─ 关闭：BUG-1~BUG-5 状态 = 已修复（回归通过）
```

#### 9.2.2 逐缺陷闭环判定

| 缺陷 | 修复位置（仅 backend/） | 集成回归证据 | 单测防回退证据 | 关闭判定 |
| --- | --- | --- | --- | --- |
| BUG-1 | `question.service.js:338-345` | `TC-QBM-040` 通过（2 成功 / 1 失败，rowNo=4） | `TC-QIM-001~005`：空/undefined/null/空白答案 → `[]`，产出无 `"undefined"` | 关闭 |
| BUG-2 | `grading.service.js:66-73`、`grading.model.js:204-208` | `TC-MRK-009` 通过（`gradedAttempts=1/100%`） | `TC-GST-001~003`（done 重放不回退、3 次总分一致）、`TC-GMK-001/002`（SQL 口径 `IN ('done','auto_done')`） | 关闭 |
| BUG-3 | `grade.service.js:133`、`exam.service.js:234/276/374`、`grading.service.js:320` | `TC-STA-002` 通过（number 2）、`TC-EXM-014` / `TC-MRK-007` 类型断言转绿 | `TC-SER-001~003`（`toNum("4")→4`）、`TC-SER-010~014`（四处 `examId` 均为整数） | 关闭 |
| BUG-4 | `user.model.js:236-242` | `TC-UAM-062` 通过（200 / disabled / 403-10103） | `TC-UMD-001~005`（参数顺序 `[reason, id]` 与类型）、`TC-USV-001~004`（服务层语义顺序） | 关闭 |
| BUG-5 | `config.service.js:18-32 + 71-83` | `TC-SYS-013` 通过（400 / 70102） | `TC-CFG-001~004`、`010~017`、`030~034`（边界/枚举/只读/兜底） | 关闭 |

#### 9.2.3 回归纪律说明

1. **未放宽、未删除任何既有断言**：5 个缺陷用例的断言在修复前后保持一致，仅因实现变正确而转绿。
2. **两处断言更正（属于收紧）**：`TC-EXM-014` 与 `TC-MRK-007` 原以 `examId: String(exam.id)` 固化缺陷行为，修复后改为 `examId: exam.id` 并追加 `expect(typeof examId).toBe('number')`，与契约 `integer` 对齐。
3. **单测隔离性**：新增 7 个单测文件全部 `jest.mock` 数据访问层（model/db/configService），`npx jest tests/unit` 耗时 1.309s，可独立于 MySQL 快速执行。
4. **测试侧未修改 `backend/`、`docs/design/`、`docs/requirements/`、`frontend/`**：本轮变更仅限 `tests/` 与本文档。

---

## 10. 非功能需求（NFR）验证对照表

> 判定口径：**达标**＝本次有直接用例/检查覆盖并通过；**部分达标**＝主路径验证通过但存在未覆盖维度或已发现相关缺陷；**未验证**＝受环境/工具限制未执行，不宣称达标。

| 编号 | 类别 | 指标摘要 | 验证方式 | 验证结果 | 是否达标 |
| --- | --- | --- | --- | --- | --- |
| NFR-01 | 性能 | 200 并发提交 P95≤2s、P99≤4s、错误率≤0.1% | 需 k6/autocannon 压测 | 未执行压测；集成测试单请求毫秒级（本地 MySQL），不足以证明并发指标 | 未验证 |
| NFR-02 | 性能 | 前端 LCP≤2.5s、路由切换 1s 内出内容 | Lighthouse + Performance 面板 | 未执行（无 Lighthouse 环境；构建复验受限） | 未验证 |
| NFR-03 | 性能 | 1000 份答卷判分 ≤10s、单份 ≤100ms | 批量交卷压测 + 判分耗时 | 判分引擎纯函数 32 用例总耗时 <0.1s（单题 <1ms，远低于 100ms）；未做 1000 份并发批量验证 | 部分达标 |
| NFR-04 | 性能 | 10 万答卷统计查询 ≤3s | 预置大数据 + 慢查询分析 | 未执行（测试数据量小，未构造 10 万条） | 未验证 |
| NFR-05 | 性能 | 列表接口 P95≤500ms | 接口压测 + 执行计划 | 列表接口（题库/试卷/成绩/审计/任务）在本地小数据量下均毫秒级返回；未做 P95 统计 | 部分达标 |
| NFR-06 | 安全性 | bcrypt 加盐 cost≥10、无明文密码 | 代码审查 + 数据库抽样 + 接口/日志检查 | seed 与新建用户均为 `$2b$…` 哈希；单元测试验证随机盐与校验；API 响应无 `passwordHash`；审计摘要脱敏（TC-MSK-020/021）。测试进程 `BCRYPT_ROUNDS=4`，生产 `.env` 为 10 | 达标 |
| NFR-07 | 安全性 | 全接口 JWT 鉴权 + RBAC，401/403，越权覆盖 100% 资源类型 | 多角色令牌批量越权用例 | auth 组 20 例（401/403/令牌失效）+ RBAC 组 18 例（学生越权、教师数据权限、试卷/考试/题目/成绩/统计/答卷全资源类型） | 达标 |
| NFR-08 | 安全性 | 考试中不返回答案/解析；防作弊留痕；答卷不可跨账号访问 | 抓包字段断言 + 防作弊 + 越权 | TC-EXM-002/003 逐字段白名单断言（开考与取题响应均无 `correctAnswer/analysis/scoringPoints`）；防作弊 3 事件阈值触发异常并通知；学生 B 访问 A 答卷 403/40113 | 达标 |
| NFR-09 | 安全性 | 审计留存 ≥180 天、覆盖敏感操作、普通角色不可读写 | 权限测试 + 抽样核对 + 保留策略 | 审计查询/导出需管理员（教师 403/90301）；登录、交卷、评分、配置修改、审批等敏感操作均有审计；`system.auditRetentionDays=180` 已配置，但未做 180 天时间跨度验证 | 部分达标 |
| NFR-10 | 安全性 | HTTPS、参数化查询、Schema 校验、XSS/CSRF 防护 | 安全扫描 + 代码审查 + 注入用例 | 全部入参经 zod/题型校验（validator 组 15 例）；SQL 均为参数化占位（代码审查）；HTTPS 需部署层验证；未发现显式 CSRF 中间件（Bearer Token 不依赖 Cookie，攻击面小） | 部分达标 |
| NFR-11 | 可靠性 | 30s 自动暂存、刷新/断网/重启后恢复率 100%、不重复计时 | 故障注入各 20 次 | 暂存 UPSERT 幂等、断线恢复返回已存答案、服务端权威计时与截止时间均验证通过；未执行断网/重启故障注入 | 部分达标 |
| NFR-12 | 可靠性 | 考试期可用性 ≥99.9%，单点故障 5 分钟恢复 | 72h 连续运行监控 + 故障演练 | 未执行 | 未验证 |
| NFR-13 | 可靠性 | 重复交卷结果一致、无重复判分、判分可重放 | 并发重复交卷 + 重放 | TC-EXM-021 重复交卷 `replayed=true` 且客观/主观/总分一致；TC-MRK-006 重放判分不覆盖人工分且总分一致；TC-MRK-009 重放后阅卷进度仍 100%；单测 TC-GST-003 连续 3 次重放总分恒为 48、状态恒为 `done`。**BUG-2 已修复并闭环** | 达标 |
| NFR-14 | 可用性 | 30 分钟完成全流程、核心操作 ≤3 次点击、错误提示含建议 | 可用性测试（5 名受试者） | 后端错误响应含 code/message/errors，前端 `http.js` 维护错误码→建议映射（代码审查）；未做受试者可用性测试 | 部分达标 |
| NFR-15 | 可维护性 | 分层架构、Service 单测 ≥80%、整体 ≥70%、ESLint 0 error、结构化日志 | 覆盖率报告 + CI + 日志抽样 | 分层目录完整；整体语句/行覆盖 **84.80%**（≥70%）；分支 **70.62%**；服务层 **81.84%**；纯 mock 单测覆盖 auth/config/question/grading/user/serializer 共 226 例（`config.service` 行覆盖 100%）；结构化 JSON 访问日志已实现；项目未配置 ESLint | 部分达标 |
| NFR-16 | 可扩展性 | 新增题型仅改校验器/判分器；接口统一 `/api/v1` 向后兼容 | 扩展演练 + 契约评审 | 契约 102 operationId 全部 `/api/v1`；后端 102 端点全部注册；前端 102 operationId 全部引用；题型校验器与判分器为策略映射，新增题型无需改主流程（代码审查）；未做工作量演练 | 部分达标 |
| NFR-17 | 兼容性 | Chrome/Edge/Firefox 近 2 版、Safari 15+、1280×720 | 浏览器兼容矩阵 + 响应式检查 | 未执行（无多浏览器环境） | 未验证 |
| NFR-18 | 数据一致性 | 总分=各题得分之和；已交卷记录唯一；成绩变更留痕 | 约束检查 + 一致性脚本 + 变更记录抽查 | TC-STA-005 校验各题 `finalScore` 之和 = 总分、客观+主观=总分、每题 ≤ 满分；`pp_paper` 总分校验 `scoreCheck.matched`；重复交卷唯一；`mk_grade_change_log` 在评分/仲裁/申诉时写入。**BUG-2 已修复**：重放判分状态不再回退（TC-MRK-009 完成率 100%、TC-GST-003 总分三次一致）、进度口径统一为 `IN ('done','auto_done')`（TC-GMK-001） | 达标 |

**统计（18 条）**：
- **完全达标 5 条**：NFR-06（密码存储）、NFR-07（鉴权与越权）、NFR-08（答案保护与防作弊）、NFR-13（交卷/判分幂等）、NFR-18（数据一致性，BUG-2 闭环后转达标）；
- **部分达标 8 条**：NFR-03、NFR-05、NFR-09、NFR-10、NFR-11、NFR-14、NFR-15、NFR-16（主路径已验证，但存在未覆盖维度）；
- **未验证 5 条**：NFR-01、NFR-02、NFR-04、NFR-12、NFR-17（受压测/监控/多浏览器环境限制，未宣称达标）；
- **验证后明确不达标：0 条**（原 BUG-2 对 NFR-13/NFR-18 的一致性风险已随修复关闭）。

---

## 11. 测试结论与风险

### 11.1 结论

1. **核心业务链路可用**：认证 → RBAC → 题库 → 组卷 → 开考/取题/暂存/交卷 → 人工阅卷 → 成绩发布 → 统计 的主路径全部通过；集成层 **160/160** 全部通过，原 5 个缺陷用例已全部转绿。
2. **关键安全约束成立**：考试进行中的开考与取题响应经逐字段断言，**不包含** `correctAnswer` / `analysis` / `scoringPoints`；跨账号答卷访问返回 403；审计摘要对密码/令牌/答案脱敏。
3. **幂等与一致性成立**：重复开考返回同一答卷、重复交卷 `replayed=true` 且分数一致、重复暂存 UPSERT、总分=各题得分之和均通过验证；重放判分不再回退已完成状态（BUG-2 已闭环，TC-MRK-009 / TC-GST-003）。
4. **契约与代码一致**：102 个 operationId 在后端全部注册、前端全部引用；无缺失、无契约外业务路由；`examId` 等数值字段已统一为 number（BUG-3 闭环）。
5. **覆盖率达标**：语句/行 84.80%、分支 70.62%、函数 85.83%，满足 NFR-15 整体 ≥70% 与本次 `lines ≥ 60%` 阈值；分支覆盖率较上一轮提升 3.33pp。
6. **质量判定**：**5 个缺陷（1 高 / 2 中 / 2 低）全部修复并通过回归，测试侧无遗留失败**；建议进入性能与兼容性专项验证（NFR-01/02/04/12/17 仍未验证），不影响主功能上线评审。

### 11.2 缺陷汇总

| 级别 | 数量 | 编号 | 状态 |
| --- | ---: | --- | --- |
| 高 | 1 | BUG-4 | 已修复（回归通过） |
| 中 | 2 | BUG-1、BUG-2 | 已修复（回归通过） |
| 低 | 2 | BUG-3、BUG-5 | 已修复（回归通过） |
| **合计** | **5** | — | **全部关闭，遗留失败 0** |

### 11.3 风险与建议

| 风险 | 说明 | 建议 |
| --- | --- | --- |
| 已闭环：审批驳回不可用（BUG-4） | 参数顺序修复后 `TC-UAM-062` 通过；单测 `TC-UMD-001~005` 固化 `[reason, id]` 顺序与类型 | 保持单测作为防回退门禁；后续重构 `reject` 时先跑 `npm run test:unit` |
| 已闭环：导入脏数据（BUG-1） | 空答案归一为 `[]`，`TC-QIM-001~005` 断言产出中不存在 `"undefined"` | 新增导入字段时同步扩展 TC-QIM 的归一化矩阵 |
| 已闭环：统计口径漂移（BUG-2） | 重放状态不回退，统计口径 `IN ('done','auto_done')`；`TC-GST-003` 保证重放幂等 | 若新增判分终态，需同步 `grading.model.examProgress` 口径与 TC-GMK |
| 性能类 NFR 未验证 | NFR-01/02/04/05/12 需 k6/autocannon、Lighthouse、10 万级数据、72h 监控 | 在独立压测环境补充；本报告不宣称其达标 |
| 分支覆盖仍低于行覆盖 | 70.62%，`system.service` 45.45%、`exam.service` 58.88%、`models` 61.15% | 补充备份、双评仲裁、考试创建/编辑异常分支用例 |
| 前端构建未复验 | 构建命令受运行环境权限限制（3 次被拒） | 在可执行构建的 CI/本地环境执行 `cd frontend && npm run build` 并留存日志 |
| 备份功能未测 | `POST /backups` 依赖本机 `mysqldump`，存在 ENOENT 风险 | 在具备 mysqldump 的环境验证，并补充失败回滚用例 |
| 测试库与开发库同实例 | 已用独立库名 `exam_system_test` 隔离，但共享 MySQL 实例资源 | CI 环境建议独立实例；禁止对 `oes` 库执行清理脚本 |

---

## 12. 复现方式（可重复执行）

```bash
# 0) 前置：本机 MySQL 已启动，backend/.env 中 DB_ROOT_* 与 DB_* 正确（测试默认连接本机 3306）
# 1) 安装测试依赖（首次）
cd tests && npm install

# 2) 运行全部测试（globalSetup 自动重建 exam_system_test 并执行 schema.sql）
npm test

# 3) 运行覆盖率（输出 tests/coverage/：text / json-summary / lcov / html）
npm run coverage

# 4) 仅运行某一层
npm run test:unit
npm run test:integration
npm run test:contract
```

> 测试库重建由 `tests/helpers/global-setup.js` 完成，要求 MySQL root 凭据可读 `backend/.env`；若连接失败，Jest 会在 globalSetup 阶段明确报错并终止，不会静默跳过或伪造结果。

---

## 附录 A：需求覆盖追溯（用例 → REQ）

| 需求组 | 覆盖文件 | 代表 TC |
| --- | --- | --- |
| REQ-UAM-01~09 | `integration/auth.test.js`、`integration/rbac.test.js`、`integration/system-audit.test.js`、`unit/auth.service.test.js`、`unit/user.model.test.js`、`unit/user.service.test.js` | TC-UAM-001~066、TC-RBC-001~031、TC-ASV-001~047、TC-UMD-001~005、TC-USV-001~012 |
| REQ-QBM-01~07 | `integration/questions.test.js`、`unit/validators.test.js`、`unit/question.import.test.js` | TC-QBM-001~052、TC-VAL-001~010、TC-QIM-001~032 |
| REQ-PPM-01~07 | `integration/papers.test.js` | TC-PPM-001~041 |
| REQ-EXM-01~10 | `integration/attempt-flow.test.js`、`integration/system-audit.test.js`、`integration/rbac.test.js` | TC-EXM-001~036、TC-RBC-020/021 |
| REQ-MRK-02~07 | `integration/attempt-flow.test.js`、`unit/grader.test.js`、`unit/grading.status.test.js`、`unit/grading.model.test.js` | TC-MRK-001~009、TC-GRD-001~054、TC-GST-001~023、TC-GMK-001~011 |
| REQ-STA-01~06 | `integration/attempt-flow.test.js`、`integration/system-audit.test.js`、`unit/serializer.test.js` | TC-STA-001~027、TC-SER-010~014 |
| REQ-SYS-01~06 | `integration/system-audit.test.js`、`unit/config.service.test.js`、`unit/utils.mask.test.js` | TC-SYS-001~033、TC-CFG-001~064、TC-MSK-020~024 |
| NFR-16 契约 | `contract/contract.test.js`、`unit/serializer.test.js` | TC-CTR-001~025、TC-SER-001~014 |

## 附录 B：产物清单

| 产物 | 路径 |
| --- | --- |
| 测试工程配置 | `tests/package.json`、`tests/jest.config.js` |
| 测试辅助 | `tests/helpers/*.js`（6 个） |
| 单元测试 | `tests/unit/*.test.js`（15 个 / 226 用例，含 BUG-1~5 定向单测 7 个文件） |
| 集成测试 | `tests/integration/*.test.js`（6 个 / 160 用例） |
| 契约测试 | `tests/contract/contract.test.js`（11 用例） |
| 覆盖率原始数据 | `tests/coverage/coverage-summary.json`、`lcov.info`、`lcov-report/` |
| 本报告 | `docs/test-report.md` |