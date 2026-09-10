package com.materialcert.server.bootstrap;

import com.materialcert.server.common.Biz;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * 启动种子与权限收敛（等价 Node db.js + server.js 顶部的初始化/修正逻辑）：
 * 1) 权限清单 upsert；2) 内置角色首次创建并授权；3) admin/admin123 内置账号；
 * 4) readonly 无 page:admin；5) page:categories 随 page:admin 级别同步。
 */
@Component
public class DatabaseSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DatabaseSeeder.class);

    private final JdbcTemplate jdbc;

    public DatabaseSeeder(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public void run(ApplicationArguments args) {
        upsertPermissions();
        seedRolesOnce();
        ensureDefaultAdmin();
        ensureReadonlyNoAdmin();
        syncCategoryPermWithAdminLevel();
        log.info("数据库种子与权限收敛完成");
    }

    private void upsertPermissions() {
        for (String[] p : Biz.PERMISSIONS) {
            jdbc.update("INSERT INTO permissions (code, name, kind, sort) VALUES (?, ?, ?, ?) "
                    + "ON DUPLICATE KEY UPDATE name = VALUES(name), kind = VALUES(kind), sort = VALUES(sort)",
                    p[0], p[1], p[2], Integer.parseInt(p[3]));
        }
    }

    private boolean flag(String key) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT flag_value FROM sys_flags WHERE flag_key = ?", key);
        return !rows.isEmpty();
    }

    private void setFlag(String key, String value) {
        jdbc.update("INSERT INTO sys_flags (flag_key, flag_value) VALUES (?, ?) "
                + "ON DUPLICATE KEY UPDATE flag_value = VALUES(flag_value)", key, value);
    }

    private void seedRolesOnce() {
        if (flag("roles_seeded")) {
            return;
        }
        insertRoleIgnore("admin", "超级管理员", "拥有全部权限");
        insertRoleIgnore("editor", "编辑用户", "可以新增/编辑/删除/导入/导出");
        insertRoleIgnore("readonly", "只读用户", "仅可查看页面，不能新增/编辑/删除/导入/导出");

        grantAllPerms("admin");
        grantEditorPerms("editor");
        grantReadonlyPerms("readonly");
        setFlag("roles_seeded", "1");
    }

    private void insertRoleIgnore(String code, String name, String description) {
        jdbc.update("INSERT IGNORE INTO roles (code, name, description, built_in) VALUES (?, ?, ?, 1)",
                code, name, description);
    }

    private Long roleId(String code) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT id FROM roles WHERE code = ?", code);
        return rows.isEmpty() ? null : ((Number) rows.get(0).get("id")).longValue();
    }

    private void grantAllPerms(String roleCode) {
        Long roleId = roleId(roleCode);
        if (roleId == null) {
            return;
        }
        for (String[] p : Biz.PERMISSIONS) {
            jdbc.update("INSERT IGNORE INTO role_permissions (role_id, perm_code) VALUES (?, ?)", roleId, p[0]);
        }
    }

    /** 只读角色：仅页面菜单（不含管理菜单与任何 action）。 */
    private void grantReadonlyPerms(String roleCode) {
        Long roleId = roleId(roleCode);
        if (roleId == null) {
            return;
        }
        for (String[] p : Biz.PERMISSIONS) {
            boolean menu = "menu".equals(p[2]);
            if (!menu || Biz.ADMIN_ONLY_MENUS.contains(p[0])) {
                continue;
            }
            jdbc.update("INSERT IGNORE INTO role_permissions (role_id, perm_code) VALUES (?, ?)", roleId, p[0]);
        }
    }

    private void grantEditorPerms(String roleCode) {
        Long roleId = roleId(roleCode);
        if (roleId == null) {
            return;
        }
        for (String[] p : Biz.PERMISSIONS) {
            boolean menu = "menu".equals(p[2]);
            if (menu && Biz.ADMIN_ONLY_MENUS.contains(p[0])) {
                continue;
            }
            jdbc.update("INSERT IGNORE INTO role_permissions (role_id, perm_code) VALUES (?, ?)", roleId, p[0]);
        }
    }

    private void ensureDefaultAdmin() {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT id FROM users WHERE username = 'admin'");
        if (!rows.isEmpty()) {
            return;
        }
        jdbc.update("INSERT INTO users (username, password, display_name, status, is_super) "
                + "VALUES ('admin', 'admin123', '超级管理员', '启用', 1)");
        List<Map<String, Object>> after = jdbc.queryForList("SELECT id FROM users WHERE username = 'admin'");
        long uid = ((Number) after.get(0).get("id")).longValue();
        Long adminRole = roleId("admin");
        if (adminRole != null) {
            jdbc.update("INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)", uid, adminRole);
        }
    }

    /** 修正：只读角色不应持有 page:admin。 */
    private void ensureReadonlyNoAdmin() {
        Long roleId = roleId("readonly");
        if (roleId != null) {
            jdbc.update("DELETE FROM role_permissions WHERE role_id = ? AND perm_code = 'page:admin'", roleId);
        }
    }

    /** 品类页为管理员专属菜单：无 page:admin 的角色收回 page:categories；有则补齐。 */
    private void syncCategoryPermWithAdminLevel() {
        jdbc.update("DELETE rp FROM role_permissions rp "
                + "WHERE rp.perm_code = 'page:categories' AND NOT EXISTS ("
                + "  SELECT 1 FROM role_permissions a WHERE a.role_id = rp.role_id AND a.perm_code = 'page:admin')");
        jdbc.update("INSERT IGNORE INTO role_permissions (role_id, perm_code) "
                + "SELECT DISTINCT rp.role_id, 'page:categories' FROM role_permissions rp "
                + "WHERE rp.perm_code = 'page:admin'");
    }
}
