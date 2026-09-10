package com.materialcert.server.biz;

import com.materialcert.server.auth.AuthContext;
import com.materialcert.server.common.Biz;
import com.materialcert.server.common.Sql;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 首页统计（/api/stats）与元数据下拉（/api/meta）。 */
@RestController
@RequestMapping("/api")
public class StatsController {

    private final JdbcTemplate jdbc;

    public StatsController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping("/stats")
    public Map<String, Object> stats() {
        ScopeBuilder.Scope scope = ScopeBuilder.build("category", "supplier", true);
        String where = " WHERE 1=1" + scope.where;
        long total = count("SELECT COUNT(*) FROM materials" + where, scope.params);

        List<Map<String, Object>> byStatus = jdbc.queryForList(
                "SELECT status AS name, COUNT(*) AS value FROM materials" + where
                        + " GROUP BY status ORDER BY value DESC", scope.params.toArray());
        List<Map<String, Object>> byCategory = jdbc.queryForList(
                "SELECT category AS name, COUNT(*) AS value FROM materials WHERE category != ''"
                        + scope.where + " GROUP BY category ORDER BY value DESC LIMIT 12", scope.params.toArray());
        List<Map<String, Object>> bySupplier = jdbc.queryForList(
                "SELECT supplier AS name, COUNT(*) AS value FROM materials WHERE supplier != ''"
                        + scope.where + " GROUP BY supplier ORDER BY value DESC LIMIT 10", scope.params.toArray());

        long certOk = count("SELECT COUNT(*) FROM materials WHERE status = '绿区'" + scope.where, scope.params);
        long inProgress = count("SELECT COUNT(*) FROM materials WHERE status = '黄区'" + scope.where, scope.params);

        String today = Sql.today();
        List<Map<String, Object>> expired = jdbc.queryForList(
                "SELECT id, code, name, model, supplier, cert_expire_date, status FROM materials "
                        + "WHERE status = '红区'" + scope.where
                        + " ORDER BY CASE WHEN cert_expire_date = '' THEN 1 ELSE 0 END, cert_expire_date ASC LIMIT 20",
                scope.params.toArray());
        List<Object> expiringParams = new ArrayList<>(List.of(today, Sql.todayPlusDays(90)));
        expiringParams.addAll(scope.params);
        List<Map<String, Object>> expiring = jdbc.queryForList(
                "SELECT id, code, name, model, supplier, cert_expire_date, status FROM materials "
                        + "WHERE status = '绿区' AND cert_expire_date != '' AND cert_expire_date >= ? "
                        + "AND cert_expire_date <= ?" + scope.where + " ORDER BY cert_expire_date ASC LIMIT 20",
                expiringParams.toArray());

        List<Map<String, Object>> recent = jdbc.queryForList(
                "SELECT id, code, name, model, status, applied_by, created_at FROM materials" + where
                        + " ORDER BY id DESC LIMIT 10", scope.params.toArray());

        Map<String, Object> docCoverage = new LinkedHashMap<>();
        for (String d : Biz.DOCS) {
            long has = count("SELECT COUNT(*) FROM materials WHERE " + d + " = '有'" + scope.where, scope.params);
            docCoverage.put(Biz.DOC_LABELS.get(d), total == 0 ? 0 : Math.round((has * 100.0) / total));
        }

        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("total", total);
        resp.put("certOk", certOk);
        resp.put("inProgress", inProgress);
        resp.put("byStatus", byStatus);
        resp.put("byCategory", byCategory);
        resp.put("bySupplier", bySupplier);
        resp.put("expired", expired);
        resp.put("expiring", expiring);
        resp.put("recent", recent);
        resp.put("docCoverage", docCoverage);
        return resp;
    }

    @GetMapping("/meta")
    public Map<String, Object> meta() {
        List<String> categories = new ArrayList<>();
        boolean superUser = Boolean.TRUE.equals(AuthContext.user().get("isSuper"));
        List<String> scoped = AuthContext.categoriesScope();
        try {
            if (superUser || scoped.isEmpty()) {
                List<Map<String, Object>> rows = jdbc.queryForList(
                        "SELECT DISTINCT mid FROM material_categories WHERE TRIM(IFNULL(mid, '')) != ''");
                for (Map<String, Object> r : rows) {
                    String mid = Sql.s(r.get("mid"));
                    if (!mid.isEmpty() && !categories.contains(mid)) {
                        categories.add(mid);
                    }
                }
            } else {
                categories.addAll(scoped);
            }
        } catch (Exception ignored) {
            categories.clear();
        }
        java.text.Collator collator = java.text.Collator.getInstance(java.util.Locale.CHINA);
        categories.sort(collator);

        ScopeBuilder.Scope scope = ScopeBuilder.build("category", "supplier", true);
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT DISTINCT supplier FROM materials WHERE supplier != ''" + scope.where
                        + " ORDER BY supplier", scope.params.toArray());
        List<String> suppliers = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            suppliers.add(Sql.s(r.get("supplier")));
        }

        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("statuses", Biz.STATUSES);
        resp.put("docStatuses", Biz.DOC_STATUSES);
        resp.put("categories", categories);
        resp.put("suppliers", suppliers);
        return resp;
    }

    private long count(String sql, List<Object> params) {
        Long c = jdbc.queryForObject(sql, Long.class, params.toArray());
        return c == null ? 0 : c;
    }
}
