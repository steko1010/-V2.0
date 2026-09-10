package com.materialcert.server.common;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashMap;
import java.util.Map;

/**
 * 轻量 .env 读取（与 Node 版一致）：从 backend/.env、backend/../.env（仓库根）读取，
 * 已存在的系统环境变量优先；用于 AI 接口密钥（AI_API_KEY / AI_BASE_URL / AI_MODEL）等。
 */
public final class Env {

    private static final Map<String, String> VARS = new HashMap<>();

    static {
        loadIfExists(Paths.get(".env"));
        loadIfExists(Paths.get("..", ".env"));
    }

    private Env() {
    }

    private static void loadIfExists(Path file) {
        try {
            if (!Files.exists(file)) {
                return;
            }
            for (String line : Files.readAllLines(file, StandardCharsets.UTF_8)) {
                String t = line.trim();
                if (t.isEmpty() || t.startsWith("#")) {
                    continue;
                }
                int eq = t.indexOf('=');
                if (eq <= 0) {
                    continue;
                }
                String key = t.substring(0, eq).trim();
                String val = t.substring(eq + 1).trim();
                if (val.length() >= 2) {
                    char a = val.charAt(0);
                    char b = val.charAt(val.length() - 1);
                    if ((a == '"' && b == '"') || (a == '\'' && b == '\'')) {
                        val = val.substring(1, val.length() - 1);
                    }
                }
                VARS.putIfAbsent(key, val);
            }
        } catch (IOException ignored) {
            // .env 读取失败不影响启动
        }
    }

    /** 优先系统环境变量，其次 .env，最后使用默认值。 */
    public static String get(String key, String defaultValue) {
        String sys = System.getenv(key);
        if (sys != null && !sys.isEmpty()) {
            return sys;
        }
        return VARS.getOrDefault(key, defaultValue);
    }
}
