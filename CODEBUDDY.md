# CODEBUDDY.md This file provides guidance to CodeBuddy when working with code in this repository.

物料开发认证管理系统（Material Cert Manager）：物料认证、选型、稽核与供应商/BOM 管理的企业内部 Web 系统。纯本地部署形态，单进程 Node.js，无独立前端工程、无编译步骤，改完直接重启即可生效。界面与代码注释以中文为主，保持中文命名风格。

## 常用命令

- 安装依赖：`npm install`（Node 需 `>=22.5`，依赖 `node:sqlite` 内置模块，推荐 Node 24 LTS；不支持 Node 22.5 以下版本）。
- 启动服务：`npm start` 或 `node server.js`。默认监听 `0.0.0.0:3000`，单机模式下同端口托管 `public/` 静态页面与 `/api`、`/uploads`。启动成功打印各页面访问地址。
- 语法快速冒烟（无 lint/无测试框架，语法自检即可）：`node --check server.js db.js public/js/common.js`。全部前端 JS 非打包脚本，无单测入口。
- 灌入演示数据：先启动服务再运行 `node seed-demo.js`（走 HTTP 写演示物料；物料库已有数据会自动跳过）。
- 冒烟登录验证：`curl -c cookies.txt -X POST http://localhost:3000/api/login -H "Content-Type: application/json" -d "{\"username\":\"admin\",\"password\":\"admin123\"}"`。内置账号 `admin/admin123` 在 `db.js` 首次启动时创建。
- Windows 本地启停：双击根目录「启动系统.bat」/「停止系统.bat」。部署相关见 `deploy/`（systemd + Nginx 反代样例）与根 `Dockerfile`（CloudRun 容器）。

## 架构总览

### 进程与数据引导

两个入口文件构成全部后端：
- `db.js`：数据库定义 + 启动引导。顶层代码在 `require` 时立即执行：创建 `data/materials.db`（`node:sqlite` 同步 API `DatabaseSync`）、建表、旧库字段迁移、业务枚举迁移、权限/角色/默认账号种子。**因此修改 `db.js` 必须重启进程才生效。**
- `server.js`：Express 应用与全部 REST API（无路由拆分文件）。启动时加载轻量 `.env`（手写解析，用于 AI 接口等密钥），之后按 会话认证 → 权限 → 数据范围 的顺序叠加中间件。

业务数据按表存储：`materials`（物料汇总，含绿区/黄区/红区认证状态与 ROHS/REACH/MSDS/规格书四类资料字段）、`projects`（BOM 信息，含大量规格列）、`prestudies`（预研/项目专项，含立项/P1/P2/P3 里程碑）、`suppliers`、`audits`、`qcps`、`categories` + `material_categories`（三级品类树）。统一约定：表字段为 snake_case，UI 中文列名与字段的映射集中在字段常量表。

### 老库迁移的固定套路

新增业务字段时沿用既有模式：在 `db.js` 先给 `CREATE TABLE` 增加列，再仿照 `migrateProjects/migrateSuppliers/migrateAudits/migratePrestudies/migrateQcps`，用 `PRAGMA table_info` 检测缺失列并 `ALTER TABLE ... ADD COLUMN`（均为 `TEXT DEFAULT ''`），保证老库启动即平滑升级。不要跳过迁移 IIFE。

### 认证与权限（多层防线）

- 第一层：`POST /api/login` 建立 `express-session`（cookie `sid`，12h），`/api` 前缀由 `requireAuth` 拦截，前端 `common.js` 收到 401 自动跳 `login.html?redirect=`。
- 第二层：功能权限。`permissions` 表为代码清单（菜单 `page:*` + 操作 `action:*`，源在 `db.js` 的 `PERMISSIONS`），角色 `roles ↔ role_permissions ↔ user_roles` 授予。接口用 `requirePermission('action:edit')` 之类声明式守卫；每页导航由前端按 `page:*` 权限隐藏。
- 第三层：数据范围。用户可被授予 `user_category_scopes`（品类）与 `user_supplier_scopes`（供应商）；列表/统计/导出/批量导入接口统一用 `scopeWhere` 注入范围过滤（`allowAllWhenEmpty` 语义），前端下拉同样受范围约束。业务接口若绕过 `scopeWhere` 需谨慎。
- 第四层：特殊规则。`page:admin` 与 `page:categories` 为管理员专属，`db.js`/`server.js` 顶部的 `ADMIN_ONLY_MENUS`、`ensureReadonlyNoAdmin`、`syncCategoryPermWithAdminLevel` 会持续修正角色权限，不要让普通角色拿到这两个菜单。

