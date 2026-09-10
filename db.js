const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new DatabaseSync(path.join(dataDir, 'materials.db'));

// 项目规格字段：中文列名 -> 数据库字段（按列表展示顺序）
const PROJECT_SPEC_FIELDS = [
  ['基线', 'baseline'],
  ['量产封样时间', 'mass_production_sample_date'],
  ['项目尺寸', 'project_size'],
  ['MOD厂', 'mod_factory'],
  ['MOD料号', 'mod_part_no'],
  ['panel', 'panel'],
  ['IC', 'ic'],
  ['CG厂', 'cg_factory'],
  ['CG材质', 'cg_material'],
  ['FPC', 'fpc'],
  ['OCA', 'oca'],
  ['POL', 'pol'],
  ['COG-ACF', 'cog_acf'],
  ['FOG-ACF', 'fog_acf'],
  ['元器件包封胶', 'component_sealant'],
  ['一线胶', 'one_line_glue'],
  ['面胶', 'face_glue'],
  ['银浆', 'silver_paste'],
  ['硅酮胶', 'silicone_glue'],
  ['盲孔一道胶', 'blind_hole_glue_1'],
  ['盲孔二道胶', 'blind_hole_glue_2'],
  ['背光厂', 'backlight_factory'],
  ['遮光胶', 'shading_tape'],
  ['上/下增光', 'upper_lower_brightness'],
  ['扩散', 'diffuser'],
  ['LED灯胶', 'led_glue'],
  ['反射', 'reflector'],
  ['LED', 'led'],
  ['LGP', 'lgp'],
  ['胶框', 'glue_frame'],
  ['铁框', 'iron_frame'],
];

db.exec(`
  CREATE TABLE IF NOT EXISTS materials (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    code              TEXT UNIQUE,
    name              TEXT NOT NULL,
    model             TEXT DEFAULT '',
    category          TEXT DEFAULT '',
    supplier          TEXT DEFAULT '',
    manufacturer      TEXT DEFAULT '',
    unit              TEXT DEFAULT '',
    status            TEXT DEFAULT '黄区',
    cert_expire_date  TEXT DEFAULT '',
    rohs              TEXT DEFAULT '待补',
    reach             TEXT DEFAULT '待补',
    msds              TEXT DEFAULT '待补',
    datasheet         TEXT DEFAULT '待补',
    applied_by        TEXT DEFAULT '',
    applied_at        TEXT DEFAULT '',
    remark            TEXT DEFAULT '',
    created_at        TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at        TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS projects (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier     TEXT DEFAULT '',
    category     TEXT DEFAULT '',
    project_name TEXT NOT NULL,
    flow         TEXT DEFAULT '',
    source       TEXT DEFAULT '手动',
    baseline    TEXT DEFAULT '',
    mass_production_sample_date TEXT DEFAULT '',
    project_size TEXT DEFAULT '',
    mod_factory TEXT DEFAULT '',
    mod_part_no TEXT DEFAULT '',
    panel       TEXT DEFAULT '',
    ic          TEXT DEFAULT '',
    cg_factory  TEXT DEFAULT '',
    cg_material TEXT DEFAULT '',
    fpc         TEXT DEFAULT '',
    oca         TEXT DEFAULT '',
    pol         TEXT DEFAULT '',
    cog_acf     TEXT DEFAULT '',
    fog_acf     TEXT DEFAULT '',
    component_sealant TEXT DEFAULT '',
    one_line_glue TEXT DEFAULT '',
    face_glue   TEXT DEFAULT '',
    silver_paste TEXT DEFAULT '',
    silicone_glue TEXT DEFAULT '',
    blind_hole_glue_1 TEXT DEFAULT '',
    blind_hole_glue_2 TEXT DEFAULT '',
    backlight_factory TEXT DEFAULT '',
    shading_tape TEXT DEFAULT '',
    upper_lower_brightness TEXT DEFAULT '',
    diffuser    TEXT DEFAULT '',
    led_glue    TEXT DEFAULT '',
    reflector   TEXT DEFAULT '',
    led         TEXT DEFAULT '',
    lgp         TEXT DEFAULT '',
    glue_frame  TEXT DEFAULT '',
    iron_frame  TEXT DEFAULT '',
    created_at   TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at   TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS suppliers (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    name                  TEXT NOT NULL,
    contact               TEXT DEFAULT '',
    phone                 TEXT DEFAULT '',
    email                 TEXT DEFAULT '',
    address               TEXT DEFAULT '',
    category              TEXT DEFAULT '',
    rating                TEXT DEFAULT 'C',
    status                TEXT DEFAULT '合作中',
    remark                TEXT DEFAULT '',
    material_type         TEXT DEFAULT '',
    company_profile       TEXT DEFAULT '',
    product_type          TEXT DEFAULT '',
    capacity_phone        TEXT DEFAULT '',
    module_customers      TEXT DEFAULT '',
    terminal_customers    TEXT DEFAULT '',
    system_capability     TEXT DEFAULT '',
    automation_capability TEXT DEFAULT '',
    inspection_capability TEXT DEFAULT '',
    traceability_capability TEXT DEFAULT '',
    testing_capability    TEXT DEFAULT '',
    rework                TEXT DEFAULT '',
    strengths             TEXT DEFAULT '',
    weaknesses            TEXT DEFAULT '',
    attachment            TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS audits (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier     TEXT NOT NULL,
    audit_date   TEXT DEFAULT '',
    auditor      TEXT DEFAULT '',
    material_type TEXT DEFAULT '',
    scope        TEXT DEFAULT '',
    result       TEXT DEFAULT '合格',
    score        TEXT DEFAULT '',
    summary      TEXT DEFAULT '',
    action       TEXT DEFAULT '',
    created_at   TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at   TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS prestudies (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    category   TEXT DEFAULT '',
    supplier   TEXT DEFAULT '',
    topic      TEXT NOT NULL,
    risk       TEXT DEFAULT '',
    progress   TEXT DEFAULT '',
    milestone_lx TEXT DEFAULT '',
    milestone_p1 TEXT DEFAULT '',
    milestone_p2 TEXT DEFAULT '',
    milestone_p3 TEXT DEFAULT '',
    status     TEXT DEFAULT '',
    owner      TEXT DEFAULT '',
    kind       TEXT DEFAULT '',
    source     TEXT DEFAULT '手动',
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS categories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS qcps (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    category     TEXT DEFAULT '',
    name         TEXT NOT NULL,
    supplier     TEXT DEFAULT '',
    process      TEXT DEFAULT '',
    control_item TEXT DEFAULT '',
    spec         TEXT DEFAULT '',
    method       TEXT DEFAULT '',
    freq         TEXT DEFAULT '',
    device       TEXT DEFAULT '',
    responsible  TEXT DEFAULT '',
    status       TEXT DEFAULT '生效',
    remark       TEXT DEFAULT '',
    created_at   TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at   TEXT DEFAULT (datetime('now', 'localtime'))
  );
`);

