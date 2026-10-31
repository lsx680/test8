# OES 在线考试系统 · 前端

React 18 + Vite 5 单页应用，覆盖「题库管理—组卷—考试发布—在线答题—自动判分—人工阅卷—成绩统计」全流程。
视觉策略为 **赛博朋克外壳 + 简洁内核**：登录/注册与三角色工作台使用深色霓虹（`#070a12` 底 + `#00f0ff → #a855f7 → #ff2d95` 渐变），题库、组卷、答题、阅卷、统计等业务页使用浅色高对比内核，霓虹仅作强调色。

> 前端严格依据 `docs/design/api-contract.yaml`（OpenAPI 3.0.3，102 个端点）实现，不使用任何 mock 数据；
> 后端不可用时页面展示明确的错误态与重试入口。

---

## 1. 技术栈与工程约束

| 项 | 选择 | 说明 |
| --- | --- | --- |
| 框架 | React 18.3 + Vite 5.4 | SPA，`react-router-dom` 6 懒加载路由 |
| 状态 | Zustand 4.5 | `authStore`（令牌/用户/角色）、`uiStore`（toast） |
| 请求 | Axios 1.7 | 实例 + 请求/响应拦截器，统一解包 `{code,message,data}` |
| 样式 | 原生 CSS + CSS 变量 | 不使用 Tailwind / UI 框架；设计 token 集中于 `src/styles/tokens.css` |
| 图表 | 原生 SVG | 分数段柱状图零依赖自绘（`components/BarChart.jsx`） |
| 语言 | JavaScript + JSX | 目录与文件命名与设计文档一致 |

---

## 2. 快速开始

```bash
cd frontend
npm install

# 配置后端地址（默认 http://localhost:3000/api/v1）
cp .env.example .env

npm run dev      # 开发：http://localhost:5173
npm run build    # 生产构建：输出 dist/
npm run preview  # 预览构建产物：http://localhost:4173
```

- `VITE_API_BASE_URL` 未配置时默认使用 `http://localhost:3000/api/v1`。
- `vite.config.js` 同时把 `/api` 代理到 `http://localhost:3000`，可切换为相对路径 `/api/v1`。
- 依赖版本已在 `package.json` 中锁定；构建目标 `es2020`，无外部字体/CDN 依赖。

---

## 3. 演示账号

账号来自后端 `docs/design/schema.sql` 的初始化数据（前端不硬编码任何账号）：

| 角色 | 登录名 | 初始密码 | 工作台 |
| --- | --- | --- | --- |
| 管理员 | `admin` | `Admin@2026` | `/admin/dashboard` |
| 教师 | `T2024001` | `Teacher@2026` | `/teacher/dashboard` |
| 学生 | `S2024001` | `Student@2026` | `/student/dashboard` |

> 首次部署后应立即修改默认密码。学生自主注册的账号需管理员审核通过后才能登录（REQ-UAM-06）。

---

## 4. 页面地图（26 个页面文件 / 28 条路由）

