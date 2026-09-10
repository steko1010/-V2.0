package com.materialcert.server.biz;

import com.materialcert.server.auth.AuthContext;
import com.materialcert.server.auth.RequirePerm;
import com.materialcert.server.auth.UserDao;
import com.materialcert.server.common.ApiException;
import com.materialcert.server.common.Biz;
import com.materialcert.server.common.Sql;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 系统管理（管理员专属）：用户/角色的账号、专属角色、数据范围与权限配置。
 * 等价 Node /api/users 与 /api/roles。
 */
@RestController
@RequestMapping("/api")
public class AdminController {

    private final JdbcTemplate jdbc;
    private final UserDao userDao;

    public AdminController(JdbcTemplate jdbc, UserDao userDao) {
        this.jdbc = jdbc;
        this.userDao = userDao;
    }

    // ==================== 用户 ====================

    @GetMapping("/users")
    @RequirePerm("page:admin")
    public Map<String, Object> users() {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT u.id, u.username, u.display_name, u.status, u.is_super, DATE_FORMAT(u.created_at, '%Y-%m-%d %H:%i:%s') AS created_at, "
                        + "GROUP_CONCAT(r.name) AS roles "
                        + "FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id "
                        + "LEFT JOIN roles r ON r.id = ur.role_id "
                        + "GROUP BY u.id, u.username, u.display_name, u.status, u.is_super, u.created_at "
                        + "ORDER BY u.id");
        for (Map<String, Object> u : rows) {
            long uid = ((Number) u.get("id")).longValue();
            Map<String, Object> scopes = new LinkedHashMap<>();
            scopes.put("categories", stringList("SELECT category FROM user_category_scopes WHERE user_id = ?", uid));
            scopes.put("suppliers", stringList("SELECT supplier FROM user_supplier_scopes WHERE user_id = ?", uid));
            u.put("scopes", scopes);
        }
        return Map.of("items", rows);
    }

    @PostMapping("/users")
    @RequirePerm("page:admin")
    @Transactional
    public Map<String, Object> createUser(@RequestBody(required = false) Map<String, Object> body) {
        Map<String, Object> b = body == null ? Map.of() : body;
        String username = Sql.s(b.get("username"));
        String password = b.get("password") == null ? "" : Sql.s(b.get("password"));
        if (username.isEmpty() || password.isEmpty()) {
            throw ApiException.badRequest("账号与密码必填");
        }
        String displayName = Sql.or(b.get("display_name"), "");
        String status = Sql.or(b.get("status"), "启用");
        long isSuper = truthy(b.get("is_super"));
        jdbc.update("INSERT INTO users (username, password, display_name, status, is_super) VALUES (?, ?, ?, ?, ?)",
                username, password, displayName, status, isSuper);
        long uid = lastId();

        long ownRoleId = ensureUserRole(username, displayName);
        List<Object> roleIds = new ArrayList<>(intList(b.get("role_ids")));
        roleIds.add(ownRoleId);
        insertUserRoles(uid, roleIds);
        insertUserScopes(uid, bodyMap(b, "scopes"));
        return userDao.loadUser(uid);
    }

    @PutMapping("/users/{id}")
    @RequirePerm("page:admin")
    @Transactional
    public Map<String, Object> updateUser(@PathVariable long id,
                                          @RequestBody(required = false) Map<String, Object> body) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT id, username, display_name FROM users WHERE id = ?", id);
        if (rows.isEmpty()) {
            throw ApiException.notFound("用户不存在");
        }
        Map<String, Object> exist = rows.get(0);
        Map<String, Object> b = body == null ? Map.of() : body;

        String username = Sql.s(b.get("username"));
        String newUsername = null;
        if (b.containsKey("username")) {
            if (username.isEmpty()) {
                throw ApiException.badRequest("账号不能为空");
            }
            if (!username.equals(exist.get("username"))) {
                List<Map<String, Object>> dup = jdbc.queryForList(
                        "SELECT id FROM users WHERE username = ? AND id != ?", username, id);
                if (!dup.isEmpty()) {
                    throw ApiException.badRequest("账号已存在");
                }
                newUsername = username;
                jdbc.update("UPDATE users SET username = ? WHERE id = ?", username, id);
            }
        }

        String displayName = b.containsKey("display_name") ? Sql.s(b.get("display_name")) : Sql.s(exist.get("display_name"));

        boolean roleSyncNeeded = false;
        if (b.containsKey("display_name") && !displayName.equals(exist.get("display_name"))) {
            roleSyncNeeded = true;
        }
        if (newUsername != null) {
            roleSyncNeeded = true;
            // 同名专属角色编码冲突预检
            List<Map<String, Object>> roleDup = jdbc.queryForList(
                    "SELECT id FROM roles WHERE code = ? AND id != "
                            + "(SELECT COALESCE((SELECT r.id FROM roles r INNER JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ?), 0))",
                    username, id);
            if (!roleDup.isEmpty()) {
                throw ApiException.badRequest("角色编码「" + username + "」已被其他角色占用");
            }
        }

        List<String> fields = new ArrayList<>();
        List<Object> vals = new ArrayList<>();
        if (b.containsKey("password") && !Sql.s(b.get("password")).isEmpty()) {
            fields.add("password = ?");
            vals.add(Sql.s(b.get("password")));
        }
        if (b.containsKey("status")) {
            fields.add("status = ?");
            vals.add(Sql.or(b.get("status"), "启用"));
        }
        if (b.containsKey("display_name")) {
            fields.add("display_name = ?");
            vals.add(displayName);
        }
        if (b.containsKey("is_super")) {
            fields.add("is_super = ?");
            vals.add(truthy(b.get("is_super")));
        }
        if (!fields.isEmpty()) {
            vals.add(id);
            jdbc.update("UPDATE users SET " + String.join(",", fields) + " WHERE id = ?", vals.toArray());
        }

        if (roleSyncNeeded) {
            List<Map<String, Object>> own = jdbc.queryForList(
                    "SELECT r.id FROM roles r INNER JOIN user_roles ur ON ur.role_id = r.id "
                            + "WHERE ur.user_id = ? AND r.code = ?", id, exist.get("username"));
            if (!own.isEmpty()) {
                long ownRoleId = ((Number) own.get(0).get("id")).longValue();
                String newCode = newUsername != null ? newUsername : Sql.s(exist.get("username"));
                String newName = displayName.isEmpty() ? newCode : displayName;
                jdbc.update("UPDATE roles SET code = ?, name = ? WHERE id = ?", newCode, newName, ownRoleId);
            }
        }

        if (b.get("role_ids") instanceof List<?> roleList) {
            jdbc.update("DELETE FROM user_roles WHERE user_id = ?", id);
            insertUserRoles(id, new ArrayList<>(intList(b.get("role_ids"))));
        }
        if (b.get("scopes") instanceof Map<?, ?> scopesMap) {
            replaceUserScopes(id, scopesMap);
        }
        return userDao.loadUser(id);
    }

    @DeleteMapping("/users/{id}")
    @RequirePerm("page:admin")
    @Transactional
    public Map<String, Object> deleteUser(@PathVariable long id) {
        if (id == AuthContext.userId()) {
            throw ApiException.badRequest("不能删除当前登录账号");
        }
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT id, username FROM users WHERE id = ?", id);
        if (rows.isEmpty()) {
            throw ApiException.notFound("用户不存在");
        }
        String username = Sql.s(rows.get(0).get("username"));
        jdbc.update("DELETE FROM user_roles WHERE user_id = ?", id);
        jdbc.update("DELETE FROM user_category_scopes WHERE user_id = ?", id);
        jdbc.update("DELETE FROM user_supplier_scopes WHERE user_id = ?", id);
        jdbc.update("DELETE FROM users WHERE id = ?", id);
        // 清理同名专属角色（未被其他用户使用时）
        List<Map<String, Object>> ownRole = jdbc.queryForList("SELECT id FROM roles WHERE code = ?", username);
        if (!ownRole.isEmpty()) {
            long rid = ((Number) ownRole.get(0).get("id")).longValue();
            Long used = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM user_roles WHERE role_id = ? AND user_id != ?", Long.class, rid, id);
            if (used == null || used == 0) {
                jdbc.update("DELETE FROM role_permissions WHERE role_id = ?", rid);
                jdbc.update("DELETE FROM user_roles WHERE role_id = ?", rid);
                jdbc.update("DELETE FROM roles WHERE id = ?", rid);
            }
        }
        return Map.of("ok", true);
    }

    // ==================== 角色 ====================

    @GetMapping("/roles")
    @RequirePerm("page:admin")
    public Map<String, Object> roles() {
        List<Map<String, Object>> roles = jdbc.queryForList(
                "SELECT id, code, name, description, built_in FROM roles ORDER BY id");
        for (Map<String, Object> r : roles) {
            long rid = ((Number) r.get("id")).longValue();
            r.put("permissions", stringList("SELECT perm_code FROM role_permissions WHERE role_id = ?", rid));
        }
        return Map.of("items", roles);
    }

    @PostMapping("/roles")
    @RequirePerm("page:admin")
    @Transactional
    public Map<String, Object> createRole(@RequestBody(required = false) Map<String, Object> body) {
        Map<String, Object> b = body == null ? Map.of() : body;
        String code = Sql.s(b.get("code"));
        String name = Sql.s(b.get("name"));
        if (code.isEmpty() || name.isEmpty()) {
            throw ApiException.badRequest("账号与姓名必填");
        }
        List<String> permissionCodes = filteredPermCodes(b.get("permission_codes"));
        jdbc.update("INSERT INTO roles (code, name, description) VALUES (?, ?, ?)",
                code, name, Sql.or(b.get("description"), ""));
        long rid = lastId();
        grantPerms(rid, permissionCodes);
        return Map.of("ok", true, "id", rid, "code", code, "name", name,
                "description", Sql.or(b.get("description"), ""), "built_in", 0);
    }

    @PutMapping("/roles/{id}")
    @RequirePerm("page:admin")
    @Transactional
    public Map<String, Object> updateRole(@PathVariable long id,
                                          @RequestBody(required = false) Map<String, Object> body) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT built_in FROM roles WHERE id = ?", id);
        if (rows.isEmpty()) {
            throw ApiException.notFound("角色不存在");
        }
        Map<String, Object> b = body == null ? Map.of() : body;
        List<String> fields = new ArrayList<>();
        List<Object> vals = new ArrayList<>();
        if (b.containsKey("name")) {
            fields.add("name = ?");
            vals.add(Sql.s(b.get("name")));
        }
        if (b.containsKey("description")) {
            fields.add("description = ?");
            vals.add(Sql.s(b.get("description")));
        }
        if (!fields.isEmpty()) {
            vals.add(id);
            jdbc.update("UPDATE roles SET " + String.join(",", fields) + " WHERE id = ?", vals.toArray());
        }
        if (b.get("permission_codes") instanceof List<?>) {
            List<String> filtered = filteredPermCodes(b.get("permission_codes"));
            jdbc.update("DELETE FROM role_permissions WHERE role_id = ?", id);
            grantPerms(id, filtered);
        }
        return Map.of("ok", true);
    }

    @DeleteMapping("/roles/{id}")
    @RequirePerm("page:admin")
    @Transactional
    public Map<String, Object> deleteRole(@PathVariable long id) {
        int n = jdbc.update("DELETE FROM roles WHERE id = ?", id);
        if (n == 0) {
            throw ApiException.notFound("角色不存在");
        }
        jdbc.update("DELETE FROM role_permissions WHERE role_id = ?", id);
        jdbc.update("DELETE FROM user_roles WHERE role_id = ?", id);
        return Map.of("ok", true);
    }

    @GetMapping("/roles/{id}/permissions")
    @RequirePerm("page:admin")
    public Map<String, Object> rolePermissions(@PathVariable long id) {
        return Map.of("items", stringList("SELECT perm_code FROM role_permissions WHERE role_id = ?", id));
    }

    // ==================== 内部方法 ====================

    /** 品类为管理员专属：未同时授予 page:admin 的角色不得持有 page:categories。 */
    private List<String> filteredPermCodes(Object raw) {
        List<Object> list = intList(raw);
        List<String> codes = new ArrayList<>();
        for (Object o : list) {
            codes.add(String.valueOf(o));
        }
        codes.removeIf(c -> c.equals("page:categories") && !codes.contains("page:admin"));
        return codes;
    }

    private long ensureUserRole(String username, String displayName) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT id FROM roles WHERE code = ?", username);
        if (!rows.isEmpty()) {
            return ((Number) rows.get(0).get("id")).longValue();
        }
        String roleName = displayName == null || displayName.isEmpty() ? username : displayName;
        jdbc.update("INSERT INTO roles (code, name, description, built_in) VALUES (?, ?, ?, 0)",
                username, roleName, "用户专属角色");
        long roleId = lastId();
        for (String perm : Biz.USER_ROLE_DEFAULT_PERMS) {
            jdbc.update("INSERT IGNORE INTO role_permissions (role_id, perm_code) VALUES (?, ?)", roleId, perm);
        }
        return roleId;
    }

    private void insertUserRoles(long uid, List<Object> roleIds) {
        for (Object rid : roleIds) {
            if (rid instanceof Number n) {
                jdbc.update("INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)", uid, n.longValue());
            } else {
                long v = Sql.longVal(rid, 0);
                if (v > 0) {
                    jdbc.update("INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)", uid, v);
                }
            }
        }
    }

    private void insertUserScopes(long uid, Map<?, ?> scopes) {
        for (Object c : list(scopes.get("categories"))) {
            jdbc.update("INSERT IGNORE INTO user_category_scopes (user_id, category) VALUES (?, ?)", uid, Sql.s(c));
        }
        for (Object s : list(scopes.get("suppliers"))) {
            jdbc.update("INSERT IGNORE INTO user_supplier_scopes (user_id, supplier) VALUES (?, ?)", uid, Sql.s(s));
        }
    }

    private void replaceUserScopes(long uid, Map<?, ?> scopes) {
        if (!(scopes.get("categories") instanceof List<?>) && !(scopes.get("suppliers") instanceof List<?>)) {
            return;
        }
        jdbc.update("DELETE FROM user_category_scopes WHERE user_id = ?", uid);
        jdbc.update("DELETE FROM user_supplier_scopes WHERE user_id = ?", uid);
        insertUserScopes(uid, scopes);
    }

    private void grantPerms(long roleId, List<String> codes) {
        for (String c : codes) {
            jdbc.update("INSERT IGNORE INTO role_permissions (role_id, perm_code) VALUES (?, ?)", roleId, c);
        }
    }

    private List<String> stringList(String sql, long uid) {
        List<String> out = new ArrayList<>();
        for (Map<String, Object> r : jdbc.queryForList(sql, uid)) {
            Object v = r.values().iterator().next();
            out.add(String.valueOf(v));
        }
        return out;
    }

    private List<Object> intList(Object raw) {
        List<Object> out = new ArrayList<>();
        if (raw instanceof List<?> list) {
            out.addAll(list);
        }
        return out;
    }

    private List<?> list(Object raw) {
        return raw instanceof List<?> list ? list : List.of();
    }

    @SuppressWarnings("unchecked")
    private Map<?, ?> bodyMap(Map<String, Object> b, String key) {
        return b.get(key) instanceof Map<?, ?> m ? m : Map.of();
    }

    private long truthy(Object v) {
        if (v == null) {
            return 0;
        }
        if (v instanceof Boolean bool) {
            return bool ? 1 : 0;
        }
        String s = String.valueOf(v).trim();
        return s.equals("1") || s.equalsIgnoreCase("true") ? 1 : 0;
    }

    private long lastId() {
        Long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        return id == null ? 0 : id;
    }
}
