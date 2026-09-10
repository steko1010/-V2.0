package com.materialcert.server.auth;

import java.util.List;
import java.util.Map;
import com.materialcert.server.common.ApiException;

/** 线程级当前登录用户上下文（由 AuthInterceptor 注入）。 */
public final class AuthContext {

    private static final ThreadLocal<Map<String, Object>> CURRENT = new ThreadLocal<>();

    private AuthContext() {
    }

    public static void set(Map<String, Object> user) {
        CURRENT.set(user);
    }

    public static void clear() {
        CURRENT.remove();
    }

    public static Map<String, Object> user() {
        return CURRENT.get();
    }

    public static long userId() {
        Object v = CURRENT.get() == null ? null : CURRENT.get().get("id");
        if (v instanceof Number n) {
            return n.longValue();
        }
        throw ApiException.unauthorized("未登录");
    }

    @SuppressWarnings("unchecked")
    public static List<String> categoriesScope() {
        Map<String, Object> u = CURRENT.get();
        if (u == null) {
            return List.of();
        }
        Map<String, Object> scopes = (Map<String, Object>) u.get("scopes");
        if (scopes == null) {
            return List.of();
        }
        return (List<String>) scopes.getOrDefault("categories", List.of());
    }

    @SuppressWarnings("unchecked")
    public static List<String> suppliersScope() {
        Map<String, Object> u = CURRENT.get();
        if (u == null) {
            return List.of();
        }
        Map<String, Object> scopes = (Map<String, Object>) u.get("scopes");
        if (scopes == null) {
            return List.of();
        }
        return (List<String>) scopes.getOrDefault("suppliers", List.of());
    }
}
