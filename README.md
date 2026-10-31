# 在线考试系统（Online Examination System）

本科毕业设计作品 · 华为 ICT 大赛 AI 赛题提交仓库

## 项目简介

面向高校场景的在线考试系统，采用前后端分离架构，覆盖「题库管理 → 组卷 → 考试发布 → 在线答题 → 自动阅卷 → 成绩统计」完整业务闭环。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 + Vite 5 + React Router 6 + Zustand + Axios |
| 后端 | Node.js 18+ / Express 4 / mysql2 / JWT(HS256) / bcrypt / zod |
| 数据库 | MySQL 8（31 张表） |
| 测试 | Jest 29 + Supertest（单元 / 集成 / 契约一致性） |

## 系统角色与核心功能

- **管理员**：用户与角色管理、系统参数、审计日志、考试监管、成绩仲裁
- **教师**：知识点与题库管理、手动/随机组卷、考试发布与监控、人工阅卷复核、成绩统计
- **学生**：查看可考考试、在线答题（服务端计时 / 答案暂存 / 断线恢复）、交卷、查看成绩与申诉

## 关键技术设计

1. **JWT + RBAC 双层权限**：功能权限 + 数据权限下沉到 SQL，未认证 401、越权 403
2. **服务端时间为唯一基准**：开考生成 attempt 并计算截止时间，前端每 30s 校准剩余时间
3. **交卷与判分幂等**：条件 UPDATE + 唯一索引，重复交卷返回 `replayed=true` 与首次一致结果
4. **考试快照三层**：题目版本 → 试卷快照 → 答卷快照，判分只读答卷快照
5. **题目脱敏**：学生链路白名单投影（9 字段），绝不返回正确答案与解析
6. **统一响应**：`{code, message, data}` + 5 位业务错误码，接口前缀 `/api/v1`

## 目录结构

```
backend/      Express 后端（routes / controllers / services / models / middleware）
frontend/     React 前端（26 页面 / 28 路由）
docs/         需求规格（53 REQ + 18 NFR）、系统设计（31 表 / 102 端点）、测试报告
thesis/       毕业论文（17,970 字，7 章，33 篇参考文献）
defense/      答辩 PPT 大纲、演示脚本、预测 Q&A
tests/        Jest + Supertest 测试工程（397 用例）
```

## 本地启动

```bash
# 1. 后端
cd backend
copy .env.example .env        # 填写 MySQL 连接与 JWT_SECRET
npm install
npm run db:init               # 执行 docs/design/schema.sql（会 DROP 并重建表）
npm run dev                   # http://localhost:3000

# 2. 前端
cd frontend
npm install
npm run dev                   # http://localhost:5173
```

## 测试账号

| 角色 | 账号 | 密码 |
|---|---|---|
| 管理员 | admin | Admin@2026 |
| 教师 | T2024001 | Teacher@2026 |
| 学生 | S2024001 | Student@2026 |

## 测试结果

- 单元 + 集成 + 契约一致性：**22 个套件 / 397 用例全部通过**
- 覆盖率：语句 **84.80%**、分支 **70.62%**、函数 **85.83%**、行 **84.80%**
- 缺陷闭环：5 个（1 高 / 2 中 / 2 低）全部修复并回归通过
- 详见 `docs/test-report.md`

## 说明

本仓库不含 `.env`（数据库密码、JWT 密钥等敏感配置）与 `node_modules`，首次运行请按 `.env.example` 自行生成配置。