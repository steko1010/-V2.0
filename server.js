const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const session = require('express-session');
const { db, STATUSES, DOCS, DOC_LABELS, DOC_STATUSES, PROJECT_SPEC_FIELDS, SUPPLIER_FIELDS } = require('./db');

// 迁移修正：只读内置角色不应拥有「系统管理」菜单权限（防止旧库历史数据误授权）
(function ensureReadonlyNoAdmin() {
  try {
    const role = db.prepare("SELECT id FROM roles WHERE code = 'readonly'").get();
    if (role) {
      db.prepare("DELETE FROM role_permissions WHERE role_id = ? AND perm_code = 'page:admin'").run(role.id);
    }
  } catch (e) { /* 表不存在时忽略 */ }
})();

// 迁移：品类为管理员专属菜单 —— 持续同步规则：
// 1) 任何未持有「系统管理」菜单（非管理员级）的角色都不得持有「品类」菜单（收回早期自动授予）；
// 2) 持有「系统管理」菜单的管理员级角色自动补齐「品类」菜单（与超级管理员目录一致）。
(function syncCategoryPermWithAdminLevel() {
  try {
    db.prepare(`
      DELETE FROM role_permissions
      WHERE perm_code = 'page:categories'
        AND role_id IN (
          SELECT rp.role_id FROM role_permissions rp
          WHERE NOT EXISTS (
            SELECT 1 FROM role_permissions a
            WHERE a.role_id = rp.role_id AND a.perm_code = 'page:admin'
          )
        )
    `).run();
    db.prepare(`
      INSERT OR IGNORE INTO role_permissions (role_id, perm_code)
      SELECT DISTINCT rp.role_id, 'page:categories'
      FROM role_permissions rp
      WHERE rp.perm_code = 'page:admin'
    `).run();
  } catch (e) { /* 表不存在时忽略 */ }
})();

// 轻量 .env 加载（零依赖，支持 AI 大模型接口等配置）
(function loadEnv() {
  try {
    const envFile = path.join(__dirname, '.env');
    if (!fs.existsSync(envFile)) return;
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq <= 0) continue;
      let key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch (e) {
    console.error('.env 加载失败:', e.message);
  }
})();

const app = express();
const PORT = process.env.PORT || 3000;
// 监听地址：默认 0.0.0.0 便于本机/局域网直接访问；
// 前后端分离部署（Nginx 反代）时建议 HOST=127.0.0.1，仅允许本机 Nginx 访问后端
const HOST = process.env.HOST || '0.0.0.0';
// 是否由本服务托管前端页面：默认 true（单机模式，访问 3000 端口即可用）；
// 前后端分离部署时设 SERVE_STATIC=0，前端 public 交给 Nginx，本服务只提供 /api 与 /uploads
const SERVE_STATIC = String(process.env.SERVE_STATIC || '1') !== '0';

// 上传与批量导入以 JSON/Base64 提交，放大请求体上限（默认 100kb 会 413）
app.use(express.json({ limit: '50mb' }));
// 静态资源不缓存，避免浏览器加载旧版 JS/CSS（开发模式）
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// ================= 第一层：会话与登录准入 =================
const SESSION_SECRET = process.env.SESSION_SECRET || 'material-cert-dev-secret-change-me';
app.use(session({
  name: 'sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 12, // 12 小时
  },
}));

if (SERVE_STATIC) {
  // 单机模式：本服务托管前端页面（public 目录，旧版多页）
  app.use(express.static(path.join(__dirname, 'public')));

  // React SPA（frontend/ 构建产物）挂载在 /app 前缀下；渐进迁移期间与新/旧页面并存
  const feDist = path.join(__dirname, 'frontend', 'dist');
  if (fs.existsSync(feDist)) {
    app.use('/app', express.static(feDist));
    // history 路由回退到 SPA 入口
    app.get('/app/*', (req, res) => res.sendFile(path.join(feDist, 'index.html')));
    app.get('/app', (req, res) => res.redirect('/app/'));
  }
}
// 附件上传目录静态托管（前后端分离部署时同样由本服务提供，Nginx 反代 /uploads）
const UPLOAD_DIR = path.join(__dirname, 'uploads');
app.use('/uploads', express.static(UPLOAD_DIR));

// ---------- 工具函数 ----------

function cleanRow(row) {
  if (!row) return null;
  return row;
}

// 校验新增/更新数据：仅保留合法字段
function pickMaterial(body, { partial = false } = {}) {
  const allowed = [
    'code', 'name', 'model', 'category', 'supplier', 'manufacturer',
    'unit', 'status', 'cert_expire_date', 'rohs', 'reach', 'msds',
    'datasheet', 'applied_by', 'applied_at', 'remark'
  ];
  const out = {};
  for (const key of allowed) {
    if (body[key] !== undefined) {
      out[key] = String(body[key]).trim();
    }
  }
  if (!partial && !out.name) {
    const err = new Error('物料名称不能为空');
    err.status = 400;
    throw err;
  }
  if (out.status !== undefined && !STATUSES.includes(out.status)) {
    out.status = '黄区';
  }
  for (const d of DOCS) {
    if (out[d] !== undefined && !DOC_STATUSES.includes(out[d])) {
      out[d] = '待补';
    }
  }
  return out;
}

// ================= 权限系统（第一/二/三/四层） =================

// 加载当前登录用户（包含角色、权限、数据范围）
function loadUserPerms(userId) {
  const user = db.prepare('SELECT id, username, display_name, status, is_super FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  const roles = db.prepare(`
    SELECT r.id, r.code, r.name FROM roles r
    INNER JOIN user_roles ur ON ur.role_id = r.id
    WHERE ur.user_id = ?
  `).all(userId);
  const roleIds = roles.map((r) => r.id);
  let permissions = [];
  if (user.is_super) {
    permissions = db.prepare('SELECT code FROM permissions').all().map((r) => r.code);
  } else if (roleIds.length) {
    const placeholders = roleIds.map(() => '?').join(',');
    permissions = db.prepare(
      `SELECT DISTINCT perm_code AS code FROM role_permissions WHERE role_id IN (${placeholders})`
    ).all(...roleIds).map((r) => r.code);
  }
  const categories = db.prepare('SELECT category FROM user_category_scopes WHERE user_id = ?').all(userId).map((r) => r.category);
  const suppliers = db.prepare('SELECT supplier FROM user_supplier_scopes WHERE user_id = ?').all(userId).map((r) => r.supplier);
  return { ...user, roles, permissions, scopes: { categories, suppliers }, isSuper: !!user.is_super };
}

// 鉴权中间件：必须登录
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ message: '未登录或登录已过期' });
  }
  if (!req.session.user || req.session.user.expiresAt < Date.now()) {
    req.session.user = loadUserPerms(req.session.userId);
    req.session.user.expiresAt = Date.now() + 60_000; // 1 分钟内复用缓存
    if (!req.session.user || req.session.user.status !== '启用') {
      req.session.destroy(() => {});
      return res.status(401).json({ message: '账号已停用或不存在' });
    }
  }
  req.user = req.session.user;
  next();
}

// 鉴权中间件：必须拥有指定权限码
function requirePermission(...codes) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: '未登录' });
    if (req.user.isSuper) return next();
    const has = codes.some((c) => req.user.permissions.includes(c));
    if (!has) return res.status(403).json({ message: '没有该操作权限' });
    next();
  };
}

// 品类操作鉴权：必须「可见品类页」且「持有对应操作权限」（超管自动放行）
// 品类为管理员专属模块，普通角色即使持有全局 action:* 也无法越权操作
function requireCategoryAction(actionCode) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: '未登录' });
    if (req.user.isSuper) return next();
    const ok =
      req.user.permissions.includes('page:categories') &&
      req.user.permissions.includes(actionCode);
    if (!ok) return res.status(403).json({ message: '没有该操作权限' });
    next();
  };
}

// 第三层：数据范围过滤（按用户可见的品类 / 供应商）
function scopeWhere(req, { categoryField, supplierField, allowAllWhenEmpty = true }) {
  const parts = [];
  const params = [];
  if (req.user.isSuper) return { where: '', params };
  const { categories, suppliers } = req.user.scopes || {};
  // 品类
  if (categories && categories.length && categoryField) {
    const ph = categories.map(() => '?').join(',');
    parts.push(`(${categoryField} IN (${ph}) OR ${categoryField} = '' OR ${categoryField} IS NULL)`);
    params.push(...categories);
  } else if (!allowAllWhenEmpty && categoryField) {
    parts.push(`1=0`);
  }
  // 供应商
  if (suppliers && suppliers.length && supplierField) {
    const ph = suppliers.map(() => '?').join(',');
    parts.push(`(${supplierField} IN (${ph}))`);
    params.push(...suppliers);
  } else if (!allowAllWhenEmpty && supplierField) {
    parts.push(`1=0`);
  }
  return { where: parts.length ? ' AND ' + parts.join(' AND ') : '', params };
}

function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  const message = err.message || '服务器内部错误';
  if (err && String(err.message).includes('UNIQUE constraint failed')) {
    return res.status(409).json({ message: '物料编码已存在，请勿重复录入' });
  }
  console.error(err);
  res.status(status).json({ message });
}

// ---------- 通用 Excel 批量导入 / 导出 ----------
function buildXlsxBuffer(sheetName, headers, rows) {
  const XLSX = require('xlsx');
  const aoa = [headers];
  rows.forEach((r) => aoa.push(r));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(12, Math.min(32, String(h).length * 2 + 4)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function sendXlsx(res, buf, fileName) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(buf);
}

// 通用批量导入路由：POST /api/{table}/batch，body 为 [{字段:值},...] 或 {items:[...]}
// extraFn(req)：可选，按请求补写 pick 之外的固定列（如 prestudies.kind 归属清单）
// 去重口径：同一对象（项目 / 专项 / 物料…）允许多条记录（一个项目会有多条风险点、多条信息），
// 逐条入库；只有「所有导入列内容完全一致」的行才算重复 —— 文件内重复合并为一条、
// 与库中已有记录重复则跳过，均计入 skipped，绝不覆盖或删除已有数据。
function batchInsertRoute(table, fields, pick, mustField, extraFn) {
  return (req, res, next) => {
    try {
      const items = Array.isArray(req.body) ? req.body : ((req.body && req.body.items) || []);
      if (!items.length) return res.status(400).json({ message: '没有可导入的数据' });
      const extra = (extraFn ? extraFn(req) : null) || {};
      const cols = fields.concat(Object.keys(extra));
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const insert = db.prepare(
        `INSERT INTO ${table} (${cols.join(',')}, created_at, updated_at) VALUES (${cols.map(() => '?').join(',')}, ?, ?)`
      );
      const text = (v) => String(v === undefined || v === null ? '' : v).trim();
      // 比较维度 = 导入列 + 固定列（如 kind），同名不同清单的两条记录互不算重复
      const keyOf = (row) => cols.map((k) => text(row[k])).join('\u0001');
      const existed = new Set();
      try {
        db.prepare(`SELECT ${cols.join(',')} FROM ${table}`).all().forEach((r) => existed.add(keyOf(r)));
      } catch (e) { /* 老库缺列等异常时退化为不去重，保证导入可用 */ }
      const results = { success: 0, skipped: 0, errors: [] };
      db.exec('BEGIN');
      try {
        for (const [i, raw] of items.entries()) {
          try {
            const data = pick(raw || {});
            if (mustField && !data[mustField]) throw new Error(`缺少必填字段「${mustField}」`);
            const row = {};
            cols.forEach((k) => { row[k] = data[k] !== undefined ? data[k] : extra[k]; });
            const key = keyOf(row);
            if (existed.has(key)) { results.skipped++; continue; }   // 内容完全重复 → 合并/跳过
            existed.add(key);                                        // 同一文件内后续重复行同样跳过
            insert.run(...cols.map((k) => (row[k] === undefined || row[k] === null ? '' : row[k])), now, now);
            results.success++;
          } catch (e) {
            results.errors.push({ row: raw, rowIndex: i + 2, message: e.message || '数据格式错误' });
          }
        }
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      res.status(201).json(results);
    } catch (e) { next(e); }
  };
}

// 通用导出路由：GET /api/{table}/export
// scopeFn(req) => { where, params }，用于按用户数据范围过滤
function exportRoute(table, sheetName, headers, fields, scopeFn, sort = 'ASC') {
  return (req, res, next) => {
    try {
      const scope = scopeFn ? scopeFn(req) : { where: '', params: [] };
      const rows = db.prepare(`SELECT * FROM ${table} WHERE 1=1${scope.where} ORDER BY id ${sort === 'ASC' ? 'ASC' : 'DESC'}`).all(...scope.params);
      const aoa = [headers];
      rows.forEach((r) => aoa.push(fields.map((f) => (r[f] === null || r[f] === undefined ? '' : r[f]))));
      const buf = buildXlsxBuffer(sheetName, headers, aoa);
      sendXlsx(res, buf, `${table}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e) { next(e); }
  };
}

// 常见物料类别后缀，用于从名称中提取核心关键词
const SUFFIXES = [
  '贴片电阻', '贴片电容', '贴片电感', '电阻', '电容', '电感', '二极管', '三极管',
  '晶体管', '芯片', '集成电路', 'IC', '连接器', '插座', '排针', '排母', '开关',
  '按钮', '传感器', '线束', '线材', '线缆', '电缆', '电池', '电芯', '马达',
  '电机', '继电器', '保险丝', '熔断器', '晶振', '滤波器', '变压器', '磁珠',
  '磁环', '端子', '螺钉', '螺栓', '螺母', '垫圈', '垫片', '弹簧', '铆钉',
  '标签', '铭牌', '纸箱', '包装袋', '泡沫', '密封圈', '密封垫', '散热片',
  '散热器', '风扇', '导轨', '齿轮', '皮带', '轴承', '灯泡', '灯珠', '显示屏',
  '触摸屏', '电路板', 'PCB', '排线', '天线', '麦克风', '扬声器', '蜂鸣器',
  '摄像头', '透镜', '镜片', '支架', '外壳', '护套', '套管', '胶带', '双面胶',
  '扎带', '卡扣', '卡箍', '垫块', '绝缘片', '保护罩', '防尘罩',
];

// 剥离名称中的类别后缀，返回核心特征词（如「贴片电阻」→「贴片」）
function stripSuffix(name) {
  let s = String(name || '').trim();
  for (const suffix of SUFFIXES) {
    if (s.endsWith(suffix) && s.length > suffix.length) {
      s = s.slice(0, -suffix.length);
      break;
    }
  }
  return s.trim();
}

// 自动生成物料编码：M-<年份>-<4位序号>（新增时未填编码则自动生成）
function generateCode() {
  const year = new Date().getFullYear();
  const prefix = `M-${year}-`;
  const row = db.prepare('SELECT code FROM materials WHERE code LIKE ? ORDER BY code DESC LIMIT 1').get(`${prefix}%`);
  let next = 1;
  if (row && row.code) {
    const m = String(row.code).match(/(\d+)$/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${String(next).padStart(4, '0')}`;
}

// ---------- 认证 / 权限 API（必须最先声明，避免被 requireAuth 拦截） ----------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ message: '请输入账号与密码' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username).trim());
  if (!user || user.password !== String(password) || user.status !== '启用') {
    return res.status(401).json({ message: '账号或密码错误' });
  }
  const userPerms = loadUserPerms(user.id);
  req.session.userId = user.id;
  req.session.user = userPerms;
  req.session.user.expiresAt = Date.now() + 60_000;
  res.json({ ok: true, user: userPerms });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// 内置权限码列表（供前端登录后加载）
app.get('/api/permissions', requireAuth, (req, res) => {
  res.json({ items: db.prepare('SELECT code, name, kind FROM permissions ORDER BY kind DESC, sort').all() });
});

// 用户管理（仅超管）

// 账号自动生成专属角色时授予的默认权限：7 个业务页面菜单（等同只读角色；品类为管理员专属，不在此列）
const USER_ROLE_DEFAULT_PERMS = [
  'page:index', 'page:prestudy', 'page:selection', 'page:audits',
  'page:projects', 'page:suppliers', 'page:qcps',
];

// 为用户创建（或复用）同名专属角色：编码=账号、名称=姓名，返回角色 id
function ensureUserRole(username, displayName) {
  let role = db.prepare('SELECT id FROM roles WHERE code = ?').get(username);
  if (!role) {
    const info = db.prepare(
      'INSERT INTO roles (code, name, description, built_in) VALUES (?, ?, ?, 0)'
    ).run(username, displayName || username, '账号自动生成的专属角色');
    const set = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, perm_code) VALUES (?, ?)');
    for (const c of USER_ROLE_DEFAULT_PERMS) set.run(info.lastInsertRowid, c);
    return info.lastInsertRowid;
  }
  return role.id;
}

app.get('/api/users', requireAuth, requirePermission('page:admin'), (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.status, u.is_super, u.created_at,
      GROUP_CONCAT(r.name) AS roles
    FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id
    LEFT JOIN roles r ON r.id = ur.role_id
    GROUP BY u.id ORDER BY u.id
  `).all();
  const items = rows.map((u) => ({
    ...u,
    scopes: {
      categories: db.prepare('SELECT category FROM user_category_scopes WHERE user_id = ?').all(u.id).map((r) => r.category),
      suppliers: db.prepare('SELECT supplier FROM user_supplier_scopes WHERE user_id = ?').all(u.id).map((r) => r.supplier),
    },
  }));
  res.json({ items });
});

app.post('/api/users', requireAuth, requirePermission('page:admin'), (req, res, next) => {
  try {
    const { username, password, display_name, status = '启用', is_super = 0, role_ids = [], scopes = {} } = req.body || {};
    if (!username || !password) return res.status(400).json({ message: '账号与密码必填' });
    const uname = String(username).trim();
    const info = db.prepare(
      'INSERT INTO users (username, password, display_name, status, is_super) VALUES (?, ?, ?, ?, ?)'
    ).run(uname, String(password), display_name || '', status, is_super ? 1 : 0);
    const uid = info.lastInsertRowid;
    // 账号/姓名同步：自动创建同名角色（编码=账号、名称=姓名）并自动勾选分配
    const ownRoleId = ensureUserRole(uname, display_name);
    const roleIds = new Set((role_ids || []).map((r) => parseInt(r, 10)));
    roleIds.add(ownRoleId);
    const setRoles = db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)');
    for (const rid of roleIds) setRoles.run(uid, rid);
    const setCat = db.prepare('INSERT OR IGNORE INTO user_category_scopes (user_id, category) VALUES (?, ?)');
    for (const c of (scopes.categories || [])) setCat.run(uid, c);
    const setSup = db.prepare('INSERT OR IGNORE INTO user_supplier_scopes (user_id, supplier) VALUES (?, ?)');
    for (const s of (scopes.suppliers || [])) setSup.run(uid, s);
    res.status(201).json(loadUserPerms(uid));
  } catch (e) { next(e); }
});

app.put('/api/users/:id', requireAuth, requirePermission('page:admin'), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const exists = db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(id);
    if (!exists) return res.status(404).json({ message: '用户不存在' });
    const { username, password, status, display_name, is_super, role_ids, scopes } = req.body || {};
    const fields = [];
    const vals = [];
    // 账号变更（唯一性预检）
    let newUsername = null;
    if (username !== undefined) {
      newUsername = String(username).trim();
      if (!newUsername) return res.status(400).json({ message: '账号不能为空' });
      if (newUsername !== exists.username) {
        if (db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(newUsername, id)) {
          return res.status(400).json({ message: '账号已存在' });
        }
        fields.push('username = ?'); vals.push(newUsername);
      }
    }
    // 同名专属角色（编码=原账号）存在且需要同步时，预检新编码冲突
    const ownRole = db.prepare('SELECT id FROM roles WHERE code = ?').get(exists.username);
    const roleSyncNeeded = !!ownRole && (
      (newUsername !== null && newUsername !== exists.username) ||
      (display_name !== undefined && display_name !== exists.display_name)
    );
    if (roleSyncNeeded && newUsername !== null && newUsername !== exists.username) {
      if (db.prepare('SELECT id FROM roles WHERE code = ? AND id != ?').get(newUsername, ownRole.id)) {
        return res.status(400).json({ message: '角色编码「' + newUsername + '」已被其他角色占用' });
      }
    }
    if (password !== undefined && password !== '') { fields.push('password = ?'); vals.push(String(password)); }
    if (status !== undefined) { fields.push('status = ?'); vals.push(status); }
    if (display_name !== undefined) { fields.push('display_name = ?'); vals.push(display_name); }
    if (is_super !== undefined) { fields.push('is_super = ?'); vals.push(is_super ? 1 : 0); }
    if (fields.length) {
      vals.push(id);
      db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
    }
    // 账号/姓名同步到同名专属角色（编码=账号、名称=姓名）
    if (roleSyncNeeded) {
      const newRoleCode = newUsername !== null && newUsername !== exists.username ? newUsername : exists.username;
      const newRoleName = display_name !== undefined && display_name !== exists.display_name ? display_name : exists.display_name;
      db.prepare('UPDATE roles SET code = ?, name = ? WHERE id = ?').run(newRoleCode, newRoleName || newRoleCode, ownRole.id);
    }
    if (Array.isArray(role_ids)) {
      db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(id);
      const set = db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)');
      for (const rid of role_ids) set.run(id, parseInt(rid, 10));
    }
    if (scopes) {
      if (Array.isArray(scopes.categories)) {
        db.prepare('DELETE FROM user_category_scopes WHERE user_id = ?').run(id);
        const set = db.prepare('INSERT OR IGNORE INTO user_category_scopes (user_id, category) VALUES (?, ?)');
        for (const c of scopes.categories) set.run(id, c);
      }
      if (Array.isArray(scopes.suppliers)) {
        db.prepare('DELETE FROM user_supplier_scopes WHERE user_id = ?').run(id);
        const set = db.prepare('INSERT OR IGNORE INTO user_supplier_scopes (user_id, supplier) VALUES (?, ?)');
        for (const s of scopes.suppliers) set.run(id, s);
      }
    }
    res.json(loadUserPerms(id));
  } catch (e) { next(e); }
});

app.delete('/api/users/:id', requireAuth, requirePermission('page:admin'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id) return res.status(400).json({ message: '不能删除当前登录账号' });
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ message: '用户不存在' });
  db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM user_category_scopes WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM user_supplier_scopes WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  // 一并删除该用户的同名专属角色（若未被其他用户使用）
  const ownRole = db.prepare('SELECT id FROM roles WHERE code = ?').get(user.username);
  if (ownRole) {
    const used = db.prepare('SELECT COUNT(*) AS c FROM user_roles WHERE role_id = ? AND user_id != ?').get(ownRole.id, id);
    if (!used.c) {
      db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(ownRole.id);
      db.prepare('DELETE FROM user_roles WHERE role_id = ?').run(ownRole.id);
      db.prepare('DELETE FROM roles WHERE id = ?').run(ownRole.id);
    }
  }
  res.json({ ok: true });
});

// 角色列表
app.get('/api/roles', requireAuth, requirePermission('page:admin'), (req, res) => {
  const roles = db.prepare('SELECT id, code, name, description, built_in FROM roles ORDER BY id').all();
  const permStmt = db.prepare('SELECT perm_code FROM role_permissions WHERE role_id = ?');
  for (const r of roles) r.permissions = permStmt.all(r.id).map((x) => x.perm_code);
  res.json({ items: roles });
});

app.post('/api/roles', requireAuth, requirePermission('page:admin'), (req, res, next) => {
  try {
    const body = req.body || {};
    const { code, name, description = '' } = body;
    const rawPerms = Array.isArray(body.permission_codes) ? body.permission_codes : [];
    // 品类为管理员专属菜单：未同时授予「系统管理」的角色不得持有
    const permission_codes = rawPerms.filter((c) => !(c === 'page:categories' && !rawPerms.includes('page:admin')));
    if (!code || !name) return res.status(400).json({ message: '账号与姓名必填' });
    const info = db.prepare('INSERT INTO roles (code, name, description) VALUES (?, ?, ?)').run(code, name, description);
    const set = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, perm_code) VALUES (?, ?)');
    for (const c of permission_codes) set.run(info.lastInsertRowid, c);
    res.status(201).json(db.prepare('SELECT * FROM roles WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) { next(e); }
});

app.put('/api/roles/:id', requireAuth, requirePermission('page:admin'), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const exists = db.prepare('SELECT built_in FROM roles WHERE id = ?').get(id);
    if (!exists) return res.status(404).json({ message: '角色不存在' });
    const { name, description, permission_codes } = req.body || {};
    if (name !== undefined || description !== undefined) {
      const fields = [];
      const vals = [];
      if (name !== undefined) { fields.push('name = ?'); vals.push(name); }
      if (description !== undefined) { fields.push('description = ?'); vals.push(description); }
      if (fields.length) {
        vals.push(id);
        db.prepare(`UPDATE roles SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
      }
    }
    if (Array.isArray(permission_codes)) {
      // 品类为管理员专属菜单：未同时授予「系统管理」的角色不得持有
      const filtered = permission_codes.filter((c) => !(c === 'page:categories' && !permission_codes.includes('page:admin')));
      db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(id);
      const set = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, perm_code) VALUES (?, ?)');
      for (const c of filtered) set.run(id, c);
    }
    res.json(db.prepare('SELECT * FROM roles WHERE id = ?').get(id));
  } catch (e) { next(e); }
});

app.delete('/api/roles/:id', requireAuth, requirePermission('page:admin'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const role = db.prepare('SELECT built_in FROM roles WHERE id = ?').get(id);
  if (!role) return res.status(404).json({ message: '角色不存在' });
  db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(id);
  db.prepare('DELETE FROM user_roles WHERE role_id = ?').run(id);
  db.prepare('DELETE FROM roles WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.get('/api/roles/:id/permissions', requireAuth, requirePermission('page:admin'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  res.json({ items: db.prepare('SELECT perm_code FROM role_permissions WHERE role_id = ?').all(id).map((r) => r.perm_code) });
});

// 通用鉴权：除登录/注销外，所有 /api/* 都必须登录
app.use('/api', (req, res, next) => {
  if (req.path === '/login' || req.path === '/logout') return next();
  return requireAuth(req, res, next);
});

// ---------- 物料 CRUD ----------

// 列表：搜索 + 筛选 + 分页
app.get('/api/materials', (req, res) => {
  const { keyword, category, status, supplier, page = 1, pageSize = 20 } = req.query;
  const where = [];
  const params = [];

  if (keyword) {
    const k = `%${keyword}%`;
    where.push('(code LIKE ? OR name LIKE ? OR model LIKE ? OR supplier LIKE ? OR manufacturer LIKE ?)');
    params.push(k, k, k, k, k);
  }
  if (category) { where.push('category = ?'); params.push(category); }
  if (status) { where.push('status = ?'); params.push(status); }
  if (supplier) { where.push('supplier = ?'); params.push(supplier); }

  // 第三层：按用户可见品类 / 供应商过滤
  const scope = scopeWhere(req, { categoryField: 'category', supplierField: 'supplier', allowAllWhenEmpty: true });
  if (scope.where) { where.push(scope.where.replace(/^ AND /, '')); params.push(...scope.params); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const p = Math.max(1, parseInt(page, 10) || 1);
  const ps = Math.max(1, Math.min(100, parseInt(pageSize, 10) || 20));
  const offset = (p - 1) * ps;

  const total = db.prepare(`SELECT COUNT(*) AS c FROM materials ${whereSql}`).get(...params).c;
  const rows = db.prepare(
    `SELECT * FROM materials ${whereSql} ORDER BY id ASC LIMIT ? OFFSET ?`
  ).all(...params, ps, offset);

  res.json({ total, page: p, pageSize: ps, items: rows });
});

// 新增
app.post('/api/materials', requirePermission('action:create'), (req, res, next) => {
  try {
    const data = pickMaterial(req.body);
    if (!data.code) data.code = generateCode();
    data.created_at = data.updated_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const keys = Object.keys(data);
    const sql = `INSERT INTO materials (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
    const info = db.prepare(sql).run(...keys.map((k) => data[k]));
    const row = db.prepare('SELECT * FROM materials WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(cleanRow(row));
  } catch (e) { next(e); }
});

// 批量导入（Excel 批量导入）
app.post('/api/materials/batch', requirePermission('action:import'), (req, res, next) => {
  try {
    const items = Array.isArray(req.body) ? req.body : ((req.body && req.body.items) || []);
    if (!items.length) return res.status(400).json({ message: '没有可导入的数据' });
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const insert = db.prepare(
      'INSERT INTO materials (code, name, model, category, supplier, manufacturer, unit, status, cert_expire_date, rohs, reach, msds, datasheet, applied_by, applied_at, remark, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    );
    const results = { success: 0, skipped: [], errors: [] };
    db.exec('BEGIN');
    try {
      for (const raw of items) {
        try {
          const data = pickMaterial(raw || {});
          if (!data.code) data.code = generateCode();
          data.created_at = data.updated_at = now;
          insert.run(
            data.code || '', data.name || '', data.model || '', data.category || '',
            data.supplier || '', data.manufacturer || '', data.unit || '', data.status || '黄区',
            data.cert_expire_date || '', data.rohs || '待补', data.reach || '待补',
            data.msds || '待补', data.datasheet || '待补', data.applied_by || '',
            data.applied_at || '', data.remark || '', now, now
          );
          results.success++;
        } catch (e) {
          const msg = e && String(e.message).includes('UNIQUE constraint failed')
            ? `编码 ${raw.code || ''} 已存在`
            : (e.message || '数据格式错误');
          results.errors.push({ row: raw, message: msg });
        }
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    res.status(201).json(results);
  } catch (e) { next(e); }
});

// 物料台账导出（支持与列表一致的筛选：keyword / category / status / supplier）
app.get('/api/materials/export', requirePermission('action:export'), (req, res, next) => {
  try {
    const { keyword, category, status, supplier } = req.query;
    const where = [];
    const params = [];
    if (keyword) {
      const k = `%${keyword}%`;
      where.push('(code LIKE ? OR name LIKE ? OR model LIKE ? OR supplier LIKE ? OR manufacturer LIKE ?)');
      params.push(k, k, k, k, k);
    }
    if (category) { where.push('category = ?'); params.push(category); }
    if (status) { where.push('status = ?'); params.push(status); }
    if (supplier) { where.push('supplier = ?'); params.push(supplier); }
    // 按用户可见品类 / 供应商过滤
    const scope = scopeWhere(req, { categoryField: 'category', supplierField: 'supplier', allowAllWhenEmpty: true });
    if (scope.where) { where.push(scope.where.replace(/^ AND /, '')); params.push(...scope.params); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = db.prepare(`SELECT * FROM materials ${whereSql} ORDER BY id ASC`).all(...params);
    const headers = ['编码', '物料名称', '型号规格', '分类', '供应商', '制造商', '认证状态', '认证到期', 'ROHS', 'REACH', '申请人'];
    const fields = ['code', 'name', 'model', 'category', 'supplier', 'manufacturer', 'status', 'cert_expire_date', 'rohs', 'reach', 'applied_by'];
    const aoa = [headers];
    rows.forEach((r) => aoa.push(fields.map((f) => (r[f] === null || r[f] === undefined ? '' : r[f]))));
    const buf = buildXlsxBuffer('物料台账', headers, aoa);
    sendXlsx(res, buf, `materials_${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (e) { next(e); }
});

// 更新
app.put('/api/materials/:id', requirePermission('action:edit'), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const exists = db.prepare('SELECT id FROM materials WHERE id = ?').get(id);
    if (!exists) return res.status(404).json({ message: '物料不存在' });
    const data = pickMaterial(req.body, { partial: true });
    data.updated_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const keys = Object.keys(data);
    if (keys.length === 1) return res.status(400).json({ message: '没有可更新的字段' });
    const sql = `UPDATE materials SET ${keys.map((k) => `${k} = ?`).join(',')} WHERE id = ?`;
    db.prepare(sql).run(...keys.map((k) => data[k]), id);
    const row = db.prepare('SELECT * FROM materials WHERE id = ?').get(id);
    res.json(cleanRow(row));
  } catch (e) { next(e); }
});

// 删除
app.delete('/api/materials/:id', requirePermission('action:delete'), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const info = db.prepare('DELETE FROM materials WHERE id = ?').run(id);
    if (info.changes === 0) return res.status(404).json({ message: '物料不存在' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- 选型查重 ----------

// 输入新物料信息，返回是否在库及相似物料
app.post('/api/check', requirePermission('action:create'), (req, res, next) => {
  try {
    const { name = '', model = '', supplier = '', manufacturer = '', code = '' } = req.body || {};
    const n = String(name).trim();
    const m = String(model).trim();
    const s = String(supplier).trim();
    const man = String(manufacturer).trim();
    const c = String(code).trim();

    if (!n && !m && !c) {
      return res.status(400).json({ message: '请至少输入物料名称、型号或编码之一' });
    }

    const where = [];
    const params = [];

    if (n) { where.push('name = ?'); params.push(n); }
    if (m) { where.push('model = ?'); params.push(m); }
    if (s) { where.push('supplier = ?'); params.push(s); }
    if (c) { where.push('code = ?'); params.push(c); }

    // 1) 精确匹配：名称或型号完全相同
    const exact = db.prepare(
      `SELECT * FROM materials WHERE ${where.join(' OR ')} ORDER BY id DESC LIMIT 50`
    ).all(...params);

    // 2) 模糊匹配：名称 / 型号互相包含（排除已精确命中的）
    //    名称会剥离常见类别后缀（如「贴片电阻」→「贴片」）提取核心词，
    //    从而命中同系列物料（如「贴片电感」「贴片电容」）。
    const fuzzy = [];
    const seen = new Set(exact.map((r) => r.id));
    if (n || m) {
      const terms = [];
      const addTerm = (t) => {
        const s = String(t || '').trim();
        if (s.length >= 2 && !terms.includes(s)) terms.push(s);
      };
      addTerm(n);
      addTerm(stripSuffix(n));
      addTerm(m);

      const likes = [];
      const lp = [];
      for (const t of terms) {
        likes.push('(name LIKE ? OR model LIKE ? OR code LIKE ?)');
        const k = `%${t}%`;
        lp.push(k, k, k);
      }
      if (likes.length) {
        const rows = db.prepare(
          `SELECT * FROM materials WHERE ${likes.join(' OR ')} ORDER BY id DESC LIMIT 50`
        ).all(...lp);
        for (const r of rows) {
          if (!seen.has(r.id)) { fuzzy.push(r); seen.add(r.id); }
        }
      }
    }

    // 3) 判定结论
    const inLibrary = exact.length > 0;
    const tip = inLibrary
      ? '该物料可能已在物料库中，请核实后再立项，避免重复开发。'
      : fuzzy.length > 0
        ? '库中暂未找到完全一致的物料，但存在相似物料，建议先核对。'
        : '库中未找到该物料，可以新增立项。';

    res.json({ inLibrary, tip, exact, fuzzy });
  } catch (e) { next(e); }
});

// ---------- 统计 / 看板 ----------

app.get('/api/stats', (req, res, next) => {
  try {
    // 第三层：按用户可见品类 / 供应商过滤统计
    const scope = scopeWhere(req, { categoryField: 'category', supplierField: 'supplier', allowAllWhenEmpty: true });

    const total = db.prepare(`SELECT COUNT(*) AS c FROM materials WHERE 1=1${scope.where}`).get(...scope.params).c;

    const byStatus = db.prepare(
      `SELECT status AS name, COUNT(*) AS value FROM materials WHERE 1=1${scope.where} GROUP BY status ORDER BY value DESC`
    ).all(...scope.params);

    const byCategory = db.prepare(
      `SELECT category AS name, COUNT(*) AS value FROM materials WHERE category != ''${scope.where} GROUP BY category ORDER BY value DESC LIMIT 12`
    ).all(...scope.params);

    const bySupplier = db.prepare(
      `SELECT supplier AS name, COUNT(*) AS value FROM materials WHERE supplier != ''${scope.where} GROUP BY supplier ORDER BY value DESC LIMIT 10`
    ).all(...scope.params);

    const today = new Date().toISOString().slice(0, 10);
    // 绿区：认证有效
    const certOk = db.prepare(
      `SELECT COUNT(*) AS c FROM materials WHERE status = '绿区'${scope.where}`
    ).get(...scope.params).c;

    // 红区：已过期 / 失效 / 淘汰（需尽快处理）
    const expired = db.prepare(
      `SELECT id, code, name, model, supplier, cert_expire_date, status FROM materials WHERE status = '红区'${scope.where} ORDER BY CASE WHEN cert_expire_date = '' THEN 1 ELSE 0 END, cert_expire_date ASC LIMIT 20`
    ).all(...scope.params);

    // 90 天内到期：绿区中即将到期，需安排重新认证
    const expiring = db.prepare(
      `SELECT id, code, name, model, supplier, cert_expire_date, status FROM materials WHERE status = '绿区' AND cert_expire_date != '' AND cert_expire_date >= ? AND cert_expire_date <= date(?, '+90 day')${scope.where} ORDER BY cert_expire_date ASC LIMIT 20`
    ).all(today, today, ...scope.params);

    // 黄区：认证流程中 / 需关注
    const inProgress = db.prepare(
      `SELECT COUNT(*) AS c FROM materials WHERE status = '黄区'${scope.where}`
    ).get(...scope.params).c;

    // 最近新增
    const recent = db.prepare(
      `SELECT id, code, name, model, status, applied_by, created_at FROM materials WHERE 1=1${scope.where} ORDER BY id DESC LIMIT 10`
    ).all(...scope.params);

    const docCoverage = {};
    for (const d of DOCS) {
      const totalDocs = db.prepare(`SELECT COUNT(*) AS c FROM materials WHERE ${d} = '有'${scope.where}`).get(...scope.params).c;
      docCoverage[DOC_LABELS[d]] = total ? Math.round((totalDocs / total) * 100) : 0;
    }

    res.json({
      total, certOk, inProgress,
      byStatus, byCategory, bySupplier,
      expired, expiring, recent,
      docCoverage
    });
  } catch (e) { next(e); }
});

// 元数据：状态枚举 / 资料状态 / 品类（品类表 + 物料中已存在的分类合并去重）
// 第三层：非超管用户的下拉选项按自身可见范围收敛，避免看到无权限数据
app.get('/api/meta', (req, res) => {
  // 品类下拉库：统一以品类管理（material_categories）维护的「物料中类」为数据源。
  // 品类管理页维护后，物料汇总 / 选型 / 预研 / 稽核 / 供应商 / QCP / 项目 的品类下拉自动同步。
  let categories = [];
  try {
    if (req.user.isSuper || !(req.user.scopes && req.user.scopes.categories && req.user.scopes.categories.length)) {
      const rows = db.prepare(
        `SELECT DISTINCT mid FROM material_categories WHERE TRIM(IFNULL(mid, '')) != ''`
      ).all();
      categories = [...new Set(rows.map((r) => r.mid))];
    } else {
      // 非超管用户：仅返回其被授权的品类范围
      categories = [...req.user.scopes.categories];
    }
  } catch (e) {
    categories = [];
  }
  categories.sort((a, b) => a.localeCompare(b, 'zh'));
  // 供应商下拉库：统一以「供应商信息」页（suppliers 表）维护的供应商为数据源。
  // 该页新增 / 删除 / 导入后前端会调用 useMeta().refresh()，各页面供应商下拉即自动同步。
  const supplierScope = scopeWhere(req, { categoryField: 'material_type', supplierField: 'name', allowAllWhenEmpty: true });
  const suppliers = db.prepare(
    `SELECT DISTINCT name FROM suppliers WHERE TRIM(IFNULL(name, '')) != ''${supplierScope.where}`
  ).all(...supplierScope.params).map((r) => r.name).sort((a, b) => a.localeCompare(b, 'zh'));
  res.json({ statuses: STATUSES, docStatuses: DOC_STATUSES, categories, suppliers });
});

// 新增品类（分类下拉可动态添加）
app.post('/api/categories', requirePermission('action:create'), (req, res, next) => {
  try {
    const name = String((req.body && req.body.name) || '').trim();
    if (!name) return res.status(400).json({ message: '品类名称不能为空' });
    db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)').run(name);
    res.status(201).json({ ok: true, name });
  } catch (e) { next(e); }
});

// ================= 品类管理（物料大类 / 物料中类 / 物料小类） =================
const MC_FIELDS = ['big', 'mid', 'small'];

function pickCategory(body, { partial = false } = {}) {
  const out = {};
  for (const key of MC_FIELDS) {
    if (body[key] !== undefined) out[key] = String(body[key]).trim();
  }
  if (!partial && !out.big) {
    const err = new Error('物料大类不能为空');
    err.status = 400;
    throw err;
  }
  return out;
}

function catPath(row) {
  return [row.big, row.mid, row.small].filter(Boolean).join(' / ') || row.big;
}

// 是否已存在相同 大类+中类+小类 组合
function categoryExists(big, mid, small, excludeId) {
  let sql = 'SELECT id FROM material_categories WHERE big = ? AND mid = ? AND small = ?';
  const params = [big, mid || '', small || ''];
  if (excludeId) {
    sql += ' AND id != ?';
    params.push(excludeId);
  }
  return !!db.prepare(sql).get(...params);
}

// 品类列表：关键字（大类/中类/小类）+ 分页，按层级排序
app.get('/api/material-categories', requirePermission('page:categories'), (req, res) => {
  const keyword = String(req.query.keyword || '').trim();
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
  const where = [];
  const params = [];
  if (keyword) {
    where.push('(big LIKE ? OR mid LIKE ? OR small LIKE ?)');
    const like = `%${keyword}%`;
    params.push(like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM material_categories ${whereSql}`).get(...params).c;
  const rows = db.prepare(
    `SELECT * FROM material_categories ${whereSql} ORDER BY big, mid, small LIMIT ? OFFSET ?`
  ).all(...params, pageSize, (page - 1) * pageSize);
  res.json({ total, page, pageSize, pages: Math.ceil(total / pageSize), items: rows });
});

// 新增品类
app.post('/api/material-categories', requireCategoryAction('action:create'), (req, res, next) => {
  try {
    const data = pickCategory(req.body);
    if (categoryExists(data.big, data.mid, data.small)) {
      return res.status(409).json({ message: `品类「${catPath(data)}」已存在，请勿重复添加` });
    }
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const info = db.prepare(
      'INSERT INTO material_categories (big, mid, small, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(data.big, data.mid || '', data.small || '', now, now);
    res.status(201).json(db.prepare('SELECT * FROM material_categories WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) { next(e); }
});

// 编辑品类
app.put('/api/material-categories/:id', requireCategoryAction('action:edit'), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const exist = db.prepare('SELECT * FROM material_categories WHERE id = ?').get(id);
    if (!exist) return res.status(404).json({ message: '品类不存在' });
    const data = pickCategory(req.body, { partial: true });
    // 大类必填：未提供或置空时回退原值
    const final = {
      big: data.big !== undefined && data.big !== '' ? data.big : exist.big,
      mid: data.mid !== undefined ? data.mid : exist.mid,
      small: data.small !== undefined ? data.small : exist.small,
    };
    if (categoryExists(final.big, final.mid, final.small, id)) {
      return res.status(409).json({ message: `品类「${catPath(final)}」已存在，请勿重复添加` });
    }
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    db.prepare('UPDATE material_categories SET big = ?, mid = ?, small = ?, updated_at = ? WHERE id = ?')
      .run(final.big, final.mid, final.small, now, id);
    res.json(db.prepare('SELECT * FROM material_categories WHERE id = ?').get(id));
  } catch (e) { next(e); }
});

// 批量删除品类（注册在 /:id 之前，避免被参数路由吞掉）
app.delete('/api/material-categories/batch', requireCategoryAction('action:delete'), (req, res, next) => {
  try {
    const { ids = [] } = req.body || {};
    const list = (Array.isArray(ids) ? ids : []).map((x) => parseInt(x, 10)).filter((n) => Number.isInteger(n));
    if (!list.length) return res.status(400).json({ message: '请选择要删除的品类' });
    const ph = list.map(() => '?').join(',');
    const info = db.prepare(`DELETE FROM material_categories WHERE id IN (${ph})`).run(...list);
    res.json({ ok: true, deleted: info.changes });
  } catch (e) { next(e); }
});

// 删除品类
app.delete('/api/material-categories/:id', requireCategoryAction('action:delete'), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const info = db.prepare('DELETE FROM material_categories WHERE id = ?').run(id);
    if (info.changes === 0) return res.status(404).json({ message: '品类不存在' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// 品类批量导入：模板列 = 物料大类 / 物料中类 / 物料小类（逐行去重）
app.post('/api/material-categories/batch', requireCategoryAction('action:import'), (req, res, next) => {
  try {
    const items = Array.isArray(req.body) ? req.body : ((req.body && req.body.items) || []);
    if (!items.length) return res.status(400).json({ message: '没有可导入的数据' });
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const insert = db.prepare(
      'INSERT INTO material_categories (big, mid, small, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    );
    const results = { success: 0, errors: [] };
    db.exec('BEGIN');
    try {
      for (const raw of items) {
        try {
          const data = pickCategory(raw || {});
          if (!data.big) throw new Error('缺少必填字段「物料大类」');
          if (categoryExists(data.big, data.mid, data.small)) {
            throw new Error(`重复的品类「${catPath(data)}」`);
          }
          insert.run(data.big, data.mid || '', data.small || '', now, now);
          results.success++;
        } catch (e) {
          results.errors.push({ row: raw, message: e.message || '数据格式错误' });
        }
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    res.status(201).json(results);
  } catch (e) { next(e); }
});

// 品类批量导出（与列表一致的层级排序）
app.get('/api/material-categories/export', requireCategoryAction('action:export'), (req, res, next) => {
  try {
    const rows = db.prepare('SELECT * FROM material_categories ORDER BY big, mid, small').all();
    const headers = ['物料大类', '物料中类', '物料小类'];
    const aoa = [headers];
    rows.forEach((r) => aoa.push([r.big, r.mid || '', r.small || '']));
    const buf = buildXlsxBuffer('物料品类', headers, aoa);
    sendXlsx(res, buf, `material_categories_${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (e) { next(e); }
});

// ================= BOM信息（第二个主界面） =================

const PROJECT_FIELDS = ['supplier', 'category', 'project_name', 'flow', ...PROJECT_SPEC_FIELDS.map(([, f]) => f)];

function pickProject(body, { partial = false } = {}) {
  const out = {};
  for (const key of PROJECT_FIELDS) {
    if (body[key] !== undefined) {
      out[key] = String(body[key]).trim();
    }
  }
  if (!partial && !out.project_name) {
    const err = new Error('项目名称不能为空');
    err.status = 400;
    throw err;
  }
  return out;
}

// BOM信息列表（支持搜索）
app.get('/api/projects', (req, res) => {
  const { keyword, supplier, category } = req.query;
  const where = [];
  const params = [];
  if (keyword) {
    const k = `%${keyword}%`;
    const searchCols = ['project_name', 'supplier', 'category', 'flow', ...PROJECT_SPEC_FIELDS.map(([, f]) => f)];
    where.push(`(${searchCols.map((c) => `${c} LIKE ?`).join(' OR ')})`);
    searchCols.forEach(() => params.push(k));
  }
  if (supplier) { where.push('supplier = ?'); params.push(supplier); }
  if (category) { where.push('category = ?'); params.push(category); }
  // 第三层：按用户可见品类 / 供应商过滤
  const scope = scopeWhere(req, { categoryField: 'category', supplierField: 'supplier', allowAllWhenEmpty: true });
  if (scope.where) { where.push(scope.where.replace(/^ AND /, '')); params.push(...scope.params); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  // 分页：默认每页 5 条
  const total = db.prepare(`SELECT COUNT(*) AS c FROM projects ${whereSql}`).get(...params).c;
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 5));
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pages, Math.max(1, parseInt(req.query.page, 10) || 1));
  const rows = db.prepare(
    `SELECT * FROM projects ${whereSql} ORDER BY id ASC LIMIT ? OFFSET ?`
  ).all(...params, pageSize, (page - 1) * pageSize);
  res.json({ total, page, pageSize, pages, items: rows });
});

// 批量导出BOM信息（Excel）
app.get('/api/projects/export', requirePermission('action:export'), (req, res, next) => {
  try {
    const { keyword, supplier, category } = req.query;
    const where = [];
    const params = [];
    if (keyword) {
      const k = `%${keyword}%`;
      const searchCols = ['project_name', 'supplier', 'category', 'flow', ...PROJECT_SPEC_FIELDS.map(([, f]) => f)];
      where.push(`(${searchCols.map((c) => `${c} LIKE ?`).join(' OR ')})`);
      searchCols.forEach(() => params.push(k));
    }
    if (supplier) { where.push('supplier = ?'); params.push(supplier); }
    if (category) { where.push('category = ?'); params.push(category); }
    // 第三层：按用户可见品类 / 供应商过滤
    const scope = scopeWhere(req, { categoryField: 'category', supplierField: 'supplier', allowAllWhenEmpty: true });
    if (scope.where) { where.push(scope.where.replace(/^ AND /, '')); params.push(...scope.params); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = db.prepare(`SELECT * FROM projects ${whereSql} ORDER BY id ASC`).all(...params);
    const XLSX = require('xlsx');
    const headers = ['项目名称', '供应商', '品类', '流程', '来源', '录入时间', ...PROJECT_SPEC_FIELDS.map(([label]) => label)];
    const aoa = [headers];
    rows.forEach((r) => {
      aoa.push([
        r.project_name, r.supplier, r.category, r.flow, r.source, r.created_at,
        ...PROJECT_SPEC_FIELDS.map(([, f]) => r[f] || ''),
      ]);
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = headers.map((h) => ({ wch: h === '项目名称' || h === '流程' ? 20 : 14 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'BOM信息');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="projects_${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.send(buf);
  } catch (e) { next(e); }
});

// 新增BOM信息
app.post('/api/projects', requirePermission('action:create'), (req, res, next) => {
  try {
    const data = pickProject(req.body);
    data.source = String(req.body.source || '').trim() === '文档导入' ? '文档导入' : '手动';
    data.created_at = data.updated_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const keys = Object.keys(data);
    const sql = `INSERT INTO projects (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
    const info = db.prepare(sql).run(...keys.map((k) => data[k]));
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(row);
  } catch (e) { next(e); }
});

// Excel 批量导入BOM信息
app.post('/api/projects/batch', requirePermission('action:import'), (req, res, next) => {
  try {
    const items = Array.isArray(req.body) ? req.body : ((req.body && req.body.items) || []);
    if (!items.length) return res.status(400).json({ message: '没有可导入的数据' });
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const insert = db.prepare(
      `INSERT INTO projects (${PROJECT_FIELDS.join(',')}, source, created_at, updated_at) VALUES (${PROJECT_FIELDS.map(() => '?').join(',')}, '文档导入', ?, ?)`
    );
    const results = { success: 0, errors: [] };
    db.exec('BEGIN');
    try {
      for (const raw of items) {
        try {
          const data = pickProject(raw || {});
          if (!data.project_name) throw new Error('项目名称不能为空');
          const vals = PROJECT_FIELDS.map((k) => data[k] || '');
          insert.run(...vals, now, now);
          results.success++;
        } catch (e) {
          results.errors.push({ row: raw, message: e.message || '数据格式错误' });
        }
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    res.status(201).json(results);
  } catch (e) { next(e); }
});

// 更新BOM信息
app.put('/api/projects/:id', requirePermission('action:edit'), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const exists = db.prepare('SELECT id FROM projects WHERE id = ?').get(id);
    if (!exists) return res.status(404).json({ message: 'BOM信息不存在' });
    const data = pickProject(req.body, { partial: true });
    if (req.body.source !== undefined) {
      data.source = String(req.body.source).trim() === '文档导入' ? '文档导入' : '手动';
    }
    data.updated_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const keys = Object.keys(data);
    if (keys.length === 1) return res.status(400).json({ message: '没有可更新的字段' });
    const sql = `UPDATE projects SET ${keys.map((k) => `${k} = ?`).join(',')} WHERE id = ?`;
    db.prepare(sql).run(...keys.map((k) => data[k]), id);
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    res.json(row);
  } catch (e) { next(e); }
});

// 删除BOM信息
app.delete('/api/projects/:id', requirePermission('action:delete'), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const info = db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    if (info.changes === 0) return res.status(404).json({ message: 'BOM信息不存在' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- 文档导入 + 信息提取（子界面一） ----------

// 解析上传文档为纯文本（txt / md / csv / json / pdf / docx）
async function parseDocument(filename, buffer) {
  const ext = String(filename).split('.').pop().toLowerCase();
  if (['txt', 'md', 'csv', 'json', 'log'].includes(ext)) {
    return buffer.toString('utf8');
  }
  if (ext === 'pdf') {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    return data.text || '';
  }
  if (ext === 'docx') {
    const mammoth = require('mammoth');
    const data = await mammoth.extractRawText({ buffer });
    return data.value || '';
  }
  if (['xlsx', 'xls'].includes(ext)) {
    const XLSX = require('xlsx');
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const lines = [];
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true })
        .map((r) => r.map((c) => (c == null ? '' : String(c).trim())));
      if (!rows.length) continue;
      lines.push(`【工作表：${name}】`);
      const maxCols = Math.max(...rows.map((r) => r.filter((c) => c !== '').length));
      if (maxCols <= 2) {
        // 两列键值布局（字段名 | 值）：输出「字段名：值」
        rows.forEach((row) => {
          const [k, v] = [row[0], row[1]].map((c) => c || '');
          if (k && v) lines.push(`${k}：${v}`);
        });
      } else {
        // 宽表：第一行为表头，输出「表头：值」便于信息提取
        const header = rows[0];
        const hasHeader = header.some((h) => h !== '');
        for (let i = hasHeader ? 1 : 0; i < rows.length; i++) {
          rows[i].forEach((cell, j) => {
            if (!cell) return;
            const key = hasHeader ? (header[j] || `列${j + 1}`) : '';
            lines.push(key ? `${key}：${cell}` : cell);
          });
        }
      }
    }
    return lines.join('\n');
  }
  if (ext === 'doc') {
    throw new Error('暂不支持老版 .doc 格式，请另存为 .docx 后再上传');
  }
  throw new Error(`暂不支持 ${ext || '未知'} 格式，请上传 txt / md / csv / pdf / docx / xlsx 文件`);
}

// 规则提取：按关键词行从文本中提取字段（无 AI key 时的兜底）
function ruleExtract(text) {
  const out = { supplier: '', category: '', project_name: '', flow: '' };
  PROJECT_SPEC_FIELDS.forEach(([, f]) => (out[f] = ''));
  const config = [
    ['supplier', ['供应商名称', '供应商', '供方', '厂商', '厂家']],
    ['category', ['品类', '类别', '分类', '物料类型', '产品类别']],
    ['project_name', ['项目名称', '项目名', '产品名称', '项目号', '项目']],
    ['flow', ['认证流程', '开发流程', '流程', '步骤']],
    ...PROJECT_SPEC_FIELDS.map(([label, field]) => [field, [label]]),
  ];
  // 展平并按关键词长度降序，优先匹配更长更具体的关键词（如「LED灯胶」优先于「LED」）
  const flat = config
    .flatMap(([key, kws]) => kws.map((kw) => ({ key, kw })))
    .sort((a, b) => b.kw.length - a.kw.length);
  for (const line of String(text || '').split(/\r?\n/)) {
    const t = line.trim();
    const hit = flat.find(({ key, kw }) => !out[key] && t.includes(kw));
    if (!hit) continue;
    let v = t.replace(hit.kw, '').replace(/^[：:\s]+/, '').trim();
    if (v) out[hit.key] = v;
  }
  return out;
}

// 调用大模型提取（OpenAI 兼容接口），未配置 key 时返回 null
async function aiExtract(text) {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) return null;
  const base = String(process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = process.env.AI_MODEL || 'gpt-4o-mini';
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `你是物料开发认证系统的信息提取助手。请从用户提供的文档文本中提取以下字段并只输出 JSON：supplier（供应商）、category（品类）、project_name（项目名称）、flow（流程，用 -> 连接主要步骤）。另外提取以下显示模组规格字段（用英文键名输出）：${PROJECT_SPEC_FIELDS.map(([label, f]) => `${f}（${label}）`).join('、')}。找不到的字段填空字符串。`
          },
          { role: 'user', content: String(text || '').slice(0, 12000) }
        ]
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    const out = {
      supplier: String(parsed.supplier || '').trim(),
      category: String(parsed.category || '').trim(),
      project_name: String(parsed.project_name || '').trim(),
      flow: String(parsed.flow || '').trim(),
    };
    PROJECT_SPEC_FIELDS.forEach(([label, f]) => {
      out[f] = String(parsed[f] || parsed[label] || '').trim();
    });
    return out;
  } catch (e) {
    console.error('AI 提取失败，已回退规则提取:', e.message);
    return null;
  }
}

// 文档导入：接收 base64 文件，解析文本并提取信息（不落库，由前端确认后导入）
app.post('/api/projects/extract', requirePermission('action:create'), async (req, res, next) => {
  try {
    const { filename = '', base64 = '' } = req.body || {};
    if (!filename || !base64) {
      return res.status(400).json({ message: '请先选择要导入的文档' });
    }
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length) return res.status(400).json({ message: '文件内容为空' });
    if (buffer.length > 20 * 1024 * 1024) {
      return res.status(400).json({ message: '文件不能超过 20MB' });
    }
    const text = await parseDocument(filename, buffer);
    if (!String(text).trim()) {
      return res.status(400).json({ message: '未能从文档中解析出文本内容' });
    }
    let extracted = ruleExtract(text);
    let source = 'rule';
    const ai = await aiExtract(text);
    if (ai && (ai.project_name || ai.supplier)) {
      extracted = { ...extracted, ...ai };
      source = 'ai';
    }
    res.json({ ok: true, filename, source, text: text.slice(0, 20000), extracted });
  } catch (e) {
    console.error(e);
    res.status(400).json({ message: e.message || '文档解析失败' });
  }
});

// ================= 预研专项 =================

const PRESTUDY_FIELDS = ['category', 'supplier', 'topic', 'risk', 'progress', 'milestone_lx', 'milestone_p1', 'milestone_p2', 'milestone_p3', 'status', 'owner'];

function pickPrestudy(body, { partial = false } = {}) {
  const out = {};
  for (const key of PRESTUDY_FIELDS) {
    if (body[key] !== undefined) {
      out[key] = String(body[key]).trim();
    }
  }
  if (!partial && !out.topic) {
    const err = new Error('专项名称不能为空');
    err.status = 400;
    throw err;
  }
  return out;
}

// 记录归属清单：'' = 预研专项（默认）；'research' = 在研项目（风险清单，一行 = 一个风险点）
// 「一、在研项目」与「二、预研专项」是两份独立清单，共用 prestudies 表、靠 kind 区分；
// 新增 / 导入时按所在标签页写入，列表 / 导出 / 看板按 kind 过滤，避免互相串数据。
const PRESTUDY_KIND_RESEARCH = 'research';

function prestudyKind(value) {
  return String(value == null ? '' : value).trim() === PRESTUDY_KIND_RESEARCH ? PRESTUDY_KIND_RESEARCH : '';
}

// kind 过滤条件：'research' 只看在研项目、'all' 看全部，其余（含默认）只看预研专项
// 老库空值按预研专项处理；比较值取自代码常量、不来自请求，直接拼接安全
function prestudyKindWhere(req) {
  const kind = String((req && req.query && req.query.kind) || '').trim();
  if (kind === 'all') return { where: '' };
  if (kind === PRESTUDY_KIND_RESEARCH) return { where: ` AND COALESCE(kind,'') = '${PRESTUDY_KIND_RESEARCH}'` };
  return { where: ` AND COALESCE(kind,'') <> '${PRESTUDY_KIND_RESEARCH}'` };
}

// 预研专项列表（支持搜索）
app.get('/api/prestudies', (req, res, next) => {
  try {
    const { keyword } = req.query;
    const where = [];
    const params = [];
    if (keyword) {
      const k = `%${keyword}%`;
      const searchCols = ['category', 'supplier', 'topic', 'risk', 'milestone_lx', 'milestone_p1', 'milestone_p2', 'milestone_p3', 'status', 'owner'];
      where.push(`(${searchCols.map((c) => `${c} LIKE ?`).join(' OR ')})`);
      searchCols.forEach(() => params.push(k));
    }
    // 归属清单：默认只返回预研专项；「一、在研项目」传 kind=research
    const kindW = prestudyKindWhere(req);
    if (kindW.where) where.push(kindW.where.replace(/^ AND /, ''));
    // 第三层：按用户可见品类过滤
    const scope = scopeWhere(req, { categoryField: 'category', allowAllWhenEmpty: true });
    if (scope.where) { where.push(scope.where.replace(/^ AND /, '')); params.push(...scope.params); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS c FROM prestudies ${whereSql}`).get(...params).c;
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 10));
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(pages, Math.max(1, parseInt(req.query.page, 10) || 1));
    const rows = db.prepare(
      `SELECT * FROM prestudies ${whereSql} ORDER BY id ASC LIMIT ? OFFSET ?`
    ).all(...params, pageSize, (page - 1) * pageSize);
    res.json({ total, page, pageSize, pages, items: rows });
  } catch (e) { next(e); }
});

// 新增预研专项
app.post('/api/prestudies', requirePermission('action:create'), (req, res, next) => {
  try {
    const data = pickPrestudy(req.body);
    // 归属清单由所在标签页决定：在研项目 → 'research'，预研专项 → ''
    data.kind = prestudyKind(req.body && req.body.kind);
    data.source = String(req.body.source || '').trim() === '文档导入' ? '文档导入' : '手动';
    data.created_at = data.updated_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const keys = Object.keys(data);
    const sql = `INSERT INTO prestudies (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
    const info = db.prepare(sql).run(...keys.map((k) => data[k]));
    const row = db.prepare('SELECT * FROM prestudies WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(row);
  } catch (e) { next(e); }
});

// 更新预研专项
app.put('/api/prestudies/:id', requirePermission('action:edit'), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const exists = db.prepare('SELECT id FROM prestudies WHERE id = ?').get(id);
    if (!exists) return res.status(404).json({ message: '预研专项不存在' });
    const data = pickPrestudy(req.body, { partial: true });
    data.updated_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const keys = Object.keys(data);
    if (keys.length === 1) return res.status(400).json({ message: '没有可更新的字段' });
    const sql = `UPDATE prestudies SET ${keys.map((k) => `${k} = ?`).join(',')} WHERE id = ?`;
    db.prepare(sql).run(...keys.map((k) => data[k]), id);
    const row = db.prepare('SELECT * FROM prestudies WHERE id = ?').get(id);
    res.json(row);
  } catch (e) { next(e); }
});

// 删除预研专项
app.delete('/api/prestudies/:id', requirePermission('action:delete'), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const info = db.prepare('DELETE FROM prestudies WHERE id = ?').run(id);
    if (info.changes === 0) return res.status(404).json({ message: '预研专项不存在' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// 预研专项批量导入 / 导出（模板列 = 展示列表表头）
app.post('/api/prestudies/batch', requirePermission('action:import'), batchInsertRoute(
  'prestudies',
  ['category', 'supplier', 'topic', 'risk', 'progress', 'milestone_lx', 'milestone_p1', 'milestone_p2', 'milestone_p3', 'status', 'owner'],
  pickPrestudy, 'topic',
  // 导入到哪个清单由发起导入的标签页决定（前端 body.kind）
  (req) => ({ kind: prestudyKind(req.body && req.body.kind) })
));
app.get('/api/prestudies/export', requirePermission('action:export'), exportRoute(
  'prestudies', '预研专项',
  ['物料品类', '供应商', '专项名称', '风险', '立项', 'P1', 'P2', 'P3', '状态', '责任人'],
  ['category', 'supplier', 'topic', 'risk', 'milestone_lx', 'milestone_p1', 'milestone_p2', 'milestone_p3', 'status', 'owner'],
  (req) => {
    const scope = scopeWhere(req, { categoryField: 'category', allowAllWhenEmpty: true });
    return { where: scope.where + prestudyKindWhere(req).where, params: scope.params };
  }
));

app.get('/api/prestudies/stats', (req, res, next) => {
  try {
    const scope = scopeWhere(req, { categoryField: 'category', allowAllWhenEmpty: true });
    // 统计范围：默认预研专项；?kind=research 看在研项目（风险清单）、?kind=all 看全部
    const whereAll = scope.where + prestudyKindWhere(req).where;
    const total = db.prepare(`SELECT COUNT(*) AS c FROM prestudies WHERE 1=1${whereAll}`).get(...scope.params).c;
    const byCategory = db.prepare(
      `SELECT category AS name, COUNT(*) AS value FROM prestudies WHERE category != ''${whereAll} GROUP BY category ORDER BY value DESC`
    ).all(...scope.params);
    const byStatus = db.prepare(
      `SELECT status AS name, COUNT(*) AS value FROM prestudies WHERE status != ''${whereAll} GROUP BY status ORDER BY value DESC`
    ).all(...scope.params);
    const byProgress = [
      { name: '立项', value: db.prepare(`SELECT COUNT(*) AS c FROM prestudies WHERE milestone_lx != ''${whereAll}`).get(...scope.params).c },
      { name: 'P1', value: db.prepare(`SELECT COUNT(*) AS c FROM prestudies WHERE milestone_p1 != ''${whereAll}`).get(...scope.params).c },
      { name: 'P2', value: db.prepare(`SELECT COUNT(*) AS c FROM prestudies WHERE milestone_p2 != ''${whereAll}`).get(...scope.params).c },
      { name: 'P3', value: db.prepare(`SELECT COUNT(*) AS c FROM prestudies WHERE milestone_p3 != ''${whereAll}`).get(...scope.params).c },
    ];
    const byOwner = db.prepare(
      `SELECT owner AS name, COUNT(*) AS value FROM prestudies WHERE owner != ''${whereAll} GROUP BY owner ORDER BY value DESC LIMIT 10`
    ).all(...scope.params);
    const bySupplier = db.prepare(
      `SELECT supplier AS name, COUNT(*) AS value FROM prestudies WHERE supplier != ''${whereAll} GROUP BY supplier ORDER BY value DESC LIMIT 10`
    ).all(...scope.params);
    // 按项目统计「问题个数」：一个项目可登记多条风险点（一行 = 一个问题），逐条计数 —— 不做项目级合并
    const byTopic = db.prepare(
      `SELECT topic AS name, COUNT(*) AS value FROM prestudies WHERE topic != '' AND TRIM(IFNULL(risk, '')) != ''${whereAll} GROUP BY topic ORDER BY value DESC, name ASC LIMIT 15`
    ).all(...scope.params);
    const issueTotal = db.prepare(
      `SELECT COUNT(*) AS c FROM prestudies WHERE TRIM(IFNULL(risk, '')) != ''${whereAll}`
    ).get(...scope.params).c;
    const projectTotal = db.prepare(
      `SELECT COUNT(DISTINCT topic) AS c FROM prestudies WHERE topic != ''${whereAll}`
    ).get(...scope.params).c;
    const recent = db.prepare(
      `SELECT id, category, topic, milestone_lx, milestone_p1, milestone_p2, milestone_p3, status, owner FROM prestudies WHERE 1=1${whereAll} ORDER BY id DESC LIMIT 8`
    ).all(...scope.params);
    res.json({ total, byCategory, byStatus, byProgress, byOwner, bySupplier, byTopic, issueTotal, projectTotal, recent });
  } catch (e) { next(e); }
});

// 预研文档提取：接收 base64 文件，解析文本并提取预研字段（不落库，由前端确认后导入）
function ruleExtractPrestudy(text) {
  const out = { category: '', topic: '', risk: '', progress: '', status: '', owner: '' };
  const config = [
    ['category', ['品类', '类别', '分类', '物料类型']],
    ['topic', ['专项名称', '专项', '项目名称', '研究专项', '课题名称', '课题']],
    ['risk', ['风险', '风险点', '主要风险']],
    ['progress', ['进度', '当前进度', '完成进度', '完成度']],
    ['status', ['状态', '当前状态']],
    ['owner', ['责任人', '负责人', 'owner', 'Owner', 'OWNER']],
  ];
  const flat = config
    .flatMap(([key, kws]) => kws.map((kw) => ({ key, kw })))
    .sort((a, b) => b.kw.length - a.kw.length);
  for (const line of String(text || '').split(/\r?\n/)) {
    const t = line.trim();
    const hit = flat.find(({ key, kw }) => !out[key] && t.includes(kw));
    if (!hit) continue;
    let v = t.replace(hit.kw, '').replace(/^[：:\s]+/, '').trim();
    // 清理"预研专项/研发专项"类前缀残留词
    v = v.replace(/^(预研|研发|研究|课题|项目)(专项|专题|课题|项目)?[：:\s]*/, '').trim();
    if (v) out[hit.key] = v;
  }
  return out;
}

async function aiExtractPrestudy(text) {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) return null;
  const base = String(process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = process.env.AI_MODEL || 'gpt-4o-mini';
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: '你是预研专项管理系统的信息提取助手。请从用户提供的文档文本中提取预研专项信息并只输出 JSON，字段为：category（品类，取值 CG 或 FPC 或 背光 或 IC，无法判断时填空）、topic（专项名称）、risk（风险）、progress（进度）、status（状态）、owner（责任人）。找不到的字段填空字符串。'
          },
          { role: 'user', content: String(text || '').slice(0, 12000) }
        ]
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    const out = {};
    for (const key of PRESTUDY_FIELDS) {
      out[key] = String(parsed[key] || '').trim();
    }
    return out;
  } catch (e) {
    console.error('预研 AI 提取失败，已回退规则提取:', e.message);
    return null;
  }
}

app.post('/api/prestudies/extract', requirePermission('action:create'), async (req, res, next) => {
  try {
    const { filename = '', base64 = '' } = req.body || {};
    if (!filename || !base64) {
      return res.status(400).json({ message: '请先选择要导入的文档' });
    }
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length) return res.status(400).json({ message: '文件内容为空' });
    if (buffer.length > 20 * 1024 * 1024) {
      return res.status(400).json({ message: '文件不能超过 20MB' });
    }
    const text = await parseDocument(filename, buffer);
    if (!String(text).trim()) {
      return res.status(400).json({ message: '未能从文档中解析出文本内容' });
    }
    let extracted = ruleExtractPrestudy(text);
    let source = 'rule';
    const ai = await aiExtractPrestudy(text);
    if (ai && (ai.topic || ai.category || ai.risk)) {
      extracted = { ...extracted, ...ai };
      source = 'ai';
    }
    res.json({ ok: true, filename, source, text: text.slice(0, 20000), extracted });
  } catch (e) {
    console.error(e);
    res.status(400).json({ message: e.message || '文档解析失败' });
  }
});

// ---------- BOM信息统计（子界面三：分析展示） ----------
app.get('/api/projects/stats', (req, res, next) => {
  try {
    const scope = scopeWhere(req, { categoryField: 'category', supplierField: 'supplier', allowAllWhenEmpty: true });
    const total = db.prepare(`SELECT COUNT(*) AS c FROM projects WHERE 1=1${scope.where}`).get(...scope.params).c;
    const suppliers = db.prepare(
      `SELECT supplier AS name, COUNT(*) AS value FROM projects WHERE supplier != ''${scope.where} GROUP BY supplier ORDER BY value DESC, supplier ASC LIMIT 12`
    ).all(...scope.params);
    const categories = db.prepare(
      `SELECT category AS name, COUNT(*) AS value FROM projects WHERE category != ''${scope.where} GROUP BY category ORDER BY value DESC, category ASC LIMIT 12`
    ).all(...scope.params);
    const sourceCount = db.prepare(
      `SELECT source AS name, COUNT(*) AS value FROM projects WHERE 1=1${scope.where} GROUP BY source ORDER BY value DESC`
    ).all(...scope.params);
    const flowCoverage = db.prepare(
      `SELECT COUNT(*) AS c FROM projects WHERE flow != ''${scope.where}`
    ).get(...scope.params).c;
    const recent = db.prepare(
      `SELECT id, project_name, supplier, category, flow, source, created_at FROM projects WHERE 1=1${scope.where} ORDER BY id DESC LIMIT 8`
    ).all(...scope.params);
    res.json({
      total,
      suppliers,
      categories,
      sourceCount,
      flowCoverage: total ? Math.round((flowCoverage / total) * 100) : 0,
      recent,
    });
  } catch (e) { next(e); }
});

// ================= 供应商信息 =================

const SUPPLIER_WRITE_FIELDS = ['name', 'contact', 'phone', 'email', 'address', 'category', 'rating', 'status', 'remark', ...SUPPLIER_FIELDS.map(([, f]) => f)];

function pickSupplier(body, { partial = false } = {}) {
  const out = {};
  for (const key of SUPPLIER_WRITE_FIELDS) {
    if (body[key] !== undefined) out[key] = String(body[key]).trim();
  }
  if (!partial && !out.name) {
    const err = new Error('供应商不能为空');
    err.status = 400;
    throw err;
  }
  if (out.rating !== undefined && !['A', 'B', 'C', 'D'].includes(out.rating)) out.rating = 'C';
  if (out.status !== undefined && !['合作中', '暂停', '淘汰'].includes(out.status)) out.status = '合作中';
  return out;
}

app.get('/api/suppliers', (req, res) => {
  const { keyword, materialType } = req.query;
  const where = [];
  const params = [];
  if (keyword) {
    const k = `%${keyword}%`;
    where.push(`(name LIKE ? OR contact LIKE ? OR phone LIKE ? OR category LIKE ? OR address LIKE ? OR material_type LIKE ? OR product_type LIKE ? OR module_customers LIKE ? OR terminal_customers LIKE ? OR strengths LIKE ? OR weaknesses LIKE ?)`);
    params.push(k, k, k, k, k, k, k, k, k, k, k);
  }
  if (materialType) { where.push('material_type = ?'); params.push(materialType); }
  // 第三层：按用户可见品类（物料品类）/ 供应商范围过滤
  const scope = scopeWhere(req, { categoryField: 'material_type', supplierField: 'name', allowAllWhenEmpty: true });
  if (scope.where) { where.push(scope.where.replace(/^ AND /, '')); params.push(...scope.params); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM suppliers ${whereSql} ORDER BY id ASC LIMIT 500`).all(...params);
  res.json({ total: rows.length, items: rows });
});

// 供应商批量导入 / 导出（模板列 = 展示列表表头）
app.post('/api/suppliers/batch', requirePermission('action:import'), batchInsertRoute('suppliers', SUPPLIER_WRITE_FIELDS, pickSupplier, 'name'));
app.get('/api/suppliers/export', requirePermission('action:export'), exportRoute(
  'suppliers', '供应商信息',
  ['供应商', '物料品类', '工厂地址', '公司简介', '产品类型', '产能(手机)', '模组客户', '终端客户',
   '体系能力', '自动化能力', '检验能力', '追溯能力', '测试能力', '返修', '优势', '劣势',
   '审核地址', '审核时间', '审核成员', '审核结果', 'QSA', 'QPA', '审核记录', '传音量产记录', '附件'],
  ['name', 'material_type', 'address', 'company_profile', 'product_type', 'capacity_phone', 'module_customers', 'terminal_customers',
   'system_capability', 'automation_capability', 'inspection_capability', 'traceability_capability', 'testing_capability', 'rework', 'strengths', 'weaknesses',
   'audit_address', 'audit_time', 'audit_members', 'audit_result', 'qsa', 'qpa', 'audit_record', 'mass_production_record', 'attachment'],
  (req) => scopeWhere(req, { categoryField: 'material_type', supplierField: 'name', allowAllWhenEmpty: true })
));

app.post('/api/suppliers', requirePermission('action:create'), (req, res, next) => {
  try {
    const data = pickSupplier(req.body);
    data.created_at = data.updated_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const keys = Object.keys(data);
    const sql = `INSERT INTO suppliers (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
    const info = db.prepare(sql).run(...keys.map((k) => data[k]));
    const row = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(row);
  } catch (e) { next(e); }
});

app.put('/api/suppliers/:id', requirePermission('action:edit'), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!db.prepare('SELECT id FROM suppliers WHERE id = ?').get(id)) {
      return res.status(404).json({ message: '供应商不存在' });
    }
    const data = pickSupplier(req.body, { partial: true });
    data.updated_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const keys = Object.keys(data);
    if (keys.length === 1) return res.status(400).json({ message: '没有可更新的字段' });
    const sql = `UPDATE suppliers SET ${keys.map((k) => `${k} = ?`).join(',')} WHERE id = ?`;
    db.prepare(sql).run(...keys.map((k) => data[k]), id);
    res.json(db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id));
  } catch (e) { next(e); }
});

app.delete('/api/suppliers/:id', requirePermission('action:delete'), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const info = db.prepare('DELETE FROM suppliers WHERE id = ?').run(id);
    if (info.changes === 0) return res.status(404).json({ message: '供应商不存在' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.get('/api/suppliers/stats', (req, res, next) => {
  try {
    const scope = scopeWhere(req, { categoryField: 'material_type', supplierField: 'name', allowAllWhenEmpty: true });
    const total = db.prepare(`SELECT COUNT(*) AS c FROM suppliers WHERE 1=1${scope.where}`).get(...scope.params).c;
    const byStatus = db.prepare(
      `SELECT status AS name, COUNT(*) AS value FROM suppliers WHERE 1=1${scope.where} GROUP BY status ORDER BY value DESC`
    ).all(...scope.params);
    const byRating = db.prepare(
      `SELECT rating AS name, COUNT(*) AS value FROM suppliers WHERE 1=1${scope.where} GROUP BY rating ORDER BY rating ASC`
    ).all(...scope.params);
    const byCategory = db.prepare(
      `SELECT material_type AS name, COUNT(*) AS value FROM suppliers WHERE material_type != ''${scope.where} GROUP BY material_type ORDER BY value DESC`
    ).all(...scope.params);
    const mscope = scopeWhere(req, { categoryField: 'category', supplierField: 'supplier', allowAllWhenEmpty: true });
    const materialCounts = db.prepare(
      `SELECT supplier AS name, COUNT(*) AS value FROM materials WHERE supplier != ''${mscope.where} GROUP BY supplier ORDER BY value DESC LIMIT 10`
    ).all(...mscope.params);
    res.json({ total, byStatus, byRating, byCategory, materialCounts });
  } catch (e) { next(e); }
});

// 供应商附件上传：接收 base64 数据，保存到 uploads/suppliers
app.post('/api/upload', requirePermission('action:edit'), (req, res, next) => {
  try {
    const { name = '', base64 = '' } = req.body || {};
    const fileName = String(name).trim();
    if (!fileName || !base64) {
      return res.status(400).json({ message: '缺少文件名称或内容' });
    }
    let data = String(base64);
    if (data.includes(',')) {
      const idx = data.indexOf(',');
      data = data.slice(idx + 1);
    }
    const buf = Buffer.from(data, 'base64');
    if (buf.length > 20 * 1024 * 1024) {
      return res.status(400).json({ message: '附件不能超过 20MB' });
    }
    const safe = fileName.replace(/[\\/:*?"<>|]/g, '_');
    const dir = path.join(UPLOAD_DIR, 'suppliers');
    fs.mkdirSync(dir, { recursive: true });
    const store = `${Date.now()}_${safe}`;
    fs.writeFileSync(path.join(dir, store), buf);
    res.json({ url: `/uploads/suppliers/${store}`, name: safe });
  } catch (e) { next(e); }
});

// ================= 稽核 =================

const AUDIT_FIELDS = ['supplier', 'audit_date', 'auditor', 'material_type', 'scope', 'result', 'score', 'summary', 'action'];

function pickAudit(body, { partial = false } = {}) {
  const out = {};
  for (const key of AUDIT_FIELDS) {
    if (body[key] !== undefined) out[key] = String(body[key]).trim();
  }
  if (!partial && !out.supplier) {
    const err = new Error('稽核供应商不能为空');
    err.status = 400;
    throw err;
  }
  if (out.result !== undefined && !['合格', '有条件合格', '不合格'].includes(out.result)) out.result = '合格';
  return out;
}

app.get('/api/audits', (req, res) => {
  const { keyword, result, materialType } = req.query;
  const where = [];
  const params = [];
  if (keyword) {
    const k = `%${keyword}%`;
    where.push('(supplier LIKE ? OR auditor LIKE ? OR scope LIKE ? OR summary LIKE ? OR material_type LIKE ?)');
    params.push(k, k, k, k, k);
  }
  if (result) { where.push('result = ?'); params.push(result); }
  if (materialType) { where.push('material_type = ?'); params.push(materialType); }
  // 第三层：按用户可见品类（物料品类）/ 供应商范围过滤
  const scope = scopeWhere(req, { categoryField: 'material_type', supplierField: 'supplier', allowAllWhenEmpty: true });
  if (scope.where) { where.push(scope.where.replace(/^ AND /, '')); params.push(...scope.params); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  // 分页：默认每页 10 条
  const total = db.prepare(`SELECT COUNT(*) AS c FROM audits ${whereSql}`).get(...params).c;
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 10));
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pages, Math.max(1, parseInt(req.query.page, 10) || 1));
  const rows = db.prepare(
    `SELECT * FROM audits ${whereSql} ORDER BY id ASC LIMIT ? OFFSET ?`
  ).all(...params, pageSize, (page - 1) * pageSize);
  res.json({ total, page, pageSize, pages, items: rows });
});

app.post('/api/audits', requirePermission('action:create'), (req, res, next) => {
  try {
    const data = pickAudit(req.body);
    data.created_at = data.updated_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const keys = Object.keys(data);
    const sql = `INSERT INTO audits (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
    const info = db.prepare(sql).run(...keys.map((k) => data[k]));
    const row = db.prepare('SELECT * FROM audits WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(row);
  } catch (e) { next(e); }
});

app.put('/api/audits/:id', requirePermission('action:edit'), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!db.prepare('SELECT id FROM audits WHERE id = ?').get(id)) {
      return res.status(404).json({ message: '稽核记录不存在' });
    }
    const data = pickAudit(req.body, { partial: true });
    data.updated_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const keys = Object.keys(data);
    if (keys.length === 1) return res.status(400).json({ message: '没有可更新的字段' });
    const sql = `UPDATE audits SET ${keys.map((k) => `${k} = ?`).join(',')} WHERE id = ?`;
    db.prepare(sql).run(...keys.map((k) => data[k]), id);
    res.json(db.prepare('SELECT * FROM audits WHERE id = ?').get(id));
  } catch (e) { next(e); }
});

app.delete('/api/audits/:id', requirePermission('action:delete'), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const info = db.prepare('DELETE FROM audits WHERE id = ?').run(id);
    if (info.changes === 0) return res.status(404).json({ message: '稽核记录不存在' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// 稽核批量导入 / 导出（模板列 = 展示列表表头）
app.post('/api/audits/batch', requirePermission('action:import'), batchInsertRoute('audits', AUDIT_FIELDS, pickAudit, 'supplier'));
app.get('/api/audits/export', requirePermission('action:export'), exportRoute(
  'audits', '稽核记录',
  ['品类', '时间', '供应商', '稽核内容', '稽核结果', '稽核人员'],
  ['material_type', 'audit_date', 'supplier', 'scope', 'result', 'auditor'],
  (req) => scopeWhere(req, { categoryField: 'material_type', supplierField: 'supplier', allowAllWhenEmpty: true })
));

// 统计稽核内容中问题条目个数（按编号条目或换行条目估算）
function countIssues(scope) {
  if (!scope) return 0;
  const s = String(scope).trim();
  if (!s) return 0;
  const numbered = s.match(/\d+\s*[、.．\)）]/g);
  if (numbered) return numbered.length;
  return s.split(/\r?\n/).filter((l) => l.trim()).length;
}

// 生成 [start, end] 之间的连续月份列表，如 2025-11 ~ 2026-02 → ['2025-11','2025-12','2026-01','2026-02']
function monthRange(start, end) {
  const out = [];
  let [y, m] = start.split('-').map(Number);
  const [endY, endM] = end.split('-').map(Number);
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

app.get('/api/audits/stats', (req, res, next) => {
  try {
    const scope = scopeWhere(req, { categoryField: 'material_type', supplierField: 'supplier', allowAllWhenEmpty: true });
    const total = db.prepare(`SELECT COUNT(*) AS c FROM audits WHERE 1=1${scope.where}`).get(...scope.params).c;
    const byResult = db.prepare(
      `SELECT result AS name, COUNT(*) AS value FROM audits WHERE 1=1${scope.where} GROUP BY result ORDER BY value DESC`
    ).all(...scope.params);
    const recent = db.prepare(
      `SELECT id, supplier, audit_date, auditor, scope, result, score FROM audits WHERE 1=1${scope.where} ORDER BY id DESC LIMIT 8`
    ).all(...scope.params);
    // 按供应商聚合：稽核次数、问题个数、结果分布、最近稽核时间
    const rows = db.prepare(
      `SELECT supplier, material_type, audit_date, scope, result FROM audits WHERE supplier != ''${scope.where}`
    ).all(...scope.params);
    const bySupplier = [];
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.supplier)) {
        map.set(r.supplier, {
          name: r.supplier,
          count: 0,
          issues: 0,
          results: {},
          materialType: r.material_type || '',
          lastDate: r.audit_date || '',
        });
      }
      const item = map.get(r.supplier);
      item.count++;
      item.issues += countIssues(r.scope);
      item.results[r.result || '未知'] = (item.results[r.result || '未知'] || 0) + 1;
      if (r.audit_date && r.audit_date > item.lastDate) item.lastDate = r.audit_date;
    }
    for (const item of map.values()) {
      item.issueCount = item.issues;
      delete item.issues;
      bySupplier.push(item);
    }
    bySupplier.sort((a, b) => b.count - a.count || b.issueCount - a.issueCount);
    // 问题个数趋势：横轴=年（年度）/ 月（月度），纵轴=问题个数，每个供应商一条曲线
    // 两种粒度共用同一批供应商（问题总量 TOP 6），保证切换前后对比的是同一组对象
    const trendPts = [];
    const issuesBySupplier = new Map();
    for (const r of rows) {
      // 兼容 2026-03-12 / 2026/3/12 / 2026.3.12 等日期写法
      const ym = /^(\d{4})(?:[-/.年](\d{1,2}))?/.exec(String(r.audit_date || '').trim());
      if (!ym) continue;
      const mm = Number(ym[2]);
      const issues = countIssues(r.scope);
      issuesBySupplier.set(r.supplier, (issuesBySupplier.get(r.supplier) || 0) + issues);
      trendPts.push({
        supplier: r.supplier,
        year: ym[1],
        month: mm >= 1 && mm <= 12 ? `${ym[1]}-${String(mm).padStart(2, '0')}` : '',
        issues,
      });
    }
    const trendSuppliers = [...issuesBySupplier.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name]) => name);
    const aggBy = (keyOf) => {
      const agg = new Map();
      for (const p of trendPts) {
        const key = keyOf(p);
        if (!key) continue;
        if (!agg.has(p.supplier)) agg.set(p.supplier, {});
        const pts = agg.get(p.supplier);
        pts[key] = (pts[key] || 0) + p.issues;
      }
      return agg;
    };
    const seriesOf = (agg, labels) => trendSuppliers.map((name) => {
      const pts = agg.get(name) || {};
      return { name, values: labels.map((k) => pts[k] || 0) };
    });
    // 年度：只列出数据中出现过的年份
    const years = [...new Set(trendPts.map((p) => p.year))].sort();
    const issueTrend = { years, series: seriesOf(aggBy((p) => p.year), years) };
    // 月度：按数据区间补齐连续月份（最多最近 36 个月），空月计 0，便于看走势
    let months = [...new Set(trendPts.map((p) => p.month).filter(Boolean))].sort();
    if (months.length) months = monthRange(months[0], months[months.length - 1]).slice(-36);
    const issueTrendMonth = { months, series: seriesOf(aggBy((p) => p.month), months) };
    res.json({ total, byResult, recent, bySupplier, issueTrend, issueTrendMonth });
  } catch (e) { next(e); }
});

// ================= QCP 质量控制计划 =================

const QCP_FIELDS = ['category', 'name', 'supplier', 'process', 'control_item', 'spec', 'method', 'freq', 'device', 'responsible', 'status', 'remark'];

function pickQcp(body, { partial = false } = {}) {
  const out = {};
  for (const key of QCP_FIELDS) {
    if (body[key] !== undefined) out[key] = String(body[key]).trim();
  }
  // QCP 内容均为选填，不再强制名称必填
  if (out.status !== undefined && !['草稿', '生效', '作废'].includes(out.status)) out.status = '生效';
  return out;
}

app.get('/api/qcps', (req, res) => {
  const { keyword, status, category } = req.query;
  const where = [];
  const params = [];
  if (keyword) {
    const k = `%${keyword}%`;
    where.push('(name LIKE ? OR category LIKE ? OR supplier LIKE ? OR process LIKE ? OR control_item LIKE ? OR spec LIKE ?)');
    params.push(k, k, k, k, k, k);
  }
  if (status) { where.push('status = ?'); params.push(status); }
  if (category) { where.push('category = ?'); params.push(category); }
  // 第三层：按用户可见品类 / 供应商过滤
  const scope = scopeWhere(req, { categoryField: 'category', supplierField: 'supplier', allowAllWhenEmpty: true });
  if (scope.where) { where.push(scope.where.replace(/^ AND /, '')); params.push(...scope.params); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  // 分页：默认每页 10 条
  const total = db.prepare(`SELECT COUNT(*) AS c FROM qcps ${whereSql}`).get(...params).c;
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 10));
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pages, Math.max(1, parseInt(req.query.page, 10) || 1));
  const rows = db.prepare(
    `SELECT * FROM qcps ${whereSql} ORDER BY id ASC LIMIT ? OFFSET ?`
  ).all(...params, pageSize, (page - 1) * pageSize);
  res.json({ total, page, pageSize, pages, items: rows });
});

app.post('/api/qcps', requirePermission('action:create'), (req, res, next) => {
  try {
    const data = pickQcp(req.body);
    data.created_at = data.updated_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const keys = Object.keys(data);
    const sql = `INSERT INTO qcps (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
    const info = db.prepare(sql).run(...keys.map((k) => data[k]));
    const row = db.prepare('SELECT * FROM qcps WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(row);
  } catch (e) { next(e); }
});

app.put('/api/qcps/:id', requirePermission('action:edit'), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!db.prepare('SELECT id FROM qcps WHERE id = ?').get(id)) {
      return res.status(404).json({ message: 'QCP 不存在' });
    }
    const data = pickQcp(req.body, { partial: true });
    data.updated_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const keys = Object.keys(data);
    if (keys.length === 1) return res.status(400).json({ message: '没有可更新的字段' });
    const sql = `UPDATE qcps SET ${keys.map((k) => `${k} = ?`).join(',')} WHERE id = ?`;
    db.prepare(sql).run(...keys.map((k) => data[k]), id);
    res.json(db.prepare('SELECT * FROM qcps WHERE id = ?').get(id));
  } catch (e) { next(e); }
});

app.delete('/api/qcps/:id', requirePermission('action:delete'), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const info = db.prepare('DELETE FROM qcps WHERE id = ?').run(id);
    if (info.changes === 0) return res.status(404).json({ message: 'QCP 不存在' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// QCP 批量导入 / 导出（模板列 = 展示列表表头）
app.post('/api/qcps/batch', requirePermission('action:import'), batchInsertRoute('qcps', QCP_FIELDS, pickQcp, null));
app.get('/api/qcps/export', requirePermission('action:export'), exportRoute(
  'qcps', '质量计划',
  ['品类', 'QCP 名称', '供应商', '工序', '控制项目', '规格要求', '检验方法', '频次', '检测设备', '责任人', '状态'],
  ['category', 'name', 'supplier', 'process', 'control_item', 'spec', 'method', 'freq', 'device', 'responsible', 'status'],
  (req) => scopeWhere(req, { categoryField: 'category', supplierField: 'supplier', allowAllWhenEmpty: true }),
  'ASC'
));

app.get('/api/qcps/stats', (req, res, next) => {
  try {
    const scope = scopeWhere(req, { categoryField: 'category', supplierField: 'supplier', allowAllWhenEmpty: true });
    const total = db.prepare(`SELECT COUNT(*) AS c FROM qcps WHERE 1=1${scope.where}`).get(...scope.params).c;
    const byStatus = db.prepare(
      `SELECT status AS name, COUNT(*) AS value FROM qcps WHERE 1=1${scope.where} GROUP BY status ORDER BY value DESC`
    ).all(...scope.params);
    const byProcess = db.prepare(
      `SELECT process AS name, COUNT(*) AS value FROM qcps WHERE process != ''${scope.where} GROUP BY process ORDER BY value DESC LIMIT 12`
    ).all(...scope.params);
    const bySupplier = db.prepare(
      `SELECT supplier AS name, COUNT(*) AS value FROM qcps WHERE supplier != ''${scope.where} GROUP BY supplier ORDER BY value DESC LIMIT 10`
    ).all(...scope.params);
    const byCategory = db.prepare(`
      SELECT category AS name,
             COUNT(*) AS processCount
      FROM qcps
      WHERE category != ''${scope.where}
      GROUP BY category
      ORDER BY processCount DESC
    `).all(...scope.params);
    const active = db.prepare(`SELECT COUNT(*) AS c FROM qcps WHERE status = '生效'${scope.where}`).get(...scope.params).c;
    const recent = db.prepare(
      `SELECT id, name, supplier, process, control_item, status FROM qcps WHERE 1=1${scope.where} ORDER BY id DESC LIMIT 8`
    ).all(...scope.params);
    res.json({ total, byStatus, byProcess, bySupplier, byCategory, active, recent });
  } catch (e) { next(e); }
});

app.use(errorHandler);

app.listen(PORT, HOST, () => {
  const mode = SERVE_STATIC
    ? '单机模式：本服务托管前端页面，可直接访问'
    : 'API 模式：前端页面由 Nginx 托管，本服务仅提供 /api 与 /uploads';
  console.log(`物料开发认证管理系统已启动: http://${HOST}:${PORT} [${mode}]`);
  if (SERVE_STATIC) {
    console.log(`选型: http://localhost:${PORT}/selection.html`);
    console.log(`BOM信息: http://localhost:${PORT}/projects.html`);
    console.log(`供应商信息: http://localhost:${PORT}/suppliers.html`);
    console.log(`稽核: http://localhost:${PORT}/audits.html`);
    console.log(`QCP: http://localhost:${PORT}/qcps.html`);
  }
});
