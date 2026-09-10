-- =====================================================================
-- 物料开发认证管理系统  MySQL Schema（Spring Boot 后端）
-- 全部使用 CREATE TABLE IF NOT EXISTS，可安全重复执行。
-- 说明：Node 版(sqlite)字段统一 snake_case + TEXT，MySQL 版保持列名一致；
--       短字段用 VARCHAR，长文本用 TEXT；应用层写入时统一以 '' 兜底，
--       避免 NULL（读侧均兼容空串语义）。
-- =====================================================================

CREATE TABLE IF NOT EXISTS materials (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  code              VARCHAR(191) UNIQUE,
  name              VARCHAR(255) NOT NULL,
  model             VARCHAR(255) NOT NULL DEFAULT '',
  category          VARCHAR(255) NOT NULL DEFAULT '',
  supplier          VARCHAR(255) NOT NULL DEFAULT '',
  manufacturer      VARCHAR(255) NOT NULL DEFAULT '',
  unit              VARCHAR(64)  NOT NULL DEFAULT '',
  status            VARCHAR(32)  NOT NULL DEFAULT '黄区',
  cert_expire_date  VARCHAR(10)  NOT NULL DEFAULT '',
  rohs              VARCHAR(16)  NOT NULL DEFAULT '待补',
  reach             VARCHAR(16)  NOT NULL DEFAULT '待补',
  msds              VARCHAR(16)  NOT NULL DEFAULT '待补',
  datasheet         VARCHAR(16)  NOT NULL DEFAULT '待补',
  applied_by        VARCHAR(255) NOT NULL DEFAULT '',
  applied_at        VARCHAR(32)  NOT NULL DEFAULT '',
  remark            TEXT,
  created_at        DATETIME,
  updated_at        DATETIME,
  KEY idx_materials_status (status),
  KEY idx_materials_category (category),
  KEY idx_materials_supplier (supplier)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS projects (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  supplier     VARCHAR(255) NOT NULL DEFAULT '',
  category     VARCHAR(255) NOT NULL DEFAULT '',
  project_name VARCHAR(255) NOT NULL,
  flow         VARCHAR(1000) NOT NULL DEFAULT '',
  source       VARCHAR(32)  NOT NULL DEFAULT '手动',
  baseline     VARCHAR(255) NOT NULL DEFAULT '',
  mass_production_sample_date VARCHAR(255) NOT NULL DEFAULT '',
  project_size VARCHAR(255) NOT NULL DEFAULT '',
  mod_factory  VARCHAR(255) NOT NULL DEFAULT '',
  mod_part_no  VARCHAR(255) NOT NULL DEFAULT '',
  panel        VARCHAR(255) NOT NULL DEFAULT '',
  ic           VARCHAR(255) NOT NULL DEFAULT '',
  cg_factory   VARCHAR(255) NOT NULL DEFAULT '',
  cg_material  VARCHAR(255) NOT NULL DEFAULT '',
  fpc          VARCHAR(255) NOT NULL DEFAULT '',
  oca          VARCHAR(255) NOT NULL DEFAULT '',
  pol          VARCHAR(255) NOT NULL DEFAULT '',
  cog_acf      VARCHAR(255) NOT NULL DEFAULT '',
  fog_acf      VARCHAR(255) NOT NULL DEFAULT '',
  component_sealant VARCHAR(255) NOT NULL DEFAULT '',
  one_line_glue     VARCHAR(255) NOT NULL DEFAULT '',
  face_glue         VARCHAR(255) NOT NULL DEFAULT '',
  silver_paste      VARCHAR(255) NOT NULL DEFAULT '',
  silicone_glue     VARCHAR(255) NOT NULL DEFAULT '',
  blind_hole_glue_1 VARCHAR(255) NOT NULL DEFAULT '',
  blind_hole_glue_2 VARCHAR(255) NOT NULL DEFAULT '',
  backlight_factory VARCHAR(255) NOT NULL DEFAULT '',
  shading_tape      VARCHAR(255) NOT NULL DEFAULT '',
  upper_lower_brightness VARCHAR(255) NOT NULL DEFAULT '',
  diffuser      VARCHAR(255) NOT NULL DEFAULT '',
  led_glue      VARCHAR(255) NOT NULL DEFAULT '',
  reflector     VARCHAR(255) NOT NULL DEFAULT '',
  led           VARCHAR(255) NOT NULL DEFAULT '',
  lgp           VARCHAR(255) NOT NULL DEFAULT '',
  glue_frame    VARCHAR(255) NOT NULL DEFAULT '',
  iron_frame    VARCHAR(255) NOT NULL DEFAULT '',
  created_at    DATETIME,
  updated_at    DATETIME,
  KEY idx_projects_category (category),
  KEY idx_projects_supplier (supplier)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS suppliers (
  id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
  name                  VARCHAR(255) NOT NULL,
  contact               VARCHAR(255) NOT NULL DEFAULT '',
  phone                 VARCHAR(255) NOT NULL DEFAULT '',
  email                 VARCHAR(255) NOT NULL DEFAULT '',
  address               VARCHAR(255) NOT NULL DEFAULT '',
  category              VARCHAR(255) NOT NULL DEFAULT '',
  rating                VARCHAR(8)   NOT NULL DEFAULT 'C',
  status                VARCHAR(32)  NOT NULL DEFAULT '合作中',
  remark                VARCHAR(1000) NOT NULL DEFAULT '',
  material_type         VARCHAR(255) NOT NULL DEFAULT '',
  company_profile       TEXT,
  product_type          VARCHAR(1000) NOT NULL DEFAULT '',
  capacity_phone        VARCHAR(255) NOT NULL DEFAULT '',
  module_customers      VARCHAR(1000) NOT NULL DEFAULT '',
  terminal_customers    VARCHAR(1000) NOT NULL DEFAULT '',
  system_capability     VARCHAR(1000) NOT NULL DEFAULT '',
  automation_capability VARCHAR(1000) NOT NULL DEFAULT '',
  inspection_capability VARCHAR(1000) NOT NULL DEFAULT '',
  traceability_capability VARCHAR(1000) NOT NULL DEFAULT '',
  testing_capability    VARCHAR(1000) NOT NULL DEFAULT '',
  rework                VARCHAR(1000) NOT NULL DEFAULT '',
  strengths             TEXT,
  weaknesses            TEXT,
  attachment            VARCHAR(1000) NOT NULL DEFAULT '',
  audit_address         VARCHAR(500) NOT NULL DEFAULT '',
  audit_time            VARCHAR(255) NOT NULL DEFAULT '',
  audit_members         VARCHAR(500) NOT NULL DEFAULT '',
  audit_result          VARCHAR(255) NOT NULL DEFAULT '',
  qsa                   VARCHAR(255) NOT NULL DEFAULT '',
  qpa                   VARCHAR(255) NOT NULL DEFAULT '',
  audit_record          TEXT,
  mass_production_record TEXT,
  created_at            DATETIME,
  updated_at            DATETIME,
  KEY idx_suppliers_material_type (material_type),
  KEY idx_suppliers_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS audits (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  supplier      VARCHAR(255) NOT NULL,
  audit_date    VARCHAR(32)  NOT NULL DEFAULT '',
  auditor       VARCHAR(255) NOT NULL DEFAULT '',
  material_type VARCHAR(255) NOT NULL DEFAULT '',
  scope         TEXT,
  result        VARCHAR(32)  NOT NULL DEFAULT '合格',
  score         VARCHAR(255) NOT NULL DEFAULT '',
  summary       TEXT,
  action        TEXT,
  created_at    DATETIME,
  updated_at    DATETIME,
  KEY idx_audits_material_type (material_type),
  KEY idx_audits_supplier (supplier),
  KEY idx_audits_result (result)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS prestudies (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  category     VARCHAR(255) NOT NULL DEFAULT '',
  topic        VARCHAR(255) NOT NULL,
  risk         TEXT,
  progress     VARCHAR(1000) NOT NULL DEFAULT '',
  milestone_lx VARCHAR(255) NOT NULL DEFAULT '',
  milestone_p1 VARCHAR(255) NOT NULL DEFAULT '',
  milestone_p2 VARCHAR(255) NOT NULL DEFAULT '',
  milestone_p3 VARCHAR(255) NOT NULL DEFAULT '',
  status       VARCHAR(32)  NOT NULL DEFAULT '',
  owner        VARCHAR(255) NOT NULL DEFAULT '',
  source       VARCHAR(32)  NOT NULL DEFAULT '手动',
  created_at   DATETIME,
  updated_at   DATETIME,
  KEY idx_prestudies_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS categories (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(255) NOT NULL UNIQUE,
  created_at DATETIME
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS qcps (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  category     VARCHAR(255) NOT NULL DEFAULT '',
  name         VARCHAR(255) NOT NULL DEFAULT '',
  supplier     VARCHAR(255) NOT NULL DEFAULT '',
  process      VARCHAR(255) NOT NULL DEFAULT '',
  control_item VARCHAR(1000) NOT NULL DEFAULT '',
  spec         VARCHAR(1000) NOT NULL DEFAULT '',
  method       VARCHAR(1000) NOT NULL DEFAULT '',
  freq         VARCHAR(255) NOT NULL DEFAULT '',
  device       VARCHAR(255) NOT NULL DEFAULT '',
  responsible  VARCHAR(255) NOT NULL DEFAULT '',
  status       VARCHAR(32)  NOT NULL DEFAULT '生效',
  remark       VARCHAR(1000) NOT NULL DEFAULT '',
  created_at   DATETIME,
  updated_at   DATETIME,
  KEY idx_qcps_category (category),
  KEY idx_qcps_supplier (supplier)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ==================== 权限系统 ====================

CREATE TABLE IF NOT EXISTS users (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  username     VARCHAR(100) NOT NULL UNIQUE,
  password     VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NOT NULL DEFAULT '',
  status       VARCHAR(32)  NOT NULL DEFAULT '启用',
  is_super     TINYINT      NOT NULL DEFAULT 0,
  created_at   DATETIME,
  updated_at   DATETIME
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS roles (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  code        VARCHAR(100) NOT NULL UNIQUE,
  name        VARCHAR(255) NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  built_in    TINYINT      NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS permissions (
  id   BIGINT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  kind VARCHAR(32)  NOT NULL,
  sort INT          NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id   BIGINT NOT NULL,
  perm_code VARCHAR(100) NOT NULL,
  PRIMARY KEY (role_id, perm_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_roles (
  user_id BIGINT NOT NULL,
  role_id BIGINT NOT NULL,
  PRIMARY KEY (user_id, role_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_category_scopes (
  user_id  BIGINT NOT NULL,
  category VARCHAR(255) NOT NULL,
  PRIMARY KEY (user_id, category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_supplier_scopes (
  user_id  BIGINT NOT NULL,
  supplier VARCHAR(255) NOT NULL,
  PRIMARY KEY (user_id, supplier)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_purchase_group_scopes (
  user_id        BIGINT NOT NULL,
  purchase_group VARCHAR(255) NOT NULL,
  PRIMARY KEY (user_id, purchase_group)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sys_flags (
  flag_key VARCHAR(100) NOT NULL PRIMARY KEY,
  flag_value VARCHAR(500)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS material_categories (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  big        VARCHAR(255) NOT NULL,
  mid        VARCHAR(255) NOT NULL DEFAULT '',
  small      VARCHAR(255) NOT NULL DEFAULT '',
  created_at DATETIME,
  updated_at DATETIME,
  KEY idx_mc_big (big),
  KEY idx_mc_mid (mid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
