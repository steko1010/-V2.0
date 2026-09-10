package com.materialcert.server.common;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;

/** 与 Node 版一致的字符串化/时间工具。 */
public final class Sql {

    public static final DateTimeFormatter FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    public static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("yyyy-MM-dd");

    private Sql() {
    }

    /** Node: new Date().toISOString().slice(0,19).replace('T',' ') —— 但 Node 版直接用本地时间更贴近。 */
    public static String now() {
        return LocalDateTime.now().format(FMT);
    }

    public static String today() {
        return LocalDateTime.now().format(DATE);
    }

    /** SQLite date('now','+90 day') 等价。 */
    public static String todayPlusDays(long days) {
        return LocalDateTime.now().plusDays(days).format(DATE);
    }

    /** trim 后若为 null 转空串（等同 SQLite TEXT DEFAULT ''）。 */
    public static String s(Object v) {
        return v == null ? "" : String.valueOf(v).trim();
    }

    /** 空则给默认值。 */
    public static String or(Object v, String def) {
        if (v == null) {
            return def;
        }
        String t = String.valueOf(v).trim();
        return t.isEmpty() ? def : t;
    }

    public static String nvl(Object v) {
        return v == null ? "" : String.valueOf(v);
    }

    public static String like(Object v) {
        return "%" + String.valueOf(v).trim() + "%";
    }

    public static int intVal(Object v, int def) {
        if (v == null) {
            return def;
        }
        try {
            return Integer.parseInt(String.valueOf(v).trim());
        } catch (NumberFormatException e) {
            return def;
        }
    }

    public static long longVal(Object v, long def) {
        if (v == null) {
            return def;
        }
        try {
            return Long.parseLong(String.valueOf(v).trim());
        } catch (NumberFormatException e) {
            return def;
        }
    }

    /** MySQL 动态 IN 占位符，与 Node 的 placeholders 一致。 */
    public static String inPlaceholders(int n) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) {
            if (i > 0) {
                sb.append(',');
            }
            sb.append('?');
        }
        return sb.toString();
    }

    public static <T> void addAll(List<Object> target, List<T> src) {
        for (T t : src) {
            target.add(t);
        }
    }
}