### 公开

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/login` | `pages/auth/Login.jsx` | 登录，已登录按角色跳转工作台 |
| `/register` | `pages/auth/Register.jsx` | 学生注册申请，提交后状态为待审核 |
| `/403`、`/500` | `pages/common/Forbidden.jsx` | 权限不足 / 服务异常 |
| `/404` | `pages/common/NotFound.jsx` | 路由未匹配 |

### 管理员（`AdminLayout`，RequireRole admin）

| 路由 | 页面 | 对应需求 |
| --- | --- | --- |
| `/admin/dashboard` | `admin/Dashboard.jsx` | 治理看板（账号、待审核、考试、审计、健康检查） |
| `/admin/users` | `admin/Users.jsx` | REQ-UAM-05/06/08/09：账号 CRUD、注册审批、角色调整、禁用、重置密码 |
| `/admin/roles` | `admin/Roles.jsx` | REQ-UAM-08：角色定义与权限点字典 |
| `/admin/knowledge-points` | `admin/KnowledgePoints.jsx` | REQ-QBM-07：两级知识点维护与归档 |
| `/admin/supervision` | `admin/Supervision.jsx` | 权限矩阵第 11/12/17 项：考试与试卷只读监管、监控与异常答卷 |
| `/admin/arbitration` | `admin/Arbitration.jsx` | REQ-MRK-04：双评争议仲裁 |
| `/admin/configs` | `admin/Config.jsx` | REQ-SYS-01：系统参数配置 |
| `/admin/audit-logs` | `admin/AuditLogs.jsx` | REQ-SYS-03：审计日志检索与导出 |

### 教师（`TeacherLayout`，RequireRole teacher）

| 路由 | 页面 | 对应需求 |
| --- | --- | --- |
| `/teacher/dashboard` | `teacher/Dashboard.jsx` | 教学数据概览与待办 |
| `/teacher/questions` | `teacher/QuestionBank.jsx` | REQ-QBM-01~06：题库/题目、批量导入、导出、删除保护 |
| `/teacher/questions/new`、`/teacher/questions/:id/edit` | `teacher/QuestionEdit.jsx` | 题目编辑、版本历史、乐观锁 |
| `/teacher/papers` | `teacher/PaperList.jsx` | REQ-PPM-03/05/06/07：预览、复制、锁定、删除 |
| `/teacher/papers/new`、`/teacher/papers/:id/edit` | `teacher/PaperCompose.jsx` | REQ-PPM-01/02/03：手动组卷、规则化随机组卷、分值校验、缺口提示 |
| `/teacher/exams` | `teacher/ExamList.jsx` | REQ-EXM-01/02/09/10：发布、监控、考生任务、补考授权、状态变更 |
| `/teacher/exams/new`、`/teacher/exams/:id/edit` | `teacher/ExamEdit.jsx` | 创建/编辑考试、窗口与时长校验、参考班级 |
| `/teacher/reviews` | `teacher/ReviewList.jsx` | REQ-MRK-02/03/05/06：主观题逐题评分、评语、申诉处理 |
| `/teacher/stats` | `teacher/Stats.jsx` | REQ-STA-02~06：指标、分数段柱状图、题目分析、知识点失分、发布与导出 |

### 学生（`StudentLayout`，RequireRole student）

| 路由 | 页面 | 对应需求 |
| --- | --- | --- |
| `/student/dashboard` | `student/Dashboard.jsx` | 待考考试、最近成绩 |
| `/student/exams` | `student/ExamList.jsx` | REQ-EXM-03/04：可参加考试、考前须知、二次确认开考 |
| `/student/attempts/:attemptId` | `student/ExamTaking.jsx` | **独立全屏布局**：服务端计时、3s 暂存、答题卡、超时自动交卷、防作弊采集 |
| `/student/results` | `student/ResultList.jsx` | REQ-STA-01/05：成绩列表（未发布显示"评阅中"）、本人成绩单导出 |
| `/student/results/:attemptId` | `student/ResultDetail.jsx` | 逐题得分、标准答案、解析、教师评语、REQ-MRK-05 复核申诉 |

---

## 5. 关键实现机制

### 5.1 API 封装（`src/api/`）

| 文件 | 端点数量 | 内容 |
| --- | --- | --- |
| `http.js` | — | Axios 实例、token 注入、响应解包、401 刷新重放、403 跳转、错误码建议映射 |
| `auth.js` | 7 | 注册、登录、刷新、登出、当前用户、资料、改密 |
| `users.js` | 14 | 用户、待审核、状态、角色、重置密码、角色/权限点、班级 |
| `knowledge.js` | 4 | 知识点树 CRUD 与状态 |
| `questions.js` | 15 | 题库 CRUD/授权、题目 CRUD、版本、引用、导入导出、重判 |
| `papers.js` | 12 | 试卷 CRUD、随机组卷、题目管理、预览、复制、状态 |
| `exams.js` | 11 | 考试 CRUD、发布、状态、任务、补考授权、监控、防作弊 |
| `attempts.js` | 8 | 开考、恢复、取题、剩余时间、暂存、事件上报、交卷、重判 |
| `reviews.js` | 5 | 阅卷队列、详情、评分、仲裁、进度 |
| `stats.js` | 13 | 个人成绩、成绩表、发布、统计、题目分析、趋势、知识点、申诉 |
| `audit.js` | 13 | 参数、审计、公告、通知、备份、健康检查 |
| **合计** | **102** | 与契约 `operationId` 一一对应 |

**拦截器约定**

1. `baseURL` ← `VITE_API_BASE_URL`。
2. 请求注入 `Authorization: Bearer <accessToken>`；Access Token 仅存内存（模块变量），Refresh Token 存 `localStorage`。
3. 响应 `code === 0` 直接返回 `data`；非 0 抛 `ApiError`（含 `code/errors/data`），并统一 toast。
4. 401 且非认证端点：串行调用 `POST /auth/refresh` 轮换令牌并**重放一次**；失败清空会话跳 `/login?redirect=...`。
5. 403：跳转 `/403`（登录页除外）。
6. 文件下载使用 `responseType: 'blob'`，绕开响应解包。
7. 错误提示按契约错误码追加下一步建议（如 `40108 → 作答次数已用尽，请联系任课教师申请补考授权`）。

### 5.2 路由守卫（`src/router/guards.jsx`）

- `RequireAuth`：未登录跳 `/login?redirect=当前路径`；
- `RequireRole`：角色不匹配跳 `/403`；
- `RedirectIfAuthed`：已登录访问登录/注册页时回到对应工作台；
- 启动时 `AuthBootstrap` 用 Refresh Token 换新令牌并拉取 `/auth/me`，避免刷新页面掉登录；
- 守卫仅作体验层拦截，真正的权限校验在服务端（需求 §3.3 第 4 条）。

### 5.3 在线答题（`pages/student/ExamTaking.jsx`）

| 机制 | 实现 |
| --- | --- |
| 服务端权威计时 | `recoverAttempt` 返回 `serverTime/deadlineAt/remainingSeconds`，计算 `offset = serverTime - clientNow`；本地按 `deadlineAt - (now + offset)` 每秒渲染；每 30s 调 `GET /remaining-time` 校准 |
| 答案自动暂存 | 修改答案后 3s 防抖 `PUT /attempts/{id}/answers`；切题立即 flush；失败保留 dirty 队列并 3s 后重试，不阻断答题 |
| 答题卡 | 题号网格标记已答/未答/当前题，支持跳转 |
| 交卷 | 二次确认弹窗展示未答题号与数量；交卷前等待进行中的暂存并强制 flush；服务端幂等 |
| 超时自动交卷 | 剩余秒数归零或校准返回 `shouldAutoSubmit` 时调用 `submitType=timeout`，展示自动交卷提示 |
| 防作弊 | `visibilitychange / blur / copy / cut / paste / fullscreenchange` 统一上报，同类事件 2s 节流，失败静默重试一次 |
| 断线恢复 | 刷新或重进同一路由调用 `GET /attempts/{id}` 恢复剩余时间与已存答案 |
| 刷新保护 | `beforeunload` 提示，卸载前尽力保存一次未同步答案 |

### 5.4 阅卷与统计

- 阅卷工作台：队列（按考试/状态筛选）→ 详情（考生答案与参考答案并排）→ 打分/采分点/评语 → 提交后实时回写总分并刷新进度。
- 统计页：指标卡（应考/实考、平均分、最高最低、及格率、优秀率）→ SVG 分数段柱状图 → 题目质量表（正确率/难度系数/区分度/异常标记）→ 知识点失分条 → 成绩列表（分页、排序、导出、发布）。

### 5.5 设计 token（`src/styles/tokens.css`）

- 外壳：`--oe-bg #070a12`、`--oe-surface #0d1424`、`--oe-neon-cyan #00f0ff`、`--oe-neon-violet #a855f7`、`--oe-neon-magenta #ff2d95`、`--oe-gradient-brand`。
- 内核：`--oe-core-bg #f4f7fb`、`--oe-core-text #0f172a`、`--oe-core-muted #52627a`，强调色使用低饱和版本保证 ≥4.5:1 对比度。
- 形状与节奏：圆角 6/12/20px、间距 4~64px、字阶 12~44px、过渡 180ms。
- 动效遵循 `prefers-reduced-motion: reduce`，所有动画降级为静态。

