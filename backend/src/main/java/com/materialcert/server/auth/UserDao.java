package com.materialcert.server.auth;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 用户权限装载（等价 Node loadUserPerms）：用户基本信息 + 角色 + 权限码 + 数据范围。
 * 每次请求实时加载，保证角色/权限/范围变更即时生效。
 */
@Repository
public class UserDao {

    private final JdbcTemplate jdbc;

    public UserDao(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Map<String, Object> loadUser(long userId) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT id, username, display_name, status, is_super FROM users WHERE id = ?", userId);
        if (rows.isEmpty()) {
            return null;
        }
        Map<String, Object> base = new LinkedHashMap<>(rows.get(0));

        List<Map<String, Object>> roles = jdbc.queryForList(
                "SELECT r.id, r.code, r.name FROM roles r "
                        + "INNER JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ? "
                        + "ORDER BY r.id", userId);
        long isSuper = base.get("is_super") instanceof Number n ? n.longValue() : 0L;
        List<String> permissions = new ArrayList<>();
        if (isSuper == 1) {
            List<Map<String, Object>> permRows = jdbc.queryForList("SELECT code FROM permissions");
            for (Map<String, Object> p : permRows) {
                permissions.add(String.valueOf(p.get("code")));
            }
        } else if (!roles.isEmpty()) {
            List<Long> roleIds = new ArrayList<>();
            for (Map<String, Object> r : roles) {
                roleIds.add(((Number) r.get("id")).longValue());
            }
            StringBuilder sql = new StringBuilder(
                    "SELECT DISTINCT perm_code AS code FROM role_permissions WHERE role_id IN (");
            sql.append(String.join(",", java.util.Collections.nCopies(roleIds.size(), "?")));
            sql.append(")");
            List<Map<String, Object>> permRows = jdbc.queryForList(sql.toString(), roleIds.toArray());
            for (Map<String, Object> p : permRows) {
                permissions.add(String.valueOf(p.get("code")));
            }
        }

        List<String> categories = listStrings(
                "SELECT category FROM user_category_scopes WHERE user_id = ?", userId);
        List<String> suppliers = listStrings(
                "SELECT supplier FROM user_supplier_scopes WHERE user_id = ?", userId);

        Map<String, Object> scopes = new LinkedHashMap<>();
        scopes.put("categories", categories);
        scopes.put("suppliers", suppliers);

        Map<String, Object> user = new LinkedHashMap<>(base);
        user.put("roles", roles);
        user.put("permissions", permissions);
        user.put("scopes", scopes);
        user.put("isSuper", isSuper == 1);
        return user;
    }

    private List<String> listStrings(String sql, Object... args) {
        List<String> out = new ArrayList<>();
        for (Map<String, Object> row : jdbc.queryForList(sql, args)) {
            out.add(String.valueOf(row.values().iterator().next()));
        }
        return out;
    }
}