// 认证状态（业务枚举）：绿区=认证有效，黄区=流程中/需关注，红区=已过期/失效/淘汰
const STATUSES = ['绿区', '黄区', '红区'];

// 认证状态迁移：旧 6 态 → 三区（绿区/黄区/红区）
// 已认证+已过期 → 红区；已认证（未过期）→ 绿区；开发中/送样测试/认证中 → 黄区；已失效/已淘汰 → 红区
db.exec(`
  UPDATE materials SET status = '红区'
    WHERE status = '已认证' AND cert_expire_date != '' AND cert_expire_date < date('now', 'localtime');
  UPDATE materials SET status = '绿区' WHERE status = '已认证';
  UPDATE materials SET status = '黄区' WHERE status IN ('开发中', '送样测试', '认证中');
  UPDATE materials SET status = '红区' WHERE status IN ('已失效', '已淘汰');
`);
// 资料项（业务枚举）
const DOCS = ['rohs', 'reach', 'msds', 'datasheet'];
const DOC_LABELS = { rohs: 'ROHS', reach: 'REACH', msds: 'MSDS', datasheet: '规格书' };
// 资料状态（业务枚举）
const DOC_STATUSES = ['有', '无', '待补'];

// 老库迁移：为 projects 表补充缺失的规格字段列
(function migrateProjects() {
  const existing = new Set(db.prepare('PRAGMA table_info(projects)').all().map((c) => c.name));
  for (const [, field] of PROJECT_SPEC_FIELDS) {
    if (!existing.has(field)) {
      db.exec(`ALTER TABLE projects ADD COLUMN ${field} TEXT DEFAULT ''`);
    }
  }
})();

// 供应商新增字段：物料品类及明细字段（中文列名 -> 数据库字段）
const SUPPLIER_FIELDS = [
  ['物料品类', 'material_type'],
  ['公司简介', 'company_profile'],
  ['产品类型', 'product_type'],
  ['产能(手机)', 'capacity_phone'],
  ['模组客户', 'module_customers'],
  ['终端客户', 'terminal_customers'],
  ['体系能力', 'system_capability'],
  ['自动化能力', 'automation_capability'],
  ['检验能力', 'inspection_capability'],
  ['追溯能力', 'traceability_capability'],
  ['测试能力', 'testing_capability'],
  ['返修', 'rework'],
  ['优势', 'strengths'],
  ['劣势', 'weaknesses'],
  ['附件', 'attachment'],
  ['审核地址', 'audit_address'],
  ['审核时间', 'audit_time'],
  ['审核成员', 'audit_members'],
  ['审核结果', 'audit_result'],
  ['QSA', 'qsa'],
  ['QPA', 'qpa'],
  ['审核记录', 'audit_record'],
  ['传音量产记录', 'mass_production_record'],
];