---

## 6. 已知契约缺口（前端适配说明，未修改 docs/）

| # | 缺口 | 前端处理 |
| --- | --- | --- |
| 1 | `LoginRequest` 含 `captchaId/captchaCode`（描述生产必填），但契约未定义验证码下发端点 | 登录页不渲染验证码控件，仅提交用户名/密码 |
| 2 | `RegisterRequest.classId` 必填，而 `GET /classes` 需要 JWT | 公开注册页尝试拉取班级；失败时允许手工输入班级编号并提示联系管理员 |
| 3 | 工作台布局未接入站内通知与公告（任务页面清单未要求，相关接口已封装） | 顶栏不展示通知红点；`api/audit.js` 保留 notifications / notices / backups 能力 |
| 4 | `ExamScope.studentIds` 需学生名单，但 `GET /users` 仅管理员可用 | 教师创建考试仅按班级指定范围；补考授权需手工输入学生 ID |
| 5 | `AttemptSession` / `AttemptQuestion` 未返回 `antiCheatEnabled`、阈值、填空题空格数 | 防作弊默认全量采集（服务端可按考试配置忽略）；填空题默认 1 空并提供"添加空" |
| 6 | `AnswerItem.answerVersion` 为可选乐观锁字段，但取题响应未下发版本号 | 暂存不发送 `answerVersion`，规避必然 409；保存失败走 dirty 重试 |
| 7 | 契约无「角色 → 权限点」映射查询端点 | 管理员角色页仅展示角色定义与权限点字典，不伪造映射 |
| 8 | 契约无 dashboard 聚合端点 | 工作台以各列表接口 `pageSize=1` 读取 `total` 组合展示，任一失败显示"不可用" |
| 9 | `GradingTaskPage.pendingCount` 语义为当前筛选下待阅数，未提供全局统计端点 | 阅卷页以列表 total 展示待办量 |
| 10 | **后端比例字段**（`submitRate/passRate/excellentRate/correctRate/avgScoreRate/lostRate/completionRate/onlineRate`）实际返回 **0~100 的百分数**，契约未注明取值范围 | 前端按后端实现直接展示（已核对 `backend/stat.model.js`、`grading.service.js`、`exam.service.js`）；若契约后续统一为 0~1 需同步调整 |
| 11 | 后端 `PUT /exams/{id}` 对已发布/进行中考试仅接受 `startTime/endTime/description/antiCheatEnabled/antiCheatThreshold`，其余字段返回 40111；契约未列出该白名单 | 编辑已发布考试时锁定名称、试卷、时长、及格线、次数与参考范围，保存时仅提交白名单字段 |
| 12 | 后端分数段分布以 `passScore` 为基数划分（`passScore*0.9` 等），标签固定为 `90-100/80-89/...`，与试卷满分口径可能不一致 | 前端按接口原样展示 `range` 与 `count`，不自行换算；建议后端改用试卷总分作为基数 |
| 13 | 后端登录校验中 `captchaId/captchaCode` 为可选，且契约未提供验证码下发端点 | 前端不发送验证码，与后端实际实现兼容 |
| 14 | 后端 `attemptNo` 为 UUID（非可读短编号），契约示例未定义格式 | 前端原样展示；如需短号建议后端生成可读编号 |
| 15 | 后端 `PATCH /exams/{id}/status` 归档仅管理员可执行（教师返回 90301），契约未说明角色差异 | 教师端状态变更仅提供"取消/提前结束"，不展示归档入口 |

