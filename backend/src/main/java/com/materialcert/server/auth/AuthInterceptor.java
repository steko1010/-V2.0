package com.materialcert.server.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * /api 会话鉴权 + 权限守卫（等价 Node 的 requireAuth + requirePermission + requireCategoryAction）。
 * 登录/注销接口放行；其余需登录，401 {message} 供前端跳转登录页。
 */
public class AuthInterceptor implements HandlerInterceptor {

    private static final String SESSION_UID = "uid";
    private final UserDao userDao;
    private final com.fasterxml.jackson.databind.ObjectMapper objectMapper;

    public AuthInterceptor(UserDao userDao, com.fasterxml.jackson.databind.ObjectMapper objectMapper) {
        this.userDao = userDao;
        this.objectMapper = objectMapper;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
            throws Exception {
        if (!(handler instanceof HandlerMethod handlerMethod)) {
            return true;
        }
        String uri = request.getRequestURI();
        // 放行登录 / 注销
        if (uri.equals("/api/login") || uri.equals("/api/logout")) {
            return true;
        }

        HttpSession session = request.getSession(false);
        Object uid = session == null ? null : session.getAttribute(SESSION_UID);
        Map<String, Object> user = null;
        if (uid != null) {
            user = userDao.loadUser(uid instanceof Number n ? n.longValue() : Long.parseLong(String.valueOf(uid)));
        }
        if (user == null || !"启用".equals(user.get("status"))) {
            if (session != null) {
                session.invalidate();
            }
            return reject(response, 401, "未登录或登录已过期");
        }

        AuthContext.set(user);

        RequirePerm requirePerm = handlerMethod.getMethodAnnotation(RequirePerm.class);
        if (requirePerm != null) {
            boolean superUser = Boolean.TRUE.equals(user.get("isSuper"));
            boolean ok = superUser;
            if (!ok) {
                @SuppressWarnings("unchecked")
                List<String> perms = (List<String>) user.getOrDefault("permissions", List.of());
                if (requirePerm.categoryAction()) {
                    // 品类为管理员专属模块：需 page:categories + 任一 action 码
                    ok = perms.contains("page:categories") && hasAny(perms, requirePerm.value());
                } else {
                    ok = hasAny(perms, requirePerm.value());
                }
            }
            if (!ok) {
                AuthContext.clear();
                return reject(response, 403, "没有该操作权限");
            }
        }
        return true;
    }

    private boolean hasAny(List<String> perms, String[] codes) {
        for (String c : codes) {
            if (perms.contains(c)) {
                return true;
            }
        }
        return codes.length == 0;
    }

    private boolean reject(HttpServletResponse response, int status, String message) throws Exception {
        response.setStatus(status);
        response.setContentType("application/json;charset=UTF-8");
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.getWriter().write(objectMapper.writeValueAsString(Map.of("message", message)));
        return false;
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response,
                                Object handler, Exception ex) {
        AuthContext.clear();
    }
}