// 老库迁移：为 suppliers 表补充缺失的字段列
(function migrateSuppliers() {
  const existing = new Set(db.prepare('PRAGMA table_info(suppliers)').all().map((c) => c.name));
  for (const [, field] of SUPPLIER_FIELDS) {
    if (!existing.has(field)) {
      db.exec(`ALTER TABLE suppliers ADD COLUMN ${field} TEXT DEFAULT ''`);
    }
  }
})();

// 老库迁移：为 audits 表补充缺失的字段列
(function migrateAudits() {
  const existing = new Set(db.prepare('PRAGMA table_info(audits)').all().map((c) => c.name));
  if (!existing.has('material_type')) {
    db.exec("ALTER TABLE audits ADD COLUMN material_type TEXT DEFAULT ''");
  }
})();

// 老库迁移：为 prestudies 表补充供应商、里程碑字段列（供应商/立项/P1/P2/P3）与归属清单 kind
(function migratePrestudies() {
  const existing = new Set(db.prepare('PRAGMA table_info(prestudies)').all().map((c) => c.name));
  for (const field of ['supplier', 'milestone_lx', 'milestone_p1', 'milestone_p2', 'milestone_p3']) {
    if (!existing.has(field)) {
      db.exec(`ALTER TABLE prestudies ADD COLUMN ${field} TEXT DEFAULT ''`);
    }
  }
  // kind：记录归属清单（'' = 预研专项；'research' = 在研项目风险清单）。
  // 升级前两清单混在一张表里，且存量记录均为「一、在研项目」的风险点，
  // 因此首次加列时把已有记录统一归到在研项目，避免它们继续出现在「二、预研专项」。
  if (!existing.has('kind')) {
    db.exec("ALTER TABLE prestudies ADD COLUMN kind TEXT DEFAULT ''");
    db.exec("UPDATE prestudies SET kind = 'research'");
  }
})();

// 老库迁移：为 qcps 表补充品类字段列
(function migrateQcps() {
  const existing = new Set(db.prepare('PRAGMA table_info(qcps)').all().map((c) => c.name));
  if (!existing.has('category')) {
    db.exec("ALTER TABLE qcps ADD COLUMN category TEXT DEFAULT ''");
  }
})();

// ================= 权限系统表（第一/二/三/四层权限） =================
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      username     TEXT NOT NULL UNIQUE,
      password     TEXT NOT NULL,
      display_name TEXT DEFAULT '',
      status       TEXT NOT NULL DEFAULT '启用',
      is_super     INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at   TEXT DEFAULT (datetime('now', 'localtime'))
  );
  CREATE TABLE IF NOT EXISTS roles (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      code        TEXT NOT NULL UNIQUE,
      name        TEXT NOT NULL,
      description TEXT DEFAULT '',
      built_in    INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS permissions (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      code  TEXT NOT NULL UNIQUE,
      name  TEXT NOT NULL,
      kind  TEXT NOT NULL,         -- menu / action
      sort  INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS role_permissions (
      role_id INTEGER NOT NULL,
      perm_code TEXT NOT NULL,
      PRIMARY KEY (role_id, perm_code)
  );
  CREATE TABLE IF NOT EXISTS user_roles (
      user_id INTEGER NOT NULL,
      role_id INTEGER NOT NULL,
      PRIMARY KEY (user_id, role_id)
  );
  CREATE TABLE IF NOT EXISTS user_category_scopes (
      user_id  INTEGER NOT NULL,
      category TEXT NOT NULL,
      PRIMARY KEY (user_id, category)
  );
  CREATE TABLE IF NOT EXISTS user_supplier_scopes (
      user_id  INTEGER NOT NULL,
      supplier TEXT NOT NULL,
      PRIMARY KEY (user_id, supplier)
  );
  CREATE TABLE IF NOT EXISTS user_purchase_group_scopes (
      user_id        INTEGER NOT NULL,
      purchase_group TEXT NOT NULL,
      PRIMARY KEY (user_id, purchase_group)
  );
  CREATE TABLE IF NOT EXISTS sys_flags (
      key   TEXT PRIMARY KEY,
      value TEXT
  );
`);

// 物料品类表（三级结构：物料大类 / 物料中类 / 物料小类）
db.exec(`
  CREATE TABLE IF NOT EXISTS material_categories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    big        TEXT NOT NULL,
    mid        TEXT DEFAULT '',
    small      TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
  );
`);

// 内置权限代码（菜单 + 操作）
const PERMISSIONS = [
  ['page:index',     '物料汇总表',   'menu',   10],
  ['page:prestudy',  '项目',         'menu',   20],
  ['page:selection', '选型',         'menu',   30],
  ['page:audits',    '稽核',         'menu',   40],
  ['page:projects',  'BOM信息',      'menu',   50],
  ['page:suppliers', '供应商信息',   'menu',   60],
  ['page:categories', '品类',        'menu',   65],
  ['page:qcps',      '关键工艺',     'menu',   70],
  ['page:admin',     '系统管理',     'menu',  200],
  ['action:create',  '新增',         'action', 100],
  ['action:edit',    '编辑',         'action', 110],
  ['action:delete',  '删除',         'action', 120],
  ['action:export',  '导出',         'action', 130],
  ['action:import',  '导入',         'action', 140],
];
const upsertPerm = db.prepare(`
  INSERT INTO permissions (code, name, kind, sort) VALUES (?, ?, ?, ?)
  ON CONFLICT(code) DO UPDATE SET name = excluded.name, kind = excluded.kind, sort = excluded.sort
`);
for (const p of PERMISSIONS) upsertPerm.run(...p);

// 管理员专属菜单：不授予任何普通业务角色（编辑 / 只读），品类与系统管理同等对待
const ADMIN_ONLY_MENUS = ['page:admin', 'page:categories'];

// 内置角色仅在首次初始化时创建；若管理员删除内置角色，重启服务不会自动重建
const seededFlag = db.prepare("SELECT value FROM sys_flags WHERE key = 'roles_seeded'").get();
if (!seededFlag) {
  const insertRole = db.prepare('INSERT OR IGNORE INTO roles (code, name, description, built_in) VALUES (?, ?, ?, 1)');
  insertRole.run('admin', '超级管理员', '拥有全部权限');
  insertRole.run('editor', '编辑用户', '可以新增/编辑/删除/导入/导出');
  insertRole.run('readonly', '只读用户', '仅可查看页面，不能新增/编辑/删除/导入/导出');

  function grantAllPerms(roleCode) {
    const role = db.prepare('SELECT id FROM roles WHERE code = ?').get(roleCode);
    if (!role) return;
    const insert = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, perm_code) VALUES (?, ?)');
    for (const [code] of PERMISSIONS) insert.run(role.id, code);
  }
  function grantReadonlyPerms(roleCode) {
    const role = db.prepare('SELECT id FROM roles WHERE code = ?').get(roleCode);
    if (!role) return;
    const insert = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, perm_code) VALUES (?, ?)');
    for (const [code, , kind] of PERMISSIONS) {
      // 只读角色只能看业务页面，不能进入系统管理与品类管理
      if (kind === 'menu' && !ADMIN_ONLY_MENUS.includes(code)) insert.run(role.id, code);
    }
  }
  function grantEditorPerms(roleCode) {
    const role = db.prepare('SELECT id FROM roles WHERE code = ?').get(roleCode);
    if (!role) return;
    const insert = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, perm_code) VALUES (?, ?)');
    for (const [code, , kind] of PERMISSIONS) {
      // 编辑用户：可见全部业务页面 + 可新增/编辑/删除/导入/导出，但不能进入系统管理与品类管理
      if (kind === 'action' || (kind === 'menu' && !ADMIN_ONLY_MENUS.includes(code))) insert.run(role.id, code);
    }
  }
  grantAllPerms('admin');
  grantEditorPerms('editor');
  grantReadonlyPerms('readonly');
  db.prepare("INSERT OR REPLACE INTO sys_flags (key, value) VALUES ('roles_seeded', '1')").run();
}

// 内置账号：admin / admin123（首次启动创建）
(function ensureDefaultAdmin() {
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (exists) return;
  const info = db.prepare(
    'INSERT INTO users (username, password, display_name, status, is_super) VALUES (?, ?, ?, ?, ?)'
  ).run('admin', 'admin123', '超级管理员', '启用', 1);
  const adminRole = db.prepare('SELECT id FROM roles WHERE code = ?').get('admin');
  if (adminRole) {
    db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)').run(info.lastInsertRowid, adminRole.id);
  }
})();

module.exports = { db, STATUSES, DOCS, DOC_LABELS, DOC_STATUSES, PROJECT_SPEC_FIELDS, SUPPLIER_FIELDS, PERMISSIONS };