### 业务模块的通用 CRUD 模式

每个业务对象在 `server.js` 内遵循几乎相同的结构，新增/改造模块可整套仿写：
- 字段白名单常量（`PROJECT_SPEC_FIELDS`、`SUPPLIER_FIELDS`、`AUDIT_FIELDS`、`QCP_FIELDS`、`PRESTUDY_FIELDS` 等，格式 `[中文列名, 字段名]`）+ 对应 `pickX(body)` 过滤非法列。
- 路由集：列表（关键词/品类/状态/供应商筛选 + 分页）、详情增删改、批量导入、导出（`exportRoute(table, 显示名)` 生成的 `.xlsx`，列头即上述字段常量，也用作批量导入模板列）、统计（`/api/<obj>/stats`）。
- 导入响应含 `success/skipped/errors` 明细，行级容错。

**改动一个业务字段时需同步的点**：`db.js` 建表 + 迁移、`server.js` 字段常量与 `pickX`、前端表格表头与表单 `public/js/<模块>.js` 与对应 `.html`。遗漏任一环都会出现「后端存了新列但前端看不见 / 导入列对不上」。

### 前端组织

多页面静态站点，无框架无构建：每业务模块一个 HTML + 同名 `public/js/<模块>.js`，共享 `public/css/style.css` 与 `public/js/common.js`（`api/apiGet/apiPost/...` 封装、品类下拉统一从 `/api/meta` 拉取、Toast/确认框/状态徽章/分页渲染、菜单权限隐藏与高亮）。页面清单以侧边栏菜单为准：物料汇总表 `index.html`、看板 `dashboard.html`、项目 `prestudy.html`、选型 `selection.html`、稽核 `audits.html`、BOM信息 `projects.html`、供应商 `suppliers.html`、关键工艺 `qcps.html`、系统管理 `admin.html`、品类管理 `categories.html`、选型查重 `select.html`（走 `/api/check` 查重）、登录 `login.html`。页面标题/描述、导航文案在 HTML 中硬编码；改模块显示名需同时处理各页菜单、模块页 `h1/title/desc`、`db.js` 的 `PERMISSIONS` 显示名，并在部署副本同步（见下）。

### 文档解析与 AI 提取

`projects` 与 `prestudies` 支持上传原始文件自动提取入库：`parseDocument` 按扩展名用 `pdf-parse` / `mammoth` / `xlsx` 抽文本表格 → 规则提取（`ruleExtract`/`ruleExtractPrestudy` 关键词扫描）→ 可选大模型 JSON 提取（`aiExtract`，直接走 OpenAI 兼容 HTTP，模型地址与密钥经 `.env`/环境变量注入，未配置时自动回退规则结果）。提取结果先返回前端弹窗确认再落库，接口不直接写库。

### 上传与附件

`POST /api/upload` 接收 base64，按扩展名分类存入 `uploads/` 并由 `/uploads` 静态暴露（供应商附件、稽核附件等多处复用）。`express.json` body 上限已放大为 50mb。

### 部署形态

- 单机模式（默认）：本服务同时托管 `public/`、`/api`、`/uploads`，浏览器直连 `:3000`。
- 分离模式：`SERVE_STATIC=0` + `HOST=127.0.0.1`，前端交给 Nginx 反代（样例见 `deploy/nginx-materials.conf`、`material-api.service`）。
- 云托管：根 `Dockerfile` 基于 `node:24-slim`，`npm ci` 后启动 `server.js`。**`_cloudrun_stage/` 是 CloudRun 部署的源码暂存副本，代码/文案改动需同步该目录后再打包**，否则线上与本地不一致。

### 目录约定

`data/materials.db`（运行时生成，勿入库）、`uploads/`（附件，勿入库）、`public/js/vendor/`（第三方库）。`.env` 可选存放 AI 接口等密钥，`.dockerignore` 已排除 data/uploads。无内置测试与 CI，改动正确性靠 `node --check` + 冒烟请求验证。