> 以上均在前端做了显式降级与提示，不修改 `docs/design/` 与 `backend/`。

---

## 7. 目录结构

```
frontend/
├── index.html
├── package.json
├── vite.config.js
├── .env.example
└── src/
    ├── main.jsx / App.jsx
    ├── api/          # http.js + 10 个业务模块（102 端点）
    ├── store/        # authStore / uiStore
    ├── router/       # index.jsx / guards.jsx
    ├── layouts/      # AuthLayout / ShellLayout / Admin / Teacher / Student
    ├── components/   # Button、Table、Modal、Form、Pagination、Tag、StatCard、
    │                 # Countdown、QuestionEditor、BarChart、Loading、Empty、
    │                 # ErrorState、PageHeader、Toast
    ├── hooks/        # useFetch / usePaginated
    ├── pages/        # auth / admin / teacher / student / common
    ├── styles/       # tokens.css、global.css、cyber.css、core.css
    └── utils/        # format / enums / validate
```

---

## 8. 构建与验证

```bash
npm install        # 90 packages
npm run build      # ✓ built in ~1s，产物 dist/（约 648 KB，主包 gzip 91.5 KB）
```

构建产物按路由懒加载分包：登录/注册、三角色页面各自独立 chunk，首屏仅加载主包与登录页。