# 在线考试系统（OES）后端

基于 `docs/design/api-contract.yaml`（102 个端点）与 `docs/design/schema.sql`（31 张表）实现的 Express 后端。
采用**模块化单体 + 严格分层**（设计文档 §3.1.2）：`routes → controllers → services → models`，共享 `middleware / utils / validators`。

## 1. 技术栈

| 类别 | 选型 |
| --- | --- |
| 运行时 | Node.js 18+（实测 Node 24.15.0） |
| Web 框架 | Express 4 |
| 数据库 | MySQL 8.0.16+（实测 MySQL 9.1.0，DDL 兼容） |
| 数据库访问 | mysql2/promise 连接池 + 参数化 SQL（无 ORM） |
| 认证 | jsonwebtoken（HS256）+ 刷新令牌白名单 + tokenVersion |
| 密码 | bcryptjs（rounds 来自 `BCRYPT_ROUNDS`，默认 10） |
| 校验 | zod |
| 安全 | helmet / cors / express-rate-limit |
| 日志 | morgan + 结构化请求日志（traceId） |
| Excel | exceljs（导入 .xlsx/.csv，导出 .xlsx） |
| 上传 | multer（内存存储，≤5MB） |

## 2. 目录结构

```
backend/
├── package.json               # scripts: start/dev/db:init/check/test/smoke/endpoints
├── .env.example               # 环境变量模板（复制为 .env）
├── docker-compose.yml         # 本地 MySQL 8 单实例（可选）
├── scripts/
│   ├── init-db.js             # 执行 docs/design/schema.sql
│   ├── seed-demo.js           # 可选演示数据
│   ├── check-syntax.js        # 遍历 src/**/*.js 执行 node --check
│   ├── count-endpoints.js     # 统计实际注册端点数（对照 102）
│   ├── smoke-test.js          # 核心链路冒烟（真实 HTTP + MySQL）
│   ├── smoke-extra.js         # 扩展业务冒烟（依赖 smoke-test 数据）
│   └── smoke-admin.js         # 管理端/重判/防作弊冒烟（依赖前两轮数据）
├── tests/
│   └── grader.test.js         # 判分引擎单元验证（node 直接运行）
└── src/
    ├── app.js / server.js     # 应用装配 / 启动 + 超时交卷定时任务
    ├── config/                # env / db 连接池 / 枚举与错误码
    ├── routes/                # 11 个文件（10 业务域 + index）
    ├── controllers/           # 10 个控制器（只做取参与响应）
    ├── services/              # 11 个业务服务（事务与业务规则）
    ├── models/                # 11 个数据访问模块（参数化 SQL + 行映射）
    ├── middleware/            # auth / rbac / validate / audit / errorHandler / rateLimit / upload
    ├── validators/            # zod 模式 + 题型校验器
    └── utils/                 # response / errors / jwt / password / mask / pagination / excel / answering
```

> 设计文档明确采用「单体分层架构 + 前后端分离」（§3.1.1），因此各业务域以独立 service/model 模块实现，未拆分为独立进程。

## 3. 快速开始

### 3.1 准备环境

```bash
cd backend
cp .env.example .env      # Windows: copy .env.example .env
# 修改 .env 中的 DB_PASSWORD、JWT_SECRET、DB_ROOT_PASSWORD
npm install
```

关键环境变量：

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `PORT` | 服务端口 | 3000 |
| `DB_HOST/DB_PORT` | MySQL 地址 | 127.0.0.1:3306 |
| `DB_USER/DB_PASSWORD` | 应用账号（最小权限） | oes_app / oes_app_pwd |
| `DB_ROOT_USER/DB_ROOT_PASSWORD` | 仅 `db:init` 使用 | root / root_pwd |
| `JWT_SECRET` | HS256 密钥，生产 ≥32 字节随机串 | 开发占位值 |
| `JWT_EXPIRES_IN` | Access Token 有效期（秒） | 7200 |
| `JWT_REFRESH_EXPIRES_IN` | Refresh Token 有效期（秒） | 604800 |
| `BCRYPT_ROUNDS` | bcrypt 代价因子 | 10 |
| `BACKUP_DIR` | mysqldump 备份目录 | ./backups |

### 3.2 启动数据库

方式 A：Docker（推荐，需 Docker Desktop 正常）

```bash
docker compose up -d mysql
```

方式 B：本机 MySQL 8+

```sql
-- 使用 root 执行，或由 npm run db:init 自动创建
CREATE USER 'oes_app'@'%' IDENTIFIED BY 'oes_app_pwd';
GRANT ALL PRIVILEGES ON oes.* TO 'oes_app'@'%';
```

### 3.3 初始化库表

```bash
npm run db:init
```

脚本会执行 `docs/design/schema.sql`（**会重复 DROP 同名表，请勿在生产直接执行**），并输出表数量与种子账号。

### 3.4 启动服务

```bash
npm run dev     # node --watch
# 或
npm start
```

访问 `http://localhost:3000/api/v1/health` 验证数据库连通性。

### 3.5 默认账号（schema.sql 种子数据）

| 角色 | 用户名 | 密码 | 工作台 |
| --- | --- | --- | --- |
| 管理员 | `admin` | `Admin@2026` | `/admin/dashboard` |
| 教师 | `T2024001` | `Teacher@2026` | `/teacher/dashboard` |
| 学生 | `S2024001` | `Student@2026` | `/student/dashboard` |

> 首次部署后必须立即修改默认密码（`PUT /api/v1/auth/password`）。

## 4. 接口约定

- 统一前缀：`/api/v1`，共 **102** 个端点（与契约 §5.6 一致）。
- 统一响应：`{ "code": 0, "message": "ok", "data": ... }`；失败为 HTTP 状态码 + 5 位业务码。
- 分页：请求 `page`（≥1）、`pageSize`（1~100，默认 20）；响应 `{ list, total, page, pageSize }`。
- 字段：JSON 一律 lowerCamelCase，SQL 列一律 snake_case，在 model 层映射。
- 鉴权：`Authorization: Bearer <accessToken>`；公开接口为注册、登录、刷新、健康检查。
- 时间：数据库统一 UTC，接口输出 ISO-8601；`DATETIME(3)` + 连接会话 `time_zone='+00:00'`。
- 错误码：见 `src/config/constants.js` 中 `ERROR_CODES`（设计文档 §5.4 全量收录）。

模块端点分布：认证 7、用户与权限 14、知识点 4、题库与题目 15、试卷 12、考试 11、在线答题 8、阅卷 5、成绩与统计 13、系统管理 13。

## 5. 关键实现说明

1. **双层权限**：`authorize(permCode)` 基于 `sys_role_permission`（60s 缓存）；数据权限在 service/model 的 SQL 中强制附加 `owner_id` / `student_id` 条件。
2. **令牌失效**：改密、禁用、角色变更时 `token_version + 1` 并吊销全部 Refresh Token；认证中间件每次校验账号状态与版本。
3. **考试快照**：组卷/开考各固化 `question_snapshot`；判分只读答卷快照，不回查题库。
4. **取题脱敏**：`projectAttemptQuestion` 白名单投影 8 个字段，绝不输出 `correctAnswer / analysis / scoringPoints`。
5. **交卷幂等**：`UPDATE ... WHERE status='ongoing'` 条件更新 + 事务；重复提交返回首次结果 `replayed=true`。
6. **判分可重放**：先清零客观题再按快照重算，简答题保持人工分；总分 = Σ `final_score`。
7. **服务端计时**：`deadline_at = LEAST(UTC_TIMESTAMP + duration, exam.end_time)`，剩余秒数由 MySQL 计算，客户端时间不参与判定。
8. **审计**：敏感操作写 `sys_audit_log`，请求摘要对密码/令牌/答案脱敏；审计失败不阻断业务。
9. **事务边界**：交卷判分、组卷保存/复制/追加、批量导入、人工评分、重判、申诉改分均使用事务。
10. **超时交卷**：`server.js` 每 30 秒扫描超时进行中答卷并复用同一交卷逻辑（`submit_type=timeout`）。

## 6. 脚本与验证

```bash
npm run check        # node --check 全部 src/**/*.js
npm run endpoints    # 统计注册端点（应为 102）
npm test             # 判分引擎单元验证（17 个用例）
npm run smoke        # 核心链路端到端冒烟（自动启动 3101 端口）
npm run smoke:extra  # 扩展业务冒烟（需先执行 smoke，自动启动 3102 端口）
npm run smoke:admin  # 管理端/重判/防作弊冒烟（需先执行前两轮，自动启动 3103 端口）
npm run seed:demo    # 可选：补充演示教师/学生/共享题库
```

### 6.1 本次实际执行结果（2026-10-31）

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 依赖安装 | `npm install` | 成功，288 packages |
| 语法检查 | `npm run check` | `node --check: 68/68 passed` |
| 端点统计 | `npm run endpoints` | `registered endpoints: 102` |
| 判分单测 | `npm test` | `17/17 通过，0 失败` |
| 数据库初始化 | `npm run db:init` | `tables=31 (expected 31)`，种子账号 3 个 |
| 核心冒烟 | `npm run smoke` | `SMOKE TEST: ALL PASSED` |
| 扩展冒烟 | `npm run smoke:extra` | `EXTRA SMOKE TEST: ALL PASSED` |
| 管理端冒烟 | `npm run smoke:admin` | `ADMIN SMOKE TEST: ALL PASSED` |

环境说明：本机 Docker Desktop 守护进程返回 500（无法拉取 mysql:8.0.36），改用本机 **MySQL 9.1.0**（127.0.0.1:3306）完成真实数据库验证；`docker-compose.yml` 仍保留，Docker 正常时可直接使用。未伪造连通结果。

核心冒烟实际输出（节选）：

```
[1] health: {"status":"up","database":"connected","version":"1.0.0",...}
[4] question-banks: {"list":[{"id":1,"bankName":"计算机专业课程题库（2026 春）",...}],"total":1,...}
[8] available exam: {"id":2,"canStart":true,"remainingAttempts":1,"status":"published"}
[9] attempt session (sanitized): {"attemptId":1,"remainingSeconds":5399,...}
[10] sanitization assertion: PASS (no correctAnswer/analysis/scoringPoints)
[11] get questions sanitized: PASS
[13] save answers: {"savedAt":"...","savedCount":5,"remainingSeconds":5399}
[14] submit: {"status":"grading","objectiveScore":30,"totalScore":30,"pendingManualCount":1,...}
[15] idempotent replay: {"replayed":true,"totalScore":30,...}
[17] manual score: {"manualScore":15,"subjectiveScore":15,"totalScore":45,...}
[18] publish scores: {"scoreStatus":"published","notifiedCount":1}
[20] statistics: {"participantCount":1,"submittedCount":1,"avgScore":45,"passRate":100,...}
SMOKE TEST: ALL PASSED
```

管理端冒烟实际输出（节选）：

```
[4] 标准答案重判/留痕 PASS: {"affected":1,"changed":1,"logs":1}
[5] 防作弊/监控/补考/判分重放/仲裁 PASS: {"examId":3,"cheatCount":3,"abnormal":1,"attemptsAllowed":2,"arbitratedScore":18}
ADMIN SMOKE TEST: ALL PASSED
```

## 7. 契约缺口与实现说明（未修改 docs/design）

开发过程中发现契约/DDL 存在以下不一致或缺口，按「不修改设计文件、就近实现并记录」处理：

1. **图形验证码无获取接口**：`LoginRequest` 含 `captchaId/captchaCode` 且描述称生产必填，但契约无验证码签发端点。实现忽略两个字段；上线前需补充 `GET /auth/captcha` 与校验逻辑。
2. **注册与班级字典的鉴权矛盾**：`RegisterRequest.classId` 必填，而 `GET /classes` 需要登录，访客无法获取班级列表。当前登录后可查；建议为注册页提供公开班级字典或允许注册时按班级编码选择。
3. **权限点覆盖不完整**：69 个权限点未覆盖全部端点，以下接口采用就近权限或角色白名单：
   - `POST /users/{id}/reject` → `user.approve`
   - `GET/POST /classes` → 认证 / `requireRole('admin')`
   - `GET /roles`、`GET /permissions` → 认证
   - `POST /attempts/{id}/grade` → `requireRole('admin')`
   - `GET /appeals` → 认证（service 按角色过滤）
   - `PATCH /notifications/{id}/read` → `notification.read`
   - `POST/PUT/DELETE /papers/{id}/questions*` → `paper.update`
   - `GET /attempts/{id}/questions`、`/remaining-time` → `attempt.read`
   - `PUT/DELETE /notices/{id}` → `notice.manage`
   建议后续在 `sys_permission` 补齐 `user.reject`、`class.manage`、`attempt.grade`、`appeal.read` 等。
4. **双评/仲裁缺少开关参数**：契约提供双评字段与仲裁接口，但系统参数表无「是否双评」开关。实现默认**单评**（第一评即完成）；仲裁接口在任务处于 `arbitration/first_done` 时可用，管理员可直接裁定。若论文要求完整双评流程，建议新增 `grading.doubleReviewEnabled` 参数并在第二评后自动转仲裁。
5. **填空题判分口径冲突**：DDL 注释/§3.5.5 的阅卷任务 SQL 把 `fill` 纳入人工队列，但 §3.5.5 判分步骤与任务要求均为「客观题自动判分、简答题待复核」。实现采用**填空自动判分、简答人工复核**，测试已覆盖。
6. **追加题目无总分字段**：`PaperQuestionAddRequest` 只有题目与分值，但同时要求 Σ分值 = 试卷总分；追加必然改变总分。实现追加后自动将 `total_score` 更新为新的分值之和，并在响应 `scoreCheck` 中返回校验结果。
7. **`QuestionUpdateRequest` 语义**：契约以 `allOf QuestionCreateRequest` 复用，导致所有字段形式上都必填；但 PUT 编辑通常为部分更新。实现允许部分字段（未传字段沿用原值），`version` 作为乐观锁。
8. **提交宽限期参数未建表**：§3.5.4 提到 `exam.submitGraceSeconds`，DDL/种子参数无此项。实现使用常量 5 秒（`SUBMIT_GRACE_SECONDS`）。
9. **学生查看考试详情**：`GET /exams/{examId}` 未限定角色；实现要求学生必须在该考试任务名单中，否则 403，避免通过考试 ID 探测。
10. **备份依赖 `mysqldump`**：未安装时任务记录会置为 `failed` 并写明原因（不伪造成功）；`smoke:extra` 仅断言 202 受理。

## 8. 安全与运维注意事项

- 生产必须替换 `JWT_SECRET`、数据库密码与默认账号密码；`.env` 不进版本库。
- 生产由 Nginx 终止 HTTPS，Node 仅内网监听；`CORS_ORIGIN` 配置前端域名。
- 审计日志建议在数据库层限制应用账号为 INSERT-only（设计文档 §3.8.3）；本项目仅通过代码保证不 UPDATE/DELETE。
- 备份目录独立于数据目录，建议每日 02:00 定时执行并保留最近 7 份（`BACKUP_DIR`）。
- `npm run db:init` 会 DROP 表，仅用于开发/演示环境。