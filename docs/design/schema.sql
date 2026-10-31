-- =====================================================================
--  在线考试系统（OES - Online Examination System）数据库建表脚本
-- ---------------------------------------------------------------------
--  文件     ：docs/design/schema.sql
--  版本     ：V1.0
--  编写人   ：陈工（系统架构师）
--  编写日期 ：2026-10-31
--  目标库   ：MySQL 8.0.16+（CHECK 约束要求 8.0.16 及以上）
--  字符集   ：utf8mb4 / utf8mb4_0900_ai_ci
--  存储引擎 ：InnoDB
--  上游依据 ：docs/requirements/需求规格说明书.md V1.0（REQ-* / NFR-*）
--             docs/requirements/需求追踪矩阵.md V1.0（§1.8 章节约定）
--  设计说明 ：详见 docs/design/系统设计文档.md §4
-- ---------------------------------------------------------------------
--  【重要】脚本可重复执行：开头会 DROP 同名表。生产环境执行前请先备份！
--  【命名】表名 = 模块前缀 + 业务名；字段 snake_case；索引 uk_ / idx_ / fk_
--         模块前缀：sys=系统管理 kb=知识库 qb=题库 pp=试卷 ex=考试 mk=阅卷 st=统计
--  【时间】统一 DATETIME(3)，数据库以 UTC 存储，展示时由应用层转 Asia/Shanghai
--  【删除】核心业务数据只做软删除（status / deleted_at），不物理删除
-- =====================================================================

CREATE DATABASE IF NOT EXISTS `oes`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_0900_ai_ci;

USE `oes`;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- 0. 清理旧表（逆依赖顺序）
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS `st_knowledge_stat`;
DROP TABLE IF EXISTS `st_question_stat`;
DROP TABLE IF EXISTS `st_exam_stat`;
DROP TABLE IF EXISTS `mk_score_appeal`;
DROP TABLE IF EXISTS `mk_grade_change_log`;
DROP TABLE IF EXISTS `mk_grading_task`;
DROP TABLE IF EXISTS `ex_anti_cheat_event`;
DROP TABLE IF EXISTS `ex_attempt_question`;
DROP TABLE IF EXISTS `ex_exam_attempt_grant`;
DROP TABLE IF EXISTS `ex_exam_attempt`;
DROP TABLE IF EXISTS `ex_exam_task`;
DROP TABLE IF EXISTS `ex_exam_scope`;
DROP TABLE IF EXISTS `ex_exam`;
DROP TABLE IF EXISTS `pp_paper_question`;
DROP TABLE IF EXISTS `pp_paper`;
DROP TABLE IF EXISTS `qb_question_version`;
DROP TABLE IF EXISTS `qb_question`;
DROP TABLE IF EXISTS `qb_bank_authorization`;
DROP TABLE IF EXISTS `qb_question_bank`;
DROP TABLE IF EXISTS `kb_knowledge_point`;
DROP TABLE IF EXISTS `sys_backup_record`;
DROP TABLE IF EXISTS `sys_notification`;
DROP TABLE IF EXISTS `sys_notice`;
DROP TABLE IF EXISTS `sys_audit_log`;
DROP TABLE IF EXISTS `sys_config`;
DROP TABLE IF EXISTS `sys_refresh_token`;
DROP TABLE IF EXISTS `sys_role_permission`;
DROP TABLE IF EXISTS `sys_permission`;
DROP TABLE IF EXISTS `sys_role`;
DROP TABLE IF EXISTS `sys_user`;
DROP TABLE IF EXISTS `sys_class`;

-- =====================================================================
-- 1. 系统管理域（sys_*）
-- =====================================================================

