package com.materialcert.server.web;

import com.materialcert.server.auth.AuthContext;
import com.materialcert.server.auth.UserDao;
import com.materialcert.server.common.ApiException;
import com.materialcert.server.common.Sql;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 认证与会话：POST /api/login、POST /api/logout、GET /api/me、GET /api/permissions。
 * 会话 cookie 沿用 Node 版名称 sid（前端透明携带，无需改动）。
 */
@RestController
@RequestMapping("/api")
public class AuthController {

    public static final String SESSION_UID = "uid";

    private final JdbcTemplate jdbc;
    private final UserDao userDao;

    public AuthController(JdbcTemplate jdbc, UserDao userDao) {
        this.jdbc = jdbc;
        this.userDao = userDao;
    }

    @PostMapping("/login")
    public Map<String, Object> login(@RequestBody(required = false) Map<String, Object> body,
                                     HttpServletRequest request) {
        String username = body == null ? "" : Sql.s(body.get("username"));
        String password = body == null ? "" : Sql.s(body.get("password"));
        if (username.isEmpty() || password.isEmpty()) {
            throw ApiException.badRequest("请输入账号与密码");
        }
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT * FROM users WHERE username = ?", username);
        if (rows.isEmpty()) {
            throw ApiException.unauthorized("账号或密码错误");
        }
        Map<String, Object> row = rows.get(0);
        if (!password.equals(String.valueOf(row.get("password")))
                || !"启用".equals(row.get("status"))) {
            throw ApiException.unauthorized("账号或密码错误");
        }
        long userId = ((Number) row.get("id")).longValue();
        Map<String, Object> user = userDao.loadUser(userId);
        HttpSession session = request.getSession(true);
        session.setAttribute(SESSION_UID, userId);
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("ok", true);
        resp.put("user", user);
        return resp;
    }

    @PostMapping("/logout")
    public Map<String, Object> logout(HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        if (session != null) {
            session.invalidate();
        }
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("ok", true);
        return resp;
    }

    @GetMapping("/me")
    public Map<String, Object> me() {
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("user", AuthContext.user());
        return resp;
    }

    /** 内置权限码列表（供登录后/系统管理页加载）。 */
    @GetMapping("/permissions")
    public Map<String, Object> permissions() {
        List<Map<String, Object>> items = jdbc.queryForList(
                "SELECT code, name, kind FROM permissions ORDER BY kind DESC, sort, code");
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("items", items);
        return resp;
    }
}
