# 物料认证系统 · Spring Boot 后端

Node 版（`server.js` + SQLite）的 Spring Boot 3 迁移实现，配套数据存储改为 MySQL 8。
前端（`../frontend`，React SPA）**无需任何改动**，构建产物由本服务挂在 `/app` 路径下，浏览器访问地址与原来一致。

## 环境要求

| 依赖 | 版本 |
| --- | --- |
| JDK | 17+ |
| Maven | 3.8+（构建用，也可用 IDE 自带） |
| MySQL | 8.x |

## 关键设计

- 无 JPA，全部走 `JdbcTemplate`，SQL 与 Node 版一一对应；
- 建表脚本 `src/main/resources/schema.sql`，**启动时自动执行**（`CREATE TABLE IF NOT EXISTS`，幂等），并注入默认角色/权限/账号；
- 登录会话用内存 Map 模拟（cookie `sid`，12 小时），cookie 属性与 Node 版一致；
- 权限双层守卫：`@RequirePerm("action:xxx")` / `page:xxx`，超管放行；数据范围按用户授予的品类/供应商 scope 自动注入 SQL（等价 Node `scopeWhere`）；
- 接口返回与 Node 版保持同一契约：snake_case 字段、错误体 `{ message }`、时间统一 `yyyy-MM-dd HH:mm:ss`（`SELECT *` 的 DATETIME/TIMESTAMP 也已通过 Jackson 自定义序列化统一）；
- 导出 `.xlsx` 为自实现轻量写入器（Apache POI 无依赖）。

## 启动步骤

1. 构建前端（产物目录 `../frontend/dist`）：

   ```bash
   cd ../frontend
   npm install
   npm run build
   cd ../backend
   ```

2. 准备 MySQL 并配置连接（默认 `localhost:3306`、库 `material_cert`、账号 `root` 空密码）：

   ```bash
   # Windows PowerShell 示例
   $env:SPRING_DATASOURCE_USERNAME="material"; $env:SPRING_DATASOURCE_PASSWORD="你的密码"
   mvn spring-boot:run
   ```

3. 访问：浏览器打开 `http://localhost:3000/app`，登录账号 `admin / admin123`（首启种子数据）。

> 注意：默认端口沿用 3000，**必须先停止 Node 版服务**再启动本服务，避免端口冲突；
> 附件目录默认 `../uploads`、前端目录默认 `../frontend/dist`（相对 `backend/` 运行目录）。

## 配置项（环境变量）

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP 监听端口 |
| `SPRING_DATASOURCE_URL` | `jdbc:mysql://localhost:3306/material_cert?createDatabaseIfNotExist=true&...` | MySQL 连接串（自动建库） |
| `SPRING_DATASOURCE_USERNAME` | `root` | 数据库账号 |
| `SPRING_DATASOURCE_PASSWORD` | （空） | 数据库密码 |
| `FRONTEND_DIST` | `../frontend/dist` | React 构建产物目录 |
| `UPLOAD_DIR` | `../uploads` | 附件落盘目录（经 `/uploads/**` 访问） |

## 常用接口清单

（前缀 `/api`，权限语义与 Node 版一致）

| 模块 | 说明 |
| --- | --- |
| `POST /login`、`GET /me`、`POST /logout` | 会话认证 |
| `GET /meta`、`GET /stats` | 全局元数据与看板统计 |
| `/materials`、`/check`、`/material-categories` | 物料库 CRUD / 查重 / 三级品类 |
| `/suppliers`、`/audits`、`/qcps`、`/projects`、`/prestudies` | 各业务模块 CRUD + `/batch` 导入 + `/export` 导出 + `/stats` |
| `/users`、`/roles`、`/permissions` | 系统管理 |
| `POST /upload` | base64 附件上传，返回 `{ url }` |

## 数据迁移说明

MySQL 库启动后为空表，由种子数据提供角色/权限/内置账号；
历史业务数据（SQLite `data/materials.db`）**不会自动迁移**，如需迁移请另行用脚本导出导入。
Schema 以 Node `db.js` 的业务字段为准做了同构重建（含 `cert_expire_date`、`source`、`progress` 等差异列）。