-- 1.1 班级：考试参考范围与成绩班级维度的基础字典（REQ-EXM-01、REQ-STA-04）
CREATE TABLE `sys_class` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '班级ID',
  `class_code`      VARCHAR(32)     NOT NULL                COMMENT '班级编码，如 CS2024-01',
  `class_name`      VARCHAR(64)     NOT NULL                COMMENT '班级名称',
  `grade_year`      SMALLINT UNSIGNED NOT NULL DEFAULT 2024 COMMENT '年级（入学年）',
  `department`      VARCHAR(64)     DEFAULT NULL            COMMENT '院系',
  `head_teacher_id` BIGINT UNSIGNED DEFAULT NULL            COMMENT '班主任/任课教师ID（逻辑外键 -> sys_user.id，避免与 sys_user.class_id 形成建表循环依赖）',
  `status`          TINYINT         NOT NULL DEFAULT 1      COMMENT '状态：1=启用 0=停用',
  `created_at`      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间(UTC)',
  `updated_at`      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间(UTC)',
  `deleted_at`      DATETIME(3)     DEFAULT NULL            COMMENT '软删除时间，NULL 表示未删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_class_code` (`class_code`),
  KEY `idx_class_status` (`status`),
  KEY `idx_head_teacher` (`head_teacher_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='班级';

-- 1.2 用户：三角色统一账号表（REQ-UAM-01、REQ-UAM-05、REQ-UAM-06、REQ-UAM-09）
--     密码一律 bcrypt(cost>=10) 哈希，禁止明文；token_version 用于令牌批量失效
CREATE TABLE `sys_user` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '用户ID',
  `username`            VARCHAR(32)     NOT NULL                COMMENT '登录名：学生=学号，教师=工号，管理员=自定义（全局唯一）',
  `password_hash`       VARCHAR(72)     NOT NULL                COMMENT 'bcrypt 加盐哈希（$2b$10$...），代价因子>=10，禁止明文',
  `real_name`           VARCHAR(64)     NOT NULL                COMMENT '真实姓名',
  `email`               VARCHAR(128)    DEFAULT NULL            COMMENT '邮箱',
  `phone`               VARCHAR(32)     DEFAULT NULL            COMMENT '手机号',
  `role_code`           VARCHAR(16)     NOT NULL DEFAULT 'student' COMMENT '角色：admin/teacher/student',
  `class_id`            BIGINT UNSIGNED DEFAULT NULL            COMMENT '所属班级（学生必填）',
  `department`          VARCHAR(64)     DEFAULT NULL            COMMENT '部门/院系（教师填写）',
  `status`              VARCHAR(16)     NOT NULL DEFAULT 'pending' COMMENT '状态：pending=待审核 active=正常 disabled=禁用 locked=锁定',
  `register_channel`    VARCHAR(16)     NOT NULL DEFAULT 'admin' COMMENT '来源：admin=管理员创建 self=自主注册',
  `failed_attempts`     TINYINT UNSIGNED NOT NULL DEFAULT 0     COMMENT '连续登录失败次数（15 分钟窗口内）',
  `locked_until`        DATETIME(3)     DEFAULT NULL            COMMENT '账号锁定截止时间，NULL 表示未锁定',
  `token_version`       INT UNSIGNED    NOT NULL DEFAULT 1      COMMENT '令牌版本号：改密/禁用时 +1，使旧 JWT 立即失效',
  `password_changed_at` DATETIME(3)     DEFAULT NULL            COMMENT '最近一次改密时间',
  `last_login_at`       DATETIME(3)     DEFAULT NULL            COMMENT '最近登录时间',
  `last_login_ip`       VARCHAR(45)     DEFAULT NULL            COMMENT '最近登录IP（兼容IPv6）',
  `remark`              VARCHAR(255)    DEFAULT NULL            COMMENT '备注（如禁用原因）',
  `created_by`          BIGINT UNSIGNED DEFAULT NULL            COMMENT '创建人ID（逻辑外键 -> sys_user.id）',
  `created_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间(UTC)',
  `updated_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间(UTC)',
  `deleted_at`          DATETIME(3)     DEFAULT NULL            COMMENT '软删除时间，NULL 表示未删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_username` (`username`),
  UNIQUE KEY `uk_user_email` (`email`),
  KEY `idx_user_role_status` (`role_code`, `status`),
  KEY `idx_user_class` (`class_id`),
  KEY `idx_user_created` (`created_at`),
  CONSTRAINT `ck_user_role` CHECK (`role_code` IN ('admin','teacher','student')),
  CONSTRAINT `ck_user_status` CHECK (`status` IN ('pending','active','disabled','locked')),
  CONSTRAINT `fk_user_class` FOREIGN KEY (`class_id`) REFERENCES `sys_class` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='用户账号';

-- 1.3 角色（RBAC）（REQ-UAM-08）
CREATE TABLE `sys_role` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '角色ID',
  `role_code`   VARCHAR(16)     NOT NULL                COMMENT '角色编码：admin/teacher/student',
  `role_name`   VARCHAR(32)     NOT NULL                COMMENT '角色名称',
  `description` VARCHAR(255)    DEFAULT NULL            COMMENT '角色说明',
  `is_builtin`  TINYINT         NOT NULL DEFAULT 1      COMMENT '是否内置角色：1=是（不可删除）',
  `created_at`  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间(UTC)',
  `updated_at`  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_role_code` (`role_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='角色';

-- 1.4 权限点（接口级功能权限，服务端鉴权依据）（REQ-UAM-08、NFR-07）
CREATE TABLE `sys_permission` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '权限点ID',
  `perm_code`    VARCHAR(64)     NOT NULL                COMMENT '权限编码，如 question:create',
  `perm_name`    VARCHAR(64)     NOT NULL                COMMENT '权限名称',
  `module`       VARCHAR(32)     NOT NULL                COMMENT '所属模块：uam/qbm/ppm/exm/mrk/sta/sys',
  `http_method`  VARCHAR(16)     DEFAULT NULL            COMMENT 'HTTP 方法（提示用，鉴权以实现为准）',
  `path_pattern` VARCHAR(255)    DEFAULT NULL            COMMENT '接口路径模式，如 /api/v1/questions/:id',
  `description`  VARCHAR(255)    DEFAULT NULL            COMMENT '权限说明',
  `created_at`   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_perm_code` (`perm_code`),
  KEY `idx_perm_module` (`module`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='权限点';

-- 1.5 角色-权限映射（RBAC 关联表）（REQ-UAM-08）
CREATE TABLE `sys_role_permission` (
  `role_id`       BIGINT UNSIGNED NOT NULL COMMENT '角色ID',
  `permission_id` BIGINT UNSIGNED NOT NULL COMMENT '权限点ID',
  `created_at`    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '授权时间(UTC)',
  PRIMARY KEY (`role_id`, `permission_id`),
  KEY `idx_rp_permission` (`permission_id`),
  CONSTRAINT `fk_rp_role` FOREIGN KEY (`role_id`) REFERENCES `sys_role` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_rp_permission` FOREIGN KEY (`permission_id`) REFERENCES `sys_permission` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='角色权限映射';

-- 1.6 刷新令牌白名单（令牌轮换与吊销）（REQ-UAM-03、REQ-UAM-04、REQ-UAM-07）
--     仅存 SHA-256 摘要，避免数据库泄露后令牌被直接使用
CREATE TABLE `sys_refresh_token` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '令牌记录ID',
  `user_id`       BIGINT UNSIGNED NOT NULL                COMMENT '用户ID',
  `jti`           CHAR(36)        NOT NULL                COMMENT '令牌唯一标识（UUID）',
  `token_hash`    CHAR(64)        NOT NULL                COMMENT 'Refresh Token 的 SHA-256 摘要（32字节十六进制）',
  `issued_at`     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '签发时间(UTC)',
  `expires_at`    DATETIME(3)     NOT NULL                COMMENT '过期时间(UTC)',
  `revoked_at`    DATETIME(3)     DEFAULT NULL            COMMENT '吊销时间，NULL 表示有效',
  `revoke_reason` VARCHAR(64)     DEFAULT NULL            COMMENT '吊销原因：logout/rotated/password_changed/disabled',
  `ip`            VARCHAR(45)     DEFAULT NULL            COMMENT '签发IP',
  `user_agent`    VARCHAR(255)    DEFAULT NULL            COMMENT '客户端标识（用于多端登录检测）',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_rt_jti` (`jti`),
  UNIQUE KEY `uk_rt_token_hash` (`token_hash`),
  KEY `idx_rt_user_valid` (`user_id`, `revoked_at`, `expires_at`),
  CONSTRAINT `fk_rt_user` FOREIGN KEY (`user_id`) REFERENCES `sys_user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='刷新令牌白名单';

-- 1.7 系统参数（REQ-SYS-01）
CREATE TABLE `sys_config` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '参数ID',
  `config_key`   VARCHAR(64)     NOT NULL                COMMENT '参数键，如 exam.defaultDuration',
  `config_value` TEXT            NOT NULL                COMMENT '参数值（统一以字符串存储，按 value_type 解析）',
  `value_type`   VARCHAR(16)     NOT NULL DEFAULT 'string' COMMENT '值类型：number/string/boolean/json',
  `config_group` VARCHAR(32)     NOT NULL DEFAULT 'general' COMMENT '分组：exam/security/grading/system',
  `description`  VARCHAR(255)    DEFAULT NULL            COMMENT '参数说明',
  `is_editable`  TINYINT         NOT NULL DEFAULT 1      COMMENT '是否允许管理员在线修改',
  `updated_by`   BIGINT UNSIGNED DEFAULT NULL            COMMENT '最后修改人',
  `created_at`   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间(UTC)',
  `updated_at`   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_config_key` (`config_key`),
  KEY `idx_config_group` (`config_group`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='系统参数';

-- 1.8 审计日志（REQ-SYS-02、REQ-SYS-03、NFR-09）
--     不建外键：日志需长期保留且不可因用户删除而失效；仅管理员可读
CREATE TABLE `sys_audit_log` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '日志ID',
  `user_id`         BIGINT UNSIGNED DEFAULT NULL            COMMENT '操作人ID（匿名登录失败时为空）',
  `username`        VARCHAR(32)     DEFAULT NULL            COMMENT '操作人登录名快照',
  `role_code`       VARCHAR(16)     DEFAULT NULL            COMMENT '操作人角色快照',
  `module`          VARCHAR(32)     NOT NULL                COMMENT '模块：uam/qbm/ppm/exm/mrk/sta/sys',
  `action`          VARCHAR(64)     NOT NULL                COMMENT '动作编码，如 auth.login / grade.publish',
  `http_method`     VARCHAR(16)     DEFAULT NULL            COMMENT 'HTTP 方法',
  `path`            VARCHAR(255)    DEFAULT NULL            COMMENT '请求路径',
  `ip`              VARCHAR(45)     DEFAULT NULL            COMMENT '来源IP',
  `user_agent`      VARCHAR(255)    DEFAULT NULL            COMMENT 'User-Agent',
  `request_summary` TEXT            DEFAULT NULL            COMMENT '请求摘要（已脱敏，禁止写入密码/令牌）',
  `result`          VARCHAR(16)     NOT NULL DEFAULT 'success' COMMENT '结果：success/failure',
  `error_code`      VARCHAR(32)     DEFAULT NULL            COMMENT '失败时的业务错误码',
  `duration_ms`     INT UNSIGNED    DEFAULT NULL            COMMENT '处理耗时(ms)',
  `created_at`      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '发生时间(UTC)',
  PRIMARY KEY (`id`),
  KEY `idx_audit_created` (`created_at`),
  KEY `idx_audit_user` (`user_id`, `created_at`),
  KEY `idx_audit_action` (`action`, `created_at`),
  KEY `idx_audit_module` (`module`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='操作审计日志';

-- 1.9 系统公告（REQ-SYS-04）
CREATE TABLE `sys_notice` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '公告ID',
  `title`       VARCHAR(128)    NOT NULL                COMMENT '公告标题',
  `content`     TEXT            NOT NULL                COMMENT '公告正文',
  `target_role` VARCHAR(16)     NOT NULL DEFAULT 'all'  COMMENT '目标角色：all/admin/teacher/student',
  `status`      VARCHAR(16)     NOT NULL DEFAULT 'draft' COMMENT '状态：draft=草稿 published=已发布 offline=已下线',
  `publish_at`  DATETIME(3)     DEFAULT NULL            COMMENT '发布时间',
  `expire_at`   DATETIME(3)     DEFAULT NULL            COMMENT '失效时间',
  `created_by`  BIGINT UNSIGNED DEFAULT NULL            COMMENT '发布人',
  `created_at`  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间(UTC)',
  `updated_at`  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间(UTC)',
  `deleted_at`  DATETIME(3)     DEFAULT NULL            COMMENT '软删除时间',
  PRIMARY KEY (`id`),
  KEY `idx_notice_status_role` (`status`, `target_role`, `publish_at`),
  CONSTRAINT `ck_notice_role` CHECK (`target_role` IN ('all','admin','teacher','student'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='系统公告';

-- 1.10 站内通知（REQ-EXM-02、REQ-EXM-10、REQ-MRK-05）
CREATE TABLE `sys_notification` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '通知ID',
  `user_id`    BIGINT UNSIGNED NOT NULL                COMMENT '接收人ID',
  `title`      VARCHAR(128)    NOT NULL                COMMENT '通知标题',
  `content`    VARCHAR(1000)   DEFAULT NULL            COMMENT '通知内容',
  `notice_type` VARCHAR(32)    NOT NULL DEFAULT 'system' COMMENT '类型：exam_publish/exam_change/score_publish/appeal/notice/system',
  `biz_type`   VARCHAR(32)     DEFAULT NULL            COMMENT '关联业务类型：exam/attempt/appeal/notice',
  `biz_id`     BIGINT UNSIGNED DEFAULT NULL            COMMENT '关联业务ID',
  `is_read`    TINYINT         NOT NULL DEFAULT 0      COMMENT '是否已读：0=未读 1=已读',
  `read_at`    DATETIME(3)     DEFAULT NULL            COMMENT '阅读时间',
  `created_at` DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间(UTC)',
  PRIMARY KEY (`id`),
  KEY `idx_notify_user_read` (`user_id`, `is_read`, `created_at`),
  CONSTRAINT `fk_notify_user` FOREIGN KEY (`user_id`) REFERENCES `sys_user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='站内通知';

-- 1.11 备份记录（REQ-SYS-05）
CREATE TABLE `sys_backup_record` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '备份记录ID',
  `file_name`    VARCHAR(255)    NOT NULL                COMMENT '备份文件名',
  `file_path`    VARCHAR(500)    NOT NULL                COMMENT '备份文件绝对路径（服务端独立目录）',
  `file_size`    BIGINT UNSIGNED DEFAULT NULL            COMMENT '文件大小(字节)',
  `trigger_type` VARCHAR(16)     NOT NULL DEFAULT 'auto' COMMENT '触发方式：auto=定时 manual=手动',
  `status`       VARCHAR(16)     NOT NULL DEFAULT 'running' COMMENT '状态：running/success/failed',
  `table_count`  INT UNSIGNED    DEFAULT NULL            COMMENT '备份表数量',
  `row_count`    BIGINT UNSIGNED DEFAULT NULL            COMMENT '备份行数估算',
  `started_at`   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '开始时间',
  `finished_at`  DATETIME(3)     DEFAULT NULL            COMMENT '结束时间',
  `operator_id`  BIGINT UNSIGNED DEFAULT NULL            COMMENT '操作人（自动备份为空）',
  `remark`       VARCHAR(500)    DEFAULT NULL            COMMENT '备注/失败原因',
  PRIMARY KEY (`id`),
  KEY `idx_backup_started` (`started_at`),
  KEY `idx_backup_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='数据备份记录';

-- =====================================================================
-- 2. 知识库与题库域（kb_* / qb_*）
-- =====================================================================

-- 2.1 知识点（两级分类，仅管理员维护）（REQ-QBM-07）
CREATE TABLE `kb_knowledge_point` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '知识点ID',
  `kp_code`        VARCHAR(32)     NOT NULL                COMMENT '知识点编码，如 KP-CS-DS-01',
  `kp_name`        VARCHAR(64)     NOT NULL                COMMENT '知识点名称',
  `parent_id`      BIGINT UNSIGNED DEFAULT NULL            COMMENT '父级知识点ID（NULL 表示一级）',
  `level`          TINYINT UNSIGNED NOT NULL DEFAULT 1     COMMENT '层级：1=一级 2=二级',
  `sort_order`     INT             NOT NULL DEFAULT 0      COMMENT '同级排序值',
  `status`         VARCHAR(16)     NOT NULL DEFAULT 'active' COMMENT '状态：active=启用 archived=已归档',
  `question_count` INT UNSIGNED    NOT NULL DEFAULT 0      COMMENT '引用题目数（冗余计数，用于快速校验删除保护）',
  `created_by`     BIGINT UNSIGNED DEFAULT NULL            COMMENT '创建人',
  `created_at`     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间(UTC)',
  `updated_at`     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间(UTC)',
  `deleted_at`     DATETIME(3)     DEFAULT NULL            COMMENT '软删除时间（被引用时只能归档）',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_kp_code` (`kp_code`),
  UNIQUE KEY `uk_kp_parent_name` (`parent_id`, `kp_name`),
  KEY `idx_kp_status_sort` (`status`, `sort_order`),
  CONSTRAINT `ck_kp_level` CHECK (`level` IN (1,2)),
  CONSTRAINT `fk_kp_parent` FOREIGN KEY (`parent_id`) REFERENCES `kb_knowledge_point` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='知识点';

-- 2.2 题库（归属教师，支持授权共享）（REQ-QBM-01、REQ-QBM-03）
CREATE TABLE `qb_question_bank` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '题库ID',
  `bank_code`      VARCHAR(32)     NOT NULL                COMMENT '题库编码',
  `bank_name`      VARCHAR(128)    NOT NULL                COMMENT '题库名称',
  `owner_id`       BIGINT UNSIGNED NOT NULL                COMMENT '题库所有者（教师）ID',
  `description`    VARCHAR(500)    DEFAULT NULL            COMMENT '题库说明',
  `visibility`     VARCHAR(16)     NOT NULL DEFAULT 'private' COMMENT '可见性：private=仅本人 shared=授权共享',
  `question_count` INT UNSIGNED    NOT NULL DEFAULT 0      COMMENT '题目数（冗余计数）',
  `status`         VARCHAR(16)     NOT NULL DEFAULT 'active' COMMENT '状态：active/archived/deleted',
  `created_at`     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间(UTC)',
  `updated_at`     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间(UTC)',
  `deleted_at`     DATETIME(3)     DEFAULT NULL            COMMENT '软删除时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_bank_code` (`bank_code`),
  KEY `idx_bank_owner` (`owner_id`, `status`),
  CONSTRAINT `fk_bank_owner` FOREIGN KEY (`owner_id`) REFERENCES `sys_user` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='题库';

-- 2.3 题库授权（教师被授权访问他人题库）（权限矩阵第 6 项）
CREATE TABLE `qb_bank_authorization` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '授权ID',
  `bank_id`    BIGINT UNSIGNED NOT NULL                COMMENT '题库ID',
  `grantee_id` BIGINT UNSIGNED NOT NULL                COMMENT '被授权教师ID',
  `can_write`  TINYINT         NOT NULL DEFAULT 0      COMMENT '是否允许编辑：0=只读 1=可读写',
  `granted_by` BIGINT UNSIGNED NOT NULL                COMMENT '授权人ID',
  `created_at` DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '授权时间(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_bank_grantee` (`bank_id`, `grantee_id`),
  KEY `idx_grantee` (`grantee_id`),
  CONSTRAINT `fk_auth_bank` FOREIGN KEY (`bank_id`) REFERENCES `qb_question_bank` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_auth_grantee` FOREIGN KEY (`grantee_id`) REFERENCES `sys_user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='题库授权';

-- 2.4 题目（REQ-QBM-01、REQ-QBM-02、REQ-QBM-03、REQ-QBM-04）
--     options: [{"key":"A","content":"选项文本"}, ...]
--     correct_answer: 单选 ["A"]；多选 ["A","C"]；判断 ["true"]/["false"]；
--                     填空 ["空1答案","空2答案"]；简答 []（采分点见 scoring_points）
CREATE TABLE `qb_question` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '题目ID',
  `question_no`        VARCHAR(24)     NOT NULL                COMMENT '题号/编码，如 Q-2026-000123',
  `bank_id`            BIGINT UNSIGNED NOT NULL                COMMENT '所属题库ID',
  `knowledge_point_id` BIGINT UNSIGNED DEFAULT NULL            COMMENT '知识点ID',
  `question_type`      VARCHAR(16)     NOT NULL                COMMENT '题型：single/multiple/judge/fill/short',
  `difficulty`         TINYINT UNSIGNED NOT NULL DEFAULT 3     COMMENT '难度：1~5（1 最易，5 最难）',
  `stem`               TEXT            NOT NULL                COMMENT '题干',
  `options`            JSON            DEFAULT NULL            COMMENT '选项数组（选择题使用），不含正确答案',
  `correct_answer`     JSON            NOT NULL                COMMENT '标准答案（数组结构见表注释）',
  `scoring_points`     JSON            DEFAULT NULL            COMMENT '主观题采分点：[{"point":"...","score":2}]',
  `analysis`           TEXT            DEFAULT NULL            COMMENT '答案解析（考试中禁止下发）',
  `default_score`      DECIMAL(5,2)    NOT NULL DEFAULT 1.00   COMMENT '默认分值',
  `current_version`    INT UNSIGNED    NOT NULL DEFAULT 1      COMMENT '当前版本号',
  `reference_count`    INT UNSIGNED    NOT NULL DEFAULT 0      COMMENT '被试卷引用次数（用于删除保护）',
  `status`             VARCHAR(16)     NOT NULL DEFAULT 'draft' COMMENT '状态：draft/published/archived',
  `created_by`         BIGINT UNSIGNED NOT NULL                COMMENT '创建人',
  `created_at`         DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间(UTC)',
  `updated_at`         DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间(UTC)',
  `deleted_at`         DATETIME(3)     DEFAULT NULL            COMMENT '软删除时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_question_no` (`question_no`),
  KEY `idx_question_bank_type` (`bank_id`, `question_type`, `status`),
  KEY `idx_question_kp` (`knowledge_point_id`),
  KEY `idx_question_difficulty` (`difficulty`),
  KEY `idx_question_creator` (`created_by`, `created_at`),
  CONSTRAINT `ck_question_type` CHECK (`question_type` IN ('single','multiple','judge','fill','short')),
  CONSTRAINT `ck_question_difficulty` CHECK (`difficulty` BETWEEN 1 AND 5),
  CONSTRAINT `fk_question_bank` FOREIGN KEY (`bank_id`) REFERENCES `qb_question_bank` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_question_kp` FOREIGN KEY (`knowledge_point_id`) REFERENCES `kb_knowledge_point` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='题目';

-- 2.5 题目版本快照（REQ-QBM-02，保证历史可追溯）
CREATE TABLE `qb_question_version` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '版本记录ID',
  `question_id`    BIGINT UNSIGNED NOT NULL                COMMENT '题目ID',
  `version_no`     INT UNSIGNED    NOT NULL                COMMENT '版本号（从 1 递增）',
  `snapshot`       JSON            NOT NULL                COMMENT '该版本的完整内容快照（题干/选项/答案/解析/分值/知识点）',
  `change_type`    VARCHAR(16)     NOT NULL DEFAULT 'update' COMMENT '变更类型：create/update/rejudge',
  `change_summary` VARCHAR(255)    DEFAULT NULL            COMMENT '变更摘要',
  `changed_by`     BIGINT UNSIGNED NOT NULL                COMMENT '变更人ID',
  `created_at`     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '变更时间(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_qv_question_version` (`question_id`, `version_no`),
  KEY `idx_qv_changed_at` (`question_id`, `created_at`),
  CONSTRAINT `fk_qv_question` FOREIGN KEY (`question_id`) REFERENCES `qb_question` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_qv_user` FOREIGN KEY (`changed_by`) REFERENCES `sys_user` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='题目版本快照';

-- =====================================================================
-- 3. 试卷与组卷域（pp_*）
-- =====================================================================

-- 3.1 试卷（REQ-PPM-01 ~ REQ-PPM-07）
CREATE TABLE `pp_paper` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '试卷ID',
  `paper_no`         VARCHAR(32)     NOT NULL                COMMENT '试卷编号，如 PAPER-2026-0001',
  `paper_name`       VARCHAR(128)    NOT NULL                COMMENT '试卷名称',
  `owner_id`         BIGINT UNSIGNED NOT NULL                COMMENT '试卷所有者（教师）ID',
  `assembly_mode`    VARCHAR(16)     NOT NULL DEFAULT 'manual' COMMENT '组卷方式：manual=手动 random=随机',
  `total_score`      DECIMAL(7,2)    NOT NULL DEFAULT 0.00   COMMENT '设定总分（必须等于各题分值之和）',
  `question_count`   INT UNSIGNED    NOT NULL DEFAULT 0      COMMENT '题目数',
  `duration_minutes` INT UNSIGNED    NOT NULL DEFAULT 90     COMMENT '建议答题时长（分钟）',
  `used_count`       INT UNSIGNED    NOT NULL DEFAULT 0      COMMENT '被考试引用次数',
  `status`           VARCHAR(16)     NOT NULL DEFAULT 'draft' COMMENT '状态：draft/published/locked/archived/deleted',
  `description`      VARCHAR(500)    DEFAULT NULL            COMMENT '试卷说明',
  `created_by`       BIGINT UNSIGNED NOT NULL                COMMENT '创建人',
  `created_at`       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间(UTC)',
  `updated_at`       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间(UTC)',
  `deleted_at`       DATETIME(3)     DEFAULT NULL            COMMENT '软删除时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_paper_no` (`paper_no`),
  KEY `idx_paper_owner_status` (`owner_id`, `status`),
  KEY `idx_paper_created` (`created_at`),
  CONSTRAINT `fk_paper_owner` FOREIGN KEY (`owner_id`) REFERENCES `sys_user` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='试卷';

-- 3.2 试卷题目明细（保存题目引用 + 组卷时快照，锁定后不可变）
CREATE TABLE `pp_paper_question` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '试卷题目ID',
  `paper_id`          BIGINT UNSIGNED NOT NULL                COMMENT '试卷ID',
  `question_id`       BIGINT UNSIGNED NOT NULL                COMMENT '题目ID',
  `section_no`        INT UNSIGNED    NOT NULL DEFAULT 1      COMMENT '大题序号',
  `order_no`          INT UNSIGNED    NOT NULL                COMMENT '题目顺序（从 1 开始）',
  `score`             DECIMAL(5,2)    NOT NULL                COMMENT '本题分值',
  `question_snapshot` JSON            NOT NULL                COMMENT '组卷时题目快照（含标准答案，仅服务端使用）',
  `created_at`        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间(UTC)',
  `updated_at`        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_pq_paper_question` (`paper_id`, `question_id`),
  UNIQUE KEY `uk_pq_paper_order` (`paper_id`, `order_no`),
  KEY `idx_pq_question` (`question_id`),
  CONSTRAINT `fk_pq_paper` FOREIGN KEY (`paper_id`) REFERENCES `pp_paper` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_pq_question` FOREIGN KEY (`question_id`) REFERENCES `qb_question` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='试卷题目明细';

-- =====================================================================
-- 4. 考试与在线答题域（ex_*）
-- =====================================================================

-- 4.1 考试（REQ-EXM-01、REQ-EXM-02、REQ-EXM-10）
CREATE TABLE `ex_exam` (
  `id`                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '考试ID',
  `exam_no`                 VARCHAR(32)     NOT NULL                COMMENT '考试编号，如 EXAM-2026-0001',
  `exam_name`               VARCHAR(128)    NOT NULL                COMMENT '考试名称',
  `paper_id`                BIGINT UNSIGNED NOT NULL                COMMENT '试卷ID',
  `owner_id`                BIGINT UNSIGNED NOT NULL                COMMENT '创建教师ID',
  `start_time`              DATETIME(3)     NOT NULL                COMMENT '考试窗口开始时间(UTC)',
  `end_time`                DATETIME(3)     NOT NULL                COMMENT '考试窗口结束时间(UTC)',
  `duration_minutes`        INT UNSIGNED    NOT NULL                COMMENT '单次答题时长（分钟）',
  `pass_score`              DECIMAL(7,2)    NOT NULL DEFAULT 60.00   COMMENT '及格线',
  `max_attempts`            TINYINT UNSIGNED NOT NULL DEFAULT 1     COMMENT '默认允许作答次数',
  `shuffle_questions`       TINYINT         NOT NULL DEFAULT 0      COMMENT '是否按学生打乱题目顺序：0/1',
  `anti_cheat_enabled`      TINYINT         NOT NULL DEFAULT 1      COMMENT '是否开启防作弊采集：0/1',
  `anti_cheat_threshold`    TINYINT UNSIGNED NOT NULL DEFAULT 3     COMMENT '异常事件累计阈值（超过则标记异常）',
  `auto_submit_on_timeout`  TINYINT         NOT NULL DEFAULT 1      COMMENT '超时是否自动交卷：0/1',
  `score_status`            VARCHAR(16)     NOT NULL DEFAULT 'unpublished' COMMENT '成绩状态：unpublished=评阅中 published=已发布',
  `score_published_at`      DATETIME(3)     DEFAULT NULL            COMMENT '成绩发布时间',
  `published_by`            BIGINT UNSIGNED DEFAULT NULL            COMMENT '成绩发布人',
  `status`                  VARCHAR(16)     NOT NULL DEFAULT 'draft' COMMENT '状态：draft/published/ongoing/finished/cancelled/archived',
  `description`             VARCHAR(500)    DEFAULT NULL            COMMENT '考试说明',
  `created_by`              BIGINT UNSIGNED NOT NULL                COMMENT '创建人',
  `created_at`              DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间(UTC)',
  `updated_at`              DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间(UTC)',
  `deleted_at`              DATETIME(3)     DEFAULT NULL            COMMENT '软删除时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_exam_no` (`exam_no`),
  KEY `idx_exam_owner_status` (`owner_id`, `status`),
  KEY `idx_exam_window` (`start_time`, `end_time`),
  CONSTRAINT `ck_exam_window` CHECK (`end_time` > `start_time`),
  CONSTRAINT `fk_exam_paper` FOREIGN KEY (`paper_id`) REFERENCES `pp_paper` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_exam_owner` FOREIGN KEY (`owner_id`) REFERENCES `sys_user` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='考试';

-- 4.2 参考范围（班级 or 指定学生；发布时按此展开生成考试任务）
--     采用"先删后插"全量重写保证幂等，故不对可空列建唯一索引
CREATE TABLE `ex_exam_scope` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '范围ID',
  `exam_id`    BIGINT UNSIGNED NOT NULL                COMMENT '考试ID',
  `scope_type` VARCHAR(16)     NOT NULL                COMMENT '范围类型：class=按班级 student=指定学生',
  `class_id`   BIGINT UNSIGNED DEFAULT NULL            COMMENT '班级ID（scope_type=class 时有值）',
  `student_id` BIGINT UNSIGNED DEFAULT NULL            COMMENT '学生ID（scope_type=student 时有值）',
  `created_at` DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间(UTC)',
  PRIMARY KEY (`id`),
  KEY `idx_scope_exam` (`exam_id`, `scope_type`),
  KEY `idx_scope_class` (`class_id`),
  KEY `idx_scope_student` (`student_id`),
  CONSTRAINT `ck_scope_type` CHECK (`scope_type` IN ('class','student')),
  CONSTRAINT `fk_scope_exam` FOREIGN KEY (`exam_id`) REFERENCES `ex_exam` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_scope_class` FOREIGN KEY (`class_id`) REFERENCES `sys_class` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_scope_student` FOREIGN KEY (`student_id`) REFERENCES `sys_user` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='考试参考范围';

-- 4.3 考试任务（发布时为每位参考学生生成，是学生端"可参加考试"的数据来源）
CREATE TABLE `ex_exam_task` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '任务ID',
  `exam_id`          BIGINT UNSIGNED NOT NULL                COMMENT '考试ID',
  `student_id`       BIGINT UNSIGNED NOT NULL                COMMENT '学生ID',
  `status`           VARCHAR(16)     NOT NULL DEFAULT 'pending' COMMENT '状态：pending=待开始 doing=作答中 submitted=已交卷 missed=缺考',
  `attempts_allowed` TINYINT UNSIGNED NOT NULL DEFAULT 1     COMMENT '允许作答次数（含补考授权后）',
  `attempts_used`    TINYINT UNSIGNED NOT NULL DEFAULT 0     COMMENT '已使用次数',
  `notified_at`      DATETIME(3)     DEFAULT NULL            COMMENT '通知时间',
  `created_at`       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间(UTC)',
  `updated_at`       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_task_exam_student` (`exam_id`, `student_id`),
  KEY `idx_task_student_status` (`student_id`, `status`),
  CONSTRAINT `fk_task_exam` FOREIGN KEY (`exam_id`) REFERENCES `ex_exam` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_task_student` FOREIGN KEY (`student_id`) REFERENCES `sys_user` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='考试任务';

-- 4.4 答卷（Attempt）：一次作答记录，判分与成绩的载体（REQ-EXM-04、REQ-EXM-07、REQ-EXM-08）
--     幂等与唯一性：同一考生同一场考试最多 1 条进行中答卷（active_flag 唯一索引）
CREATE TABLE `ex_exam_attempt` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '答卷ID',
  `attempt_no`       CHAR(36)        NOT NULL                COMMENT '答卷业务编号（UUID，对外暴露，防止ID遍历）',
  `exam_id`          BIGINT UNSIGNED NOT NULL                COMMENT '考试ID',
  `task_id`          BIGINT UNSIGNED DEFAULT NULL            COMMENT '考试任务ID',
  `student_id`       BIGINT UNSIGNED NOT NULL                COMMENT '考生ID',
  `paper_id`         BIGINT UNSIGNED NOT NULL                COMMENT '试卷ID',
  `attempt_seq`      TINYINT UNSIGNED NOT NULL DEFAULT 1     COMMENT '第几次作答（补考递增）',
  `status`           VARCHAR(16)     NOT NULL DEFAULT 'ongoing' COMMENT '状态：ongoing=作答中 submitted=已交卷 grading=判分中 graded=已判分 reviewed=复核完成 expired=超时作废',
  `started_at`       DATETIME(3)     NOT NULL                COMMENT '开考时间(UTC，服务端时间)',
  `deadline_at`      DATETIME(3)     NOT NULL                COMMENT '截止时间(UTC) = started_at + duration，服务端权威',
  `submitted_at`     DATETIME(3)     DEFAULT NULL            COMMENT '交卷时间(UTC)',
  `submit_type`      VARCHAR(16)     DEFAULT NULL            COMMENT '交卷方式：manual=手动 timeout=超时自动 force=强制',
  `objective_score`  DECIMAL(7,2)    NOT NULL DEFAULT 0.00   COMMENT '客观题得分',
  `subjective_score` DECIMAL(7,2)    NOT NULL DEFAULT 0.00   COMMENT '主观题得分',
  `total_score`      DECIMAL(7,2)    NOT NULL DEFAULT 0.00   COMMENT '总分 = 各题 final_score 之和',
  `is_passed`        TINYINT         DEFAULT NULL            COMMENT '是否及格：0/1，判分完成后计算',
  `grading_status`   VARCHAR(16)     NOT NULL DEFAULT 'pending' COMMENT '判分状态：pending/auto_done/manual_pending/done',
  `is_abnormal`      TINYINT         NOT NULL DEFAULT 0      COMMENT '是否被标记异常（防作弊阈值触发）',
  `abnormal_reason`  VARCHAR(255)    DEFAULT NULL            COMMENT '异常原因摘要',
  `device_key`       VARCHAR(64)     DEFAULT NULL            COMMENT '设备指纹（多端登录检测）',
  `ip`               VARCHAR(45)     DEFAULT NULL            COMMENT '开考IP',
  `graded_at`        DATETIME(3)     DEFAULT NULL            COMMENT '判分完成时间',
  `created_at`       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间(UTC)',
  `updated_at`       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间(UTC)',
  `active_flag`      TINYINT GENERATED ALWAYS AS (CASE WHEN `status` = 'ongoing' THEN 1 ELSE NULL END) STORED COMMENT '进行中标记：仅用于唯一索引保证"同场同人最多一个进行中答卷"',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_attempt_no` (`attempt_no`),
  UNIQUE KEY `uk_attempt_active` (`exam_id`, `student_id`, `active_flag`),
  UNIQUE KEY `uk_attempt_seq` (`exam_id`, `student_id`, `attempt_seq`),
  KEY `idx_attempt_exam_status` (`exam_id`, `status`),
  KEY `idx_attempt_student` (`student_id`, `created_at`),
  KEY `idx_attempt_grading` (`grading_status`),
  KEY `idx_attempt_deadline` (`deadline_at`),
  CONSTRAINT `ck_attempt_status` CHECK (`status` IN ('ongoing','submitted','grading','graded','reviewed','expired')),
  CONSTRAINT `fk_attempt_exam` FOREIGN KEY (`exam_id`) REFERENCES `ex_exam` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_attempt_task` FOREIGN KEY (`task_id`) REFERENCES `ex_exam_task` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_attempt_student` FOREIGN KEY (`student_id`) REFERENCES `sys_user` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_attempt_paper` FOREIGN KEY (`paper_id`) REFERENCES `pp_paper` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='答卷';

-- 4.5 补考授权（REQ-EXM-10）
CREATE TABLE `ex_exam_attempt_grant` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '授权ID',
  `exam_id`        BIGINT UNSIGNED NOT NULL                COMMENT '考试ID',
  `student_id`     BIGINT UNSIGNED NOT NULL                COMMENT '学生ID',
  `extra_attempts` TINYINT UNSIGNED NOT NULL DEFAULT 1     COMMENT '增加的作答次数',
  `reason`         VARCHAR(255)    DEFAULT NULL            COMMENT '授权原因',
  `granted_by`     BIGINT UNSIGNED NOT NULL                COMMENT '授权人ID',
  `created_at`     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '授权时间(UTC)',
  PRIMARY KEY (`id`),
  KEY `idx_grant_exam_student` (`exam_id`, `student_id`),
  CONSTRAINT `fk_grant_exam` FOREIGN KEY (`exam_id`) REFERENCES `ex_exam` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_grant_student` FOREIGN KEY (`student_id`) REFERENCES `sys_user` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='补考授权';

-- 4.6 答卷题目明细（答题快照 + 答案 + 得分，是"考试快照"与"答案暂存"的落地表）
--     答案暂存策略：直接 UPSERT 本表 student_answer + answer_version，不另建草稿表，避免双写不一致
CREATE TABLE `ex_attempt_question` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '答卷题目ID',
  `attempt_id`        BIGINT UNSIGNED NOT NULL                COMMENT '答卷ID',
  `paper_question_id` BIGINT UNSIGNED NOT NULL                COMMENT '试卷题目ID',
  `question_id`       BIGINT UNSIGNED NOT NULL                COMMENT '题目ID',
  `question_type`     VARCHAR(16)     NOT NULL                COMMENT '题型快照',
  `order_no`          INT UNSIGNED    NOT NULL                COMMENT '本次答卷展示顺序（可打乱）',
  `full_score`        DECIMAL(5,2)    NOT NULL                COMMENT '本题满分（快照）',
  `question_snapshot` JSON            NOT NULL                COMMENT '题目完整快照（含标准答案与解析；下发给学生前必须脱敏）',
  `student_answer`    TEXT            NULL                    COMMENT '考生作答：选择/判断存答案键JSON，填空存JSON数组，简答存文本',
  `answer_version`    INT UNSIGNED    NOT NULL DEFAULT 0      COMMENT '答案版本（乐观锁，防止并发覆盖）',
  `answer_saved_at`   DATETIME(3)     DEFAULT NULL            COMMENT '最近暂存时间',
  `auto_score`        DECIMAL(5,2)    NOT NULL DEFAULT 0.00   COMMENT '客观题自动判分',
  `manual_score`      DECIMAL(5,2)    DEFAULT NULL            COMMENT '主观题人工评分',
  `final_score`       DECIMAL(5,2)    NOT NULL DEFAULT 0.00   COMMENT '最终得分（客观/仲裁/人工结果统一落此列）',
  `is_correct`        TINYINT         DEFAULT NULL            COMMENT '客观题是否正确：0/1（用于题目质量分析）',
  `grade_status`      VARCHAR(16)     NOT NULL DEFAULT 'pending' COMMENT '评分状态：pending/auto/manual/arbitration/done',
  `grader_id`         BIGINT UNSIGNED DEFAULT NULL            COMMENT '最终评分人ID',
  `graded_at`         DATETIME(3)     DEFAULT NULL            COMMENT '评分时间',
  `grader_comment`    VARCHAR(500)    DEFAULT NULL            COMMENT '教师评语',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_aq_attempt_question` (`attempt_id`, `question_id`),
  UNIQUE KEY `uk_aq_attempt_order` (`attempt_id`, `order_no`),
  KEY `idx_aq_question` (`question_id`),
  KEY `idx_aq_grade_status` (`attempt_id`, `grade_status`),
  CONSTRAINT `ck_aq_question_type` CHECK (`question_type` IN ('single','multiple','judge','fill','short')),
  CONSTRAINT `fk_aq_attempt` FOREIGN KEY (`attempt_id`) REFERENCES `ex_exam_attempt` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_aq_pq` FOREIGN KEY (`paper_question_id`) REFERENCES `pp_paper_question` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_aq_question` FOREIGN KEY (`question_id`) REFERENCES `qb_question` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='答卷题目明细';

-- 4.7 防作弊事件（REQ-EXM-09、NFR-08）
CREATE TABLE `ex_anti_cheat_event` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '事件ID',
  `attempt_id`        BIGINT UNSIGNED NOT NULL                COMMENT '答卷ID',
  `exam_id`           BIGINT UNSIGNED NOT NULL                COMMENT '考试ID（冗余，便于教师按考试筛选）',
  `student_id`        BIGINT UNSIGNED NOT NULL                COMMENT '学生ID（冗余，便于越权校验）',
  `event_type`        VARCHAR(32)     NOT NULL                COMMENT '事件类型：switch_screen/exit_fullscreen/copy_paste/multi_device/blur',
  `cumulative_count`  INT UNSIGNED    NOT NULL DEFAULT 1      COMMENT '该类型累计次数（服务端累加）',
  `event_time`        DATETIME(3)     NOT NULL                COMMENT '事件发生时间(UTC，以服务端接收时间为准)',
  `detail`            JSON            DEFAULT NULL            COMMENT '事件详情（可见性变化、粘贴长度、设备指纹等）',
  `ip`                VARCHAR(45)     DEFAULT NULL            COMMENT '来源IP',
  `user_agent`        VARCHAR(255)    DEFAULT NULL            COMMENT 'User-Agent',
  `created_at`        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '入库时间(UTC)',
  PRIMARY KEY (`id`),
  KEY `idx_ace_attempt_time` (`attempt_id`, `event_time`),
  KEY `idx_ace_exam_type` (`exam_id`, `event_type`),
  CONSTRAINT `fk_ace_attempt` FOREIGN KEY (`attempt_id`) REFERENCES `ex_exam_attempt` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_ace_exam` FOREIGN KEY (`exam_id`) REFERENCES `ex_exam` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_ace_student` FOREIGN KEY (`student_id`) REFERENCES `sys_user` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='防作弊事件';

-- =====================================================================
-- 5. 阅卷与复核域（mk_*）
-- =====================================================================

-- 5.1 人工阅卷任务（主观题队列 + 双评 + 仲裁状态机）（REQ-MRK-02、REQ-MRK-03、REQ-MRK-04）
CREATE TABLE `mk_grading_task` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '阅卷任务ID',
  `exam_id`             BIGINT UNSIGNED NOT NULL                COMMENT '考试ID',
  `attempt_id`          BIGINT UNSIGNED NOT NULL                COMMENT '答卷ID',
  `attempt_question_id` BIGINT UNSIGNED NOT NULL                COMMENT '答卷题目ID',
  `question_id`         BIGINT UNSIGNED NOT NULL                COMMENT '题目ID',
  `question_type`       VARCHAR(16)     NOT NULL                COMMENT '题型：short/fill（需人工确认的题型）',
  `assignee_id`         BIGINT UNSIGNED DEFAULT NULL            COMMENT '当前阅卷人ID',
  `status`              VARCHAR(16)     NOT NULL DEFAULT 'pending' COMMENT '状态：pending/first_done/second_pending/arbitration/done',
  `first_score`         DECIMAL(5,2)    DEFAULT NULL            COMMENT '第一评得分',
  `first_grader_id`     BIGINT UNSIGNED DEFAULT NULL            COMMENT '第一评阅卷人',
  `first_graded_at`     DATETIME(3)     DEFAULT NULL            COMMENT '第一评时间',
  `first_comment`       VARCHAR(500)    DEFAULT NULL            COMMENT '第一评评语',
  `second_score`        DECIMAL(5,2)    DEFAULT NULL            COMMENT '第二评得分',
  `second_grader_id`    BIGINT UNSIGNED DEFAULT NULL            COMMENT '第二评阅卷人',
  `second_graded_at`    DATETIME(3)     DEFAULT NULL            COMMENT '第二评时间',
  `second_comment`      VARCHAR(500)    DEFAULT NULL            COMMENT '第二评评语',
  `score_gap`           DECIMAL(5,2)    DEFAULT NULL            COMMENT '双评分差绝对值',
  `arbitration_score`   DECIMAL(5,2)    DEFAULT NULL            COMMENT '仲裁最终分',
  `arbitrator_id`       BIGINT UNSIGNED DEFAULT NULL            COMMENT '仲裁人ID',
  `arbitrated_at`       DATETIME(3)     DEFAULT NULL            COMMENT '仲裁时间',
  `arbitration_reason`  VARCHAR(500)    DEFAULT NULL            COMMENT '仲裁理由',
  `final_score`         DECIMAL(5,2)    DEFAULT NULL            COMMENT '最终得分（回写 ex_attempt_question.final_score）',
  `created_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间(UTC)',
  `updated_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_task_attempt_question` (`attempt_question_id`),
  KEY `idx_gt_exam_status` (`exam_id`, `status`),
  KEY `idx_gt_assignee_status` (`assignee_id`, `status`),
  CONSTRAINT `ck_gt_status` CHECK (`status` IN ('pending','first_done','second_pending','arbitration','done')),
  CONSTRAINT `fk_gt_exam` FOREIGN KEY (`exam_id`) REFERENCES `ex_exam` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_gt_attempt` FOREIGN KEY (`attempt_id`) REFERENCES `ex_exam_attempt` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_gt_aq` FOREIGN KEY (`attempt_question_id`) REFERENCES `ex_attempt_question` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='人工阅卷任务';

-- 5.2 成绩变更记录（人工评分/仲裁/重判/复核，均须留痕）（NFR-18、REQ-MRK-07）
CREATE TABLE `mk_grade_change_log` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '变更ID',
  `attempt_id`          BIGINT UNSIGNED NOT NULL                COMMENT '答卷ID',
  `attempt_question_id` BIGINT UNSIGNED DEFAULT NULL            COMMENT '答卷题目ID（整卷级变更为空）',
  `change_type`         VARCHAR(32)     NOT NULL                COMMENT '类型：manual_grading/arbitration/rejudge/appeal/recalculate',
  `old_score`           DECIMAL(5,2)    DEFAULT NULL            COMMENT '变更前得分',
  `new_score`           DECIMAL(5,2)    DEFAULT NULL            COMMENT '变更后得分',
  `old_total_score`     DECIMAL(7,2)    DEFAULT NULL            COMMENT '变更前总分',
  `new_total_score`     DECIMAL(7,2)    DEFAULT NULL            COMMENT '变更后总分',
  `operator_id`         BIGINT UNSIGNED NOT NULL                COMMENT '操作人ID',
  `reason`              VARCHAR(500)    DEFAULT NULL            COMMENT '变更原因（必填于人工改分/复核）',
  `created_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '变更时间(UTC)',
  PRIMARY KEY (`id`),
  KEY `idx_gcl_attempt` (`attempt_id`, `created_at`),
  KEY `idx_gcl_type` (`change_type`, `created_at`),
  CONSTRAINT `fk_gcl_attempt` FOREIGN KEY (`attempt_id`) REFERENCES `ex_exam_attempt` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_gcl_aq` FOREIGN KEY (`attempt_question_id`) REFERENCES `ex_attempt_question` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='成绩变更记录';

-- 5.3 成绩复核申诉（REQ-MRK-05、UC-30）
CREATE TABLE `mk_score_appeal` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '申诉ID',
  `appeal_no`      VARCHAR(32)     NOT NULL                COMMENT '申诉单号，如 APL-2026-000001',
  `exam_id`        BIGINT UNSIGNED NOT NULL                COMMENT '考试ID',
  `attempt_id`     BIGINT UNSIGNED NOT NULL                COMMENT '答卷ID',
  `student_id`     BIGINT UNSIGNED NOT NULL                COMMENT '学生ID',
  `question_id`    BIGINT UNSIGNED DEFAULT NULL            COMMENT '申诉题目ID（为空表示整卷申诉）',
  `reason`         TEXT            NOT NULL                COMMENT '申诉理由',
  `status`         VARCHAR(16)     NOT NULL DEFAULT 'pending' COMMENT '状态：pending=待处理 accepted=已采纳 rejected=已驳回 closed=已关闭',
  `handler_id`     BIGINT UNSIGNED DEFAULT NULL            COMMENT '处理教师ID',
  `handle_comment` VARCHAR(500)    DEFAULT NULL            COMMENT '处理意见',
  `old_score`      DECIMAL(7,2)    DEFAULT NULL            COMMENT '处理前总分',
  `new_score`      DECIMAL(7,2)    DEFAULT NULL            COMMENT '处理后总分',
  `deadline_at`    DATETIME(3)     DEFAULT NULL            COMMENT '申诉截止时间（发布后 N 天）',
  `created_at`     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '申诉时间(UTC)',
  `handled_at`     DATETIME(3)     DEFAULT NULL            COMMENT '处理时间(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_appeal_no` (`appeal_no`),
  KEY `idx_appeal_exam_status` (`exam_id`, `status`),
  KEY `idx_appeal_student` (`student_id`, `created_at`),
  CONSTRAINT `ck_appeal_status` CHECK (`status` IN ('pending','accepted','rejected','closed')),
  CONSTRAINT `fk_appeal_exam` FOREIGN KEY (`exam_id`) REFERENCES `ex_exam` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_appeal_attempt` FOREIGN KEY (`attempt_id`) REFERENCES `ex_exam_attempt` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_appeal_student` FOREIGN KEY (`student_id`) REFERENCES `sys_user` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='成绩复核申诉';

-- =====================================================================
-- 6. 统计分析域（st_*）—— 物化汇总，支撑 NFR-04（10 万答卷 ≤ 3s）
-- =====================================================================

-- 6.1 单场考试统计（REQ-STA-02）
CREATE TABLE `st_exam_stat` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '统计ID',
  `exam_id`             BIGINT UNSIGNED NOT NULL                COMMENT '考试ID',
  `participant_count`   INT UNSIGNED    NOT NULL DEFAULT 0      COMMENT '应考人数',
  `submitted_count`     INT UNSIGNED    NOT NULL DEFAULT 0      COMMENT '实考（已交卷）人数',
  `absent_count`        INT UNSIGNED    NOT NULL DEFAULT 0      COMMENT '缺考人数',
  `submit_rate`         DECIMAL(5,2)    NOT NULL DEFAULT 0.00   COMMENT '交卷率(%)',
  `avg_score`           DECIMAL(7,2)    NOT NULL DEFAULT 0.00   COMMENT '平均分',
  `max_score`           DECIMAL(7,2)    NOT NULL DEFAULT 0.00   COMMENT '最高分',
  `min_score`           DECIMAL(7,2)    NOT NULL DEFAULT 0.00   COMMENT '最低分',
  `std_dev`             DECIMAL(7,2)    NOT NULL DEFAULT 0.00   COMMENT '标准差',
  `pass_count`          INT UNSIGNED    NOT NULL DEFAULT 0      COMMENT '及格人数',
  `pass_rate`           DECIMAL(5,2)    NOT NULL DEFAULT 0.00   COMMENT '及格率(%)',
  `excellent_count`     INT UNSIGNED    NOT NULL DEFAULT 0      COMMENT '优秀人数（≥90%）',
  `excellent_rate`      DECIMAL(5,2)    NOT NULL DEFAULT 0.00   COMMENT '优秀率(%)',
  `score_distribution`  JSON            DEFAULT NULL            COMMENT '分数段分布：[{"range":"90-100","count":12}]',
  `calc_at`             DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '计算时间(UTC)',
  `updated_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_stat_exam` (`exam_id`),
  CONSTRAINT `fk_stat_exam` FOREIGN KEY (`exam_id`) REFERENCES `ex_exam` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='单场考试统计';

-- 6.2 题目质量分析（REQ-STA-03）
CREATE TABLE `st_question_stat` (
  `id`                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '统计ID',
  `exam_id`                BIGINT UNSIGNED NOT NULL                COMMENT '考试ID',
  `question_id`            BIGINT UNSIGNED NOT NULL                COMMENT '题目ID',
  `answer_count`           INT UNSIGNED    NOT NULL DEFAULT 0      COMMENT '有效作答人数',
  `correct_count`          INT UNSIGNED    NOT NULL DEFAULT 0      COMMENT '正确人数（客观题）',
  `correct_rate`           DECIMAL(5,2)    NOT NULL DEFAULT 0.00   COMMENT '正确率(%)，主观题按满分率折算',
  `avg_score_rate`         DECIMAL(5,2)    NOT NULL DEFAULT 0.00   COMMENT '平均得分率(%)',
  `difficulty_index`       DECIMAL(5,4)    NOT NULL DEFAULT 0.0000 COMMENT '难度系数 = 平均得分/满分，越高越容易',
  `high_group_rate`        DECIMAL(5,2)    NOT NULL DEFAULT 0.00   COMMENT '高分组(前27%)平均得分率(%)',
  `low_group_rate`         DECIMAL(5,2)    NOT NULL DEFAULT 0.00   COMMENT '低分组(后27%)平均得分率(%)',
  `discrimination_index`   DECIMAL(5,4)    NOT NULL DEFAULT 0.0000 COMMENT '区分度 = 高分组率-低分组率',
  `is_abnormal`            TINYINT         NOT NULL DEFAULT 0      COMMENT '是否异常题（正确率<30% 或 >95%）',
  `abnormal_reason`        VARCHAR(255)    DEFAULT NULL            COMMENT '异常原因',
  `calc_at`                DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '计算时间(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_qs_exam_question` (`exam_id`, `question_id`),
  KEY `idx_qs_abnormal` (`exam_id`, `is_abnormal`),
  CONSTRAINT `fk_qs_exam` FOREIGN KEY (`exam_id`) REFERENCES `ex_exam` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_qs_question` FOREIGN KEY (`question_id`) REFERENCES `qb_question` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='题目质量分析';

-- 6.3 知识点失分分布（REQ-STA-04）
CREATE TABLE `st_knowledge_stat` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '统计ID',
  `exam_id`           BIGINT UNSIGNED NOT NULL                COMMENT '考试ID',
  `knowledge_point_id` BIGINT UNSIGNED NOT NULL               COMMENT '知识点ID',
  `student_count`     INT UNSIGNED    NOT NULL DEFAULT 0      COMMENT '涉及学生数',
  `total_score`       DECIMAL(9,2)    NOT NULL DEFAULT 0.00   COMMENT '该知识点题目总分合计',
  `lost_score`        DECIMAL(9,2)    NOT NULL DEFAULT 0.00   COMMENT '该知识点失分合计',
  `lost_rate`         DECIMAL(5,2)    NOT NULL DEFAULT 0.00   COMMENT '失分率(%)',
  `calc_at`           DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '计算时间(UTC)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ks_exam_kp` (`exam_id`, `knowledge_point_id`),
  KEY `idx_ks_lost_rate` (`exam_id`, `lost_rate`),
  CONSTRAINT `fk_ks_exam` FOREIGN KEY (`exam_id`) REFERENCES `ex_exam` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_ks_kp` FOREIGN KEY (`knowledge_point_id`) REFERENCES `kb_knowledge_point` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='知识点失分分布';

SET FOREIGN_KEY_CHECKS = 1;

-- =====================================================================
-- 7. 初始化数据（种子数据）
-- ---------------------------------------------------------------------
--  【默认密码】三个测试账号密码均为 Passw0rd@2026 之外的独立密码：
--      admin   / Admin@2026
--      teacher / Teacher@2026
--      student / Student@2026
--  密码采用 bcrypt(cost=10) 加盐哈希，下方密文由 bcryptjs 实际生成，
--  重新生成方式（Node.js）：
--      npm i bcryptjs && node -e "const b=require('bcryptjs');
--        console.log(b.hashSync('Admin@2026',10))"
--  【务必】首次部署后立即修改默认密码（REQ-UAM-07）。
--  【时间】示例考试时间以 UTC 存储，注释中标出对应的 Asia/Shanghai 时间。
-- =====================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- 7.1 班级
INSERT INTO `sys_class` (`id`, `class_code`, `class_name`, `grade_year`, `department`, `head_teacher_id`, `status`) VALUES
  (1, 'CS2024-01', '计算机科学与技术 2024 级 1 班', 2024, '计算机学院', 2, 1),
  (2, 'CS2024-02', '计算机科学与技术 2024 级 2 班', 2024, '计算机学院', 2, 1);

-- 7.2 用户（密码均为 bcrypt 密文，禁止明文）
INSERT INTO `sys_user`
  (`id`, `username`, `password_hash`, `real_name`, `email`, `role_code`, `class_id`, `department`, `status`, `register_channel`, `password_changed_at`, `remark`) VALUES
  (1, 'admin',   '$2b$10$jMaK59cOB1EVVaJwTN1CJ.BV94FuoiLRMVCwT1D4MiZ5QBXEz8Wmy', '系统管理员', 'admin@oes.edu.cn',   'admin',   NULL, '教务处',     'active', 'admin', NOW(3), '默认密码 Admin@2026，部署后请立即修改'),
  (2, 'T2024001', '$2b$10$aVcIgpvh/Ppr0DqGAEYCLuvoUo2Dr1lV/1h6C.i.pjuxrEWS6UWUW', '王立群',     'wanglq@oes.edu.cn',  'teacher', NULL, '计算机学院', 'active', 'admin', NOW(3), '默认密码 Teacher@2026，工号作为登录名'),
  (3, 'S2024001', '$2b$10$mZ4vSGX0aeqhbGAKcsrwSuE3zirkD3xWvIgCMZvr6sX5b5TZZxcGC', '李思远',     'lisiy@oes.edu.cn',   'student', 1,    NULL,         'active', 'admin', NOW(3), '默认密码 Student@2026，学号作为登录名');

-- 7.3 角色
INSERT INTO `sys_role` (`id`, `role_code`, `role_name`, `description`, `is_builtin`) VALUES
  (1, 'admin',   '管理员', '系统最高权限：账号权限、全局题库监管、仲裁、审计、参数、备份', 1),
  (2, 'teacher', '教师',   '教学执行：题库、组卷、考试、阅卷、统计、复核', 1),
  (3, 'student', '学生',   '考试参与：在线答题、个人成绩查询、成绩复核申诉', 1);

-- 7.4 权限点（接口级功能权限）
INSERT INTO `sys_permission` (`perm_code`, `perm_name`, `module`, `http_method`, `path_pattern`, `description`) VALUES
  -- 认证与个人
  ('auth.login',        '登录',           'uam', 'POST',  '/api/v1/auth/login',            '公开接口，无需鉴权'),
  ('auth.logout',       '登出',           'uam', 'POST',  '/api/v1/auth/logout',           '吊销当前刷新令牌'),
  ('auth.refresh',      '令牌刷新',       'uam', 'POST',  '/api/v1/auth/refresh',          '刷新并轮换令牌'),
  ('auth.me',           '当前用户信息',   'uam', 'GET',   '/api/v1/auth/me',               '读取本人信息与权限点'),
  ('auth.password',     '修改本人密码',   'uam', 'PUT',   '/api/v1/auth/password',         '校验强度并吊销全部令牌'),
  ('auth.profile',      '修改本人资料',   'uam', 'PUT',   '/api/v1/auth/profile',          '仅限本人'),
  -- 用户与权限管理
  ('user.list',         '用户列表查询',   'uam', 'GET',   '/api/v1/users',                 '管理员全量'),
  ('user.create',       '创建用户',       'uam', 'POST',  '/api/v1/users',                 '管理员'),
  ('user.update',       '编辑用户',       'uam', 'PUT',   '/api/v1/users/:id',             '管理员'),
  ('user.status',       '启用禁用账号',   'uam', 'PATCH', '/api/v1/users/:id/status',      '禁用后令牌立即失效'),
  ('user.role',         '角色权限分配',   'uam', 'PATCH', '/api/v1/users/:id/role',        '变更即生效并记审计'),
  ('user.resetPassword','重置用户密码',   'uam', 'POST',  '/api/v1/users/:id/reset-password', '返回一次性临时密码'),
  ('user.approve',      '注册审批',       'uam', 'POST',  '/api/v1/users/:id/approve',     '学生注册审核'),
  -- 知识点与题库
  ('kp.read',           '知识点查询',     'qbm', 'GET',   '/api/v1/knowledge-points',      '全部角色可读'),
  ('kp.manage',         '知识点维护',     'qbm', 'POST',  '/api/v1/knowledge-points',      '仅管理员'),
  ('bank.read',         '题库查询',       'qbm', 'GET',   '/api/v1/question-banks',        '按数据权限过滤'),
  ('bank.manage',       '题库维护',       'qbm', 'POST',  '/api/v1/question-banks',        '教师仅本人题库'),
  ('question.read',     '题目查询',       'qbm', 'GET',   '/api/v1/questions',             '教师限本人/授权题库'),
  ('question.create',   '题目新增',       'qbm', 'POST',  '/api/v1/questions',             '按题型校验'),
  ('question.update',   '题目编辑',       'qbm', 'PUT',   '/api/v1/questions/:id',         '生成版本记录'),
  ('question.delete',   '题目删除',       'qbm', 'DELETE','/api/v1/questions/:id',         '软删除 + 引用保护'),
  ('question.import',   '题目批量导入',   'qbm', 'POST',  '/api/v1/questions/import',      '上限 5000 行'),
  ('question.export',   '题库导出',       'qbm', 'GET',   '/api/v1/questions/export',      '写审计日志'),
  -- 试卷与组卷
  ('paper.read',        '试卷查询',       'ppm', 'GET',   '/api/v1/papers',                '教师仅见本人试卷'),
  ('paper.create',      '创建试卷',       'ppm', 'POST',  '/api/v1/papers',                '手动组卷'),
  ('paper.update',      '编辑试卷',       'ppm', 'PUT',   '/api/v1/papers/:id',            '锁定状态禁止修改'),
  ('paper.delete',      '删除试卷',       'ppm', 'DELETE','/api/v1/papers/:id',            '软删除'),
  ('paper.random',      '随机组卷',       'ppm', 'POST',  '/api/v1/papers/random',         '缺口提示，不生成残缺卷'),
  ('paper.preview',     '试卷预览',       'ppm', 'GET',   '/api/v1/papers/:id/preview',    '预览脱敏'),
  ('paper.copy',        '试卷复制',       'ppm', 'POST',  '/api/v1/papers/:id/copy',       '生成独立新卷'),
  ('paper.status',      '试卷锁定归档',   'ppm', 'PATCH', '/api/v1/papers/:id/status',     '归档仅管理员'),
  -- 考试与答题
  ('exam.read',         '考试查询',       'exm', 'GET',   '/api/v1/exams',                 '按数据权限过滤'),
  ('exam.create',       '创建考试',       'exm', 'POST',  '/api/v1/exams',                 '教师'),
  ('exam.update',       '编辑考试',       'exm', 'PUT',   '/api/v1/exams/:id',             '已发布仅限特定变更'),
  ('exam.publish',      '发布考试',       'exm', 'POST',  '/api/v1/exams/:id/publish',     '生成任务与通知'),
  ('exam.change',       '考试变更',       'exm', 'PATCH', '/api/v1/exams/:id/status',      '延期/取消'),
  ('exam.grant',        '补考授权',       'exm', 'POST',  '/api/v1/exams/:id/grants',      '增加作答次数'),
  ('exam.monitor',      '考试监控',       'exm', 'GET',   '/api/v1/exams/:id/monitor',     '教师仅本人考试'),
  ('attempt.start',     '开考',           'exm', 'POST',  '/api/v1/exams/:id/attempts',    '资格校验 + 生成答卷'),
  ('attempt.read',      '读取答卷',       'exm', 'GET',   '/api/v1/attempts/:id',          '仅答卷本人/监考教师'),
  ('attempt.answer',    '答案暂存',       'exm', 'PUT',   '/api/v1/attempts/:id/answers',  '幂等 UPSERT'),
  ('attempt.submit',    '交卷',           'exm', 'POST',  '/api/v1/attempts/:id/submit',   '幂等'),
  ('attempt.cheat',     '防作弊事件上报', 'exm', 'POST',  '/api/v1/attempts/:id/cheat-events', '仅答卷本人'),
  ('exam.available',    '可参加考试列表', 'exm', 'GET',   '/api/v1/exams/available',       '学生'),
  -- 阅卷与复核
  ('grading.read',      '阅卷任务查询',   'mrk', 'GET',   '/api/v1/grading-tasks',         '教师仅本人考试'),
  ('grading.score',     '人工评分',       'mrk', 'POST',  '/api/v1/grading-tasks/:id/score', '校验 0~满分区间'),
  ('grading.arbitrate', '争议仲裁',       'mrk', 'POST',  '/api/v1/grading-tasks/:id/arbitrate', '管理员或被指定仲裁人'),
  ('grading.progress',  '阅卷进度',       'mrk', 'GET',   '/api/v1/exams/:id/grading-progress', '看板'),
  ('question.rejudge',  '标准答案修正重判', 'mrk', 'POST', '/api/v1/questions/:id/rejudge', '仅管理员，保留主观分'),
  ('appeal.create',     '成绩复核申诉',   'mrk', 'POST',  '/api/v1/appeals',               '学生'),
  ('appeal.handle',     '复核处理',       'mrk', 'POST',  '/api/v1/appeals/:id/handle',    '教师/管理员'),
  -- 成绩统计
  ('grade.self',        '个人成绩查询',   'sta', 'GET',   '/api/v1/my/grades',             '学生仅本人'),
  ('grade.exam',        '考试成绩列表',   'sta', 'GET',   '/api/v1/exams/:id/scores',      '教师/管理员'),
  ('grade.publish',     '成绩发布',       'sta', 'POST',  '/api/v1/exams/:id/publish-scores', '校验阅卷完成'),
  ('grade.export',      '成绩导出',       'sta', 'GET',   '/api/v1/exams/:id/scores/export', '写审计日志'),
  ('stat.exam',         '考试统计',       'sta', 'GET',   '/api/v1/exams/:id/statistics',  '教师/管理员'),
  ('stat.question',     '题目质量分析',   'sta', 'GET',   '/api/v1/exams/:id/question-analysis', '教师/管理员'),
  ('stat.trend',        '趋势与对比分析', 'sta', 'GET',   '/api/v1/statistics/trends',     '教师/管理员'),
  ('stat.knowledge',    '知识点失分分布', 'sta', 'GET',   '/api/v1/statistics/knowledge-points', '教师/管理员'),
  -- 系统管理
  ('config.read',       '参数查询',       'sys', 'GET',   '/api/v1/configs',               '管理员'),
  ('config.update',     '参数修改',       'sys', 'PUT',   '/api/v1/configs/:key',          '管理员，写审计'),
  ('audit.read',        '审计日志查询',   'sys', 'GET',   '/api/v1/audit-logs',            '仅管理员'),
  ('audit.export',      '审计日志导出',   'sys', 'GET',   '/api/v1/audit-logs/export',     '仅管理员'),
  ('notice.read',       '公告查看',       'sys', 'GET',   '/api/v1/notices',               '全部角色'),
  ('notice.manage',     '公告管理',       'sys', 'POST',  '/api/v1/notices',               '仅管理员'),
  ('notification.read', '站内通知',       'sys', 'GET',   '/api/v1/notifications',         '当前用户'),
  ('backup.trigger',    '数据备份',       'sys', 'POST',  '/api/v1/backups',               '仅管理员'),
  ('backup.read',       '备份记录查询',   'sys', 'GET',   '/api/v1/backups',               '仅管理员'),
  ('health.read',       '健康检查',       'sys', 'GET',   '/api/v1/health',                '公开只读');

-- 7.5 角色权限映射：管理员拥有全部权限点
INSERT INTO `sys_role_permission` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id` FROM `sys_role` r CROSS JOIN `sys_permission` p WHERE r.`role_code` = 'admin';

-- 教师权限（不含用户管理、知识点维护、审计、备份、系统参数）
INSERT INTO `sys_role_permission` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id`
FROM `sys_role` r CROSS JOIN `sys_permission` p
WHERE r.`role_code` = 'teacher'
  AND p.`perm_code` IN (
    'auth.logout','auth.refresh','auth.me','auth.password','auth.profile',
    'kp.read','bank.read','bank.manage','question.read','question.create','question.update',
    'question.delete','question.import','question.export',
    'paper.read','paper.create','paper.update','paper.delete','paper.random','paper.preview',
    'paper.copy','paper.status',
    'exam.read','exam.create','exam.update','exam.publish','exam.change','exam.grant','exam.monitor',
    'grading.read','grading.score','grading.progress','appeal.handle',
    'grade.exam','grade.publish','grade.export','stat.exam','stat.question','stat.trend','stat.knowledge',
    'notice.read','notification.read','health.read'
  );

-- 学生权限（仅答题、查本人成绩、申诉、导出本人成绩单）
INSERT INTO `sys_role_permission` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id`
FROM `sys_role` r CROSS JOIN `sys_permission` p
WHERE r.`role_code` = 'student'
  AND p.`perm_code` IN (
    'auth.logout','auth.refresh','auth.me','auth.password','auth.profile',
    'kp.read','exam.available','attempt.start','attempt.read','attempt.answer','attempt.submit',
    'attempt.cheat','appeal.create','grade.self','grade.export',
    'notice.read','notification.read','health.read'
  );

-- 7.6 系统参数（REQ-SYS-01）
INSERT INTO `sys_config` (`config_key`, `config_value`, `value_type`, `config_group`, `description`, `is_editable`) VALUES
  ('exam.defaultDuration',              '90',          'number',  'exam',     '默认考试时长（分钟）', 1),
  ('exam.passScore',                    '60',          'number',  'exam',     '默认及格线（分）', 1),
  ('exam.autosaveIntervalSeconds',      '30',          'number',  'exam',     '答案自动暂存间隔（秒）', 1),
  ('exam.antiCheatThreshold',           '3',           'number',  'exam',     '防作弊事件累计阈值', 1),
  ('security.accessTokenTtlSeconds',    '7200',        'number',  'security', 'Access Token 有效期（秒，2 小时）', 1),
  ('security.refreshTokenTtlSeconds',   '604800',      'number',  'security', 'Refresh Token 有效期（秒，7 天）', 1),
  ('security.maxLoginFail',             '5',           'number',  'security', '连续登录失败锁定阈值', 1),
  ('security.lockMinutes',              '15',          'number',  'security', '账号锁定时长（分钟）', 1),
  ('security.bcryptCost',               '10',          'number',  'security', 'bcrypt 代价因子（只读，修改需重启）', 0),
  ('grading.multiChoiceStrategy',       'all_or_nothing', 'string', 'grading', '多选计分策略：all_or_nothing=全对得分 / half_score=少选得半分', 1),
  ('grading.arbitrationThresholdRatio', '0.2',         'number',  'grading', '双评分差仲裁阈值（占满分比例）', 1),
  ('system.appealWindowDays',           '7',           'number',  'system',  '成绩发布后可申诉天数', 1),
  ('system.auditRetentionDays',         '180',         'number',  'system',  '审计日志在线保留天数（NFR-09）', 1);

-- 7.7 知识点（两级分类）
INSERT INTO `kb_knowledge_point` (`id`, `kp_code`, `kp_name`, `parent_id`, `level`, `sort_order`, `status`, `question_count`) VALUES
  (1, 'KP-CS',        '计算机基础',     NULL, 1, 10, 'active', 0),
  (2, 'KP-CS-DS',     '数据结构',       1,    2, 10, 'active', 2),
  (3, 'KP-CS-NET',    '计算机网络',     1,    2, 20, 'active', 2),
  (4, 'KP-CS-DB',     '数据库原理',     1,    2, 30, 'active', 1),
  (5, 'KP-CS-WEB',    'Web 安全与鉴权', 1,    2, 40, 'active', 1);

-- 7.8 题库（归属教师 T2024001，id=2）
INSERT INTO `qb_question_bank` (`id`, `bank_code`, `bank_name`, `owner_id`, `description`, `visibility`, `question_count`, `status`) VALUES
  (1, 'BANK-CS-2026', '计算机专业课程题库（2026 春）', 2, '覆盖数据结构、计算机网络、数据库、Web 安全的课程题库', 'private', 5, 'active');

-- 7.9 题目（五种题型各 1 道，标准答案统一为 JSON 数组结构）
INSERT INTO `qb_question`
  (`id`, `question_no`, `bank_id`, `knowledge_point_id`, `question_type`, `difficulty`, `stem`, `options`, `correct_answer`, `scoring_points`, `analysis`, `default_score`, `current_version`, `reference_count`, `status`, `created_by`) VALUES
  (1, 'Q-2026-000001', 1, 2, 'single',   2,
   '以下哪种数据结构最适合实现 O(1) 时间复杂度的 LRU 缓存淘汰策略？',
   '[{"key":"A","content":"顺序数组"},{"key":"B","content":"哈希表 + 双向链表"},{"key":"C","content":"栈"},{"key":"D","content":"单向队列"}]',
   '["B"]', NULL,
   '哈希表提供 O(1) 查找，双向链表提供 O(1) 的头部插入与尾部淘汰，两者组合是 LRU 的经典实现。',
   5.00, 1, 1, 'published', 2),
  (2, 'Q-2026-000002', 1, 3, 'multiple', 3,
   '关于 HTTP/2 相对 HTTP/1.1 的改进，下列说法正确的是？',
   '[{"key":"A","content":"支持多路复用，同一连接并发多个请求"},{"key":"B","content":"使用 HPACK 进行头部压缩"},{"key":"C","content":"强制要求必须使用 TLS 加密"},{"key":"D","content":"采用二进制分帧层传输"}]',
   '["A","B","D"]', NULL,
   'HTTP/2 的核心改进包括二进制分帧、多路复用与头部压缩；TLS 在实践中被主流浏览器要求，但协议本身并不强制。',
   10.00, 1, 1, 'published', 2),
  (3, 'Q-2026-000003', 1, 4, 'judge',    2,
   '在关系数据库中，第三范式（3NF）要求消除非主属性对码的传递函数依赖。',
   NULL,
   '["true"]', NULL,
   '3NF 的定义即为在 2NF 基础上消除非主属性对码的传递函数依赖。',
   5.00, 1, 1, 'published', 2),
  (4, 'Q-2026-000004', 1, 3, 'fill',     3,
   'TCP 三次握手中，服务端回复给客户端的第二个报文段携带的标志位是 ____（填写标志位名称组合）。',
   NULL,
   '["SYN+ACK"]', NULL,
   '第二次握手由服务端发送 SYN=1、ACK=1 的报文，即 SYN+ACK。',
   10.00, 1, 1, 'published', 2),
  (5, 'Q-2026-000005', 1, 5, 'short',    3,
   '请简述 JWT（JSON Web Token）的三个组成部分，并说明各部分在服务端鉴权中的作用。',
   NULL,
   '[]',
   '[{"point":"指出 Header、Payload、Signature 三部分","score":6},{"point":"说明 Header 描述算法与类型","score":4},{"point":"说明 Payload 承载声明（用户ID、角色、过期时间）","score":5},{"point":"说明 Signature 用于防篡改校验","score":5}]',
   'JWT 由 Header.Payload.Signature 三段 Base64URL 编码后以点号连接。服务端用密钥重算签名校验完整性，并校验 exp 与角色声明。',
   20.00, 1, 1, 'published', 2);

-- 题目版本快照（初始版本，REQ-QBM-02）
INSERT INTO `qb_question_version` (`question_id`, `version_no`, `snapshot`, `change_type`, `change_summary`, `changed_by`) VALUES
  (1, 1, '{"questionId":1,"questionNo":"Q-2026-000001","questionType":"single","difficulty":2,"stem":"以下哪种数据结构最适合实现 O(1) 时间复杂度的 LRU 缓存淘汰策略？","options":[{"key":"A","content":"顺序数组"},{"key":"B","content":"哈希表 + 双向链表"},{"key":"C","content":"栈"},{"key":"D","content":"单向队列"}],"correctAnswer":["B"],"analysis":"哈希表提供 O(1) 查找，双向链表提供 O(1) 的头部插入与尾部淘汰，两者组合是 LRU 的经典实现。","defaultScore":5.00,"knowledgePointId":2}', 'create', '题目创建', 2),
  (2, 1, '{"questionId":2,"questionNo":"Q-2026-000002","questionType":"multiple","difficulty":3,"stem":"关于 HTTP/2 相对 HTTP/1.1 的改进，下列说法正确的是？","options":[{"key":"A","content":"支持多路复用，同一连接并发多个请求"},{"key":"B","content":"使用 HPACK 进行头部压缩"},{"key":"C","content":"强制要求必须使用 TLS 加密"},{"key":"D","content":"采用二进制分帧层传输"}],"correctAnswer":["A","B","D"],"analysis":"HTTP/2 的核心改进包括二进制分帧、多路复用与头部压缩；TLS 在实践中被主流浏览器要求，但协议本身并不强制。","defaultScore":10.00,"knowledgePointId":3}', 'create', '题目创建', 2);

-- 7.10 示例试卷（5 题，总分 50）
INSERT INTO `pp_paper` (`id`, `paper_no`, `paper_name`, `owner_id`, `assembly_mode`, `total_score`, `question_count`, `duration_minutes`, `used_count`, `status`, `description`, `created_by`) VALUES
  (1, 'PAPER-2026-0001', '计算机专业综合能力测验（A 卷）', 2, 'manual', 50.00, 5, 90, 1, 'locked', '覆盖数据结构、计算机网络、数据库、Web 安全，含 1 道主观题', 2);

INSERT INTO `pp_paper_question` (`paper_id`, `question_id`, `section_no`, `order_no`, `score`, `question_snapshot`) VALUES
  (1, 1, 1, 1, 5.00, '{"questionId":1,"questionNo":"Q-2026-000001","questionType":"single","difficulty":2,"stem":"以下哪种数据结构最适合实现 O(1) 时间复杂度的 LRU 缓存淘汰策略？","options":[{"key":"A","content":"顺序数组"},{"key":"B","content":"哈希表 + 双向链表"},{"key":"C","content":"栈"},{"key":"D","content":"单向队列"}],"correctAnswer":["B"],"analysis":"哈希表提供 O(1) 查找，双向链表提供 O(1) 的头部插入与尾部淘汰，两者组合是 LRU 的经典实现。","defaultScore":5.00,"knowledgePointId":2}'),
  (1, 2, 1, 2, 10.00, '{"questionId":2,"questionNo":"Q-2026-000002","questionType":"multiple","difficulty":3,"stem":"关于 HTTP/2 相对 HTTP/1.1 的改进，下列说法正确的是？","options":[{"key":"A","content":"支持多路复用，同一连接并发多个请求"},{"key":"B","content":"使用 HPACK 进行头部压缩"},{"key":"C","content":"强制要求必须使用 TLS 加密"},{"key":"D","content":"采用二进制分帧层传输"}],"correctAnswer":["A","B","D"],"analysis":"HTTP/2 的核心改进包括二进制分帧、多路复用与头部压缩；TLS 在实践中被主流浏览器要求，但协议本身并不强制。","defaultScore":10.00,"knowledgePointId":3}'),
  (1, 3, 1, 3, 5.00, '{"questionId":3,"questionNo":"Q-2026-000003","questionType":"judge","difficulty":2,"stem":"在关系数据库中，第三范式（3NF）要求消除非主属性对码的传递函数依赖。","options":null,"correctAnswer":["true"],"analysis":"3NF 的定义即为在 2NF 基础上消除非主属性对码的传递函数依赖。","defaultScore":5.00,"knowledgePointId":4}'),
  (1, 4, 2, 4, 10.00, '{"questionId":4,"questionNo":"Q-2026-000004","questionType":"fill","difficulty":3,"stem":"TCP 三次握手中，服务端回复给客户端的第二个报文段携带的标志位是 ____（填写标志位名称组合）。","options":null,"correctAnswer":["SYN+ACK"],"analysis":"第二次握手由服务端发送 SYN=1、ACK=1 的报文，即 SYN+ACK。","defaultScore":10.00,"knowledgePointId":3}'),
  (1, 5, 3, 5, 20.00, '{"questionId":5,"questionNo":"Q-2026-000005","questionType":"short","difficulty":3,"stem":"请简述 JWT（JSON Web Token）的三个组成部分，并说明各部分在服务端鉴权中的作用。","options":null,"correctAnswer":[],"scoringPoints":[{"point":"指出 Header、Payload、Signature 三部分","score":6},{"point":"说明 Header 描述算法与类型","score":4},{"point":"说明 Payload 承载声明（用户ID、角色、过期时间）","score":5},{"point":"说明 Signature 用于防篡改校验","score":5}],"analysis":"JWT 由 Header.Payload.Signature 三段 Base64URL 编码后以点号连接。服务端用密钥重算签名校验完整性，并校验 exp 与角色声明。","defaultScore":20.00,"knowledgePointId":5}');

-- 7.11 示例考试（UTC 2026-11-10 01:00 ~ 03:00 = 北京时间 09:00 ~ 11:00）
INSERT INTO `ex_exam`
  (`id`, `exam_no`, `exam_name`, `paper_id`, `owner_id`, `start_time`, `end_time`, `duration_minutes`, `pass_score`, `max_attempts`,
   `shuffle_questions`, `anti_cheat_enabled`, `anti_cheat_threshold`, `auto_submit_on_timeout`, `score_status`, `status`, `description`, `created_by`) VALUES
  (1, 'EXAM-2026-0001', '2026 春季《计算机专业综合》期中考试', 1, 2,
   '2026-11-10 01:00:00.000', '2026-11-10 03:00:00.000', 90, 30.00, 1,
   1, 1, 3, 1, 'unpublished', 'published',
   '考试窗口 2 小时，单次作答 90 分钟；开启题目乱序与防作弊采集', 2);

INSERT INTO `ex_exam_scope` (`exam_id`, `scope_type`, `class_id`, `student_id`) VALUES
  (1, 'class', 1, NULL),
  (1, 'student', NULL, 3);

INSERT INTO `ex_exam_task` (`exam_id`, `student_id`, `status`, `attempts_allowed`, `attempts_used`, `notified_at`) VALUES
  (1, 3, 'pending', 1, 0, NOW(3));

-- 7.12 示例公告
INSERT INTO `sys_notice` (`title`, `content`, `target_role`, `status`, `publish_at`, `expire_at`, `created_by`) VALUES
  ('系统上线通知', '在线考试系统（OES）已上线试运行，请教师于考前完成题库与试卷准备，学生请提前测试浏览器与网络。', 'all', 'published', NOW(3), '2026-12-31 23:59:59.000', 1);

SET FOREIGN_KEY_CHECKS = 1;

-- =====================================================================
-- 8. 一致性自检（可选执行，用于验收 NFR-18）
-- =====================================================================
-- 8.1 校验答卷总分是否等于各题最终得分之和（应返回 0 行）
-- SELECT a.id, a.total_score, COALESCE(SUM(q.final_score),0) AS sum_score
--   FROM ex_exam_attempt a
--   LEFT JOIN ex_attempt_question q ON q.attempt_id = a.id
--  WHERE a.status IN ('graded','reviewed')
--  GROUP BY a.id, a.total_score
-- HAVING a.total_score <> COALESCE(SUM(q.final_score),0);
--
-- 8.2 校验试卷总分是否等于各题分值之和（应返回 0 行）
-- SELECT p.id, p.total_score, COALESCE(SUM(pq.score),0) AS sum_score
--   FROM pp_paper p LEFT JOIN pp_paper_question pq ON pq.paper_id = p.id
--  GROUP BY p.id, p.total_score
-- HAVING p.total_score <> COALESCE(SUM(pq.score),0);
--
-- 8.3 校验是否存在多条进行中答卷（应返回 0 行）
-- SELECT exam_id, student_id, COUNT(*) FROM ex_exam_attempt
--  WHERE status='ongoing' GROUP BY exam_id, student_id HAVING COUNT(*) > 1;

-- =====================================================================
-- 脚本结束
-- =====================================================================