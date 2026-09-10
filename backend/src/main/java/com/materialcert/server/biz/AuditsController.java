package com.materialcert.server.biz;

import com.materialcert.server.auth.RequirePerm;
import com.materialcert.server.common.ApiException;
import com.materialcert.server.common.Biz;
import com.materialcert.server.common.Sql;
import com.materialcert.server.excel.ExcelWriter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 供应商稽核模块（记录 + 看板统计）。 */
@RestController
@RequestMapping("/api")
public class AuditsController {

    private final JdbcTemplate jdbc;

    public AuditsController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private Map<String, String> pickAudit(Map<String, Object> body, boolean partial) {
        Map<String, String> out = Biz.pick(body == null ? Map.of() : body, Biz.AUDIT_FIELDS);
        if (!partial && Sql.s(out.get("supplier")).isEmpty()) {
            throw ApiException.badRequest("供应商不能为空");
        }
        if (out.containsKey("result") && !Biz.AUDIT_RESULTS.contains(out.get("result"))) {
            out.put("result", "合格");
        }
        return out;
    }

    private static List<String> exportHeaders() {
        return List.of("物料品类", "审核日期", "供应商", "审核内容", "审核结果", "审核员");
    }

    private static List<String> exportFields() {
        return List.of("material_type", "audit_date", "supplier", "scope", "result", "auditor");
    }

    // ---------- 列表 ----------

    @GetMapping("/audits")
    public Map<String, Object> list(@RequestParam(required = false) String keyword,
                                    @RequestParam(required = false) String materialType,
                                    @RequestParam(required = false) String result,
                                    @RequestParam(required = false) String supplier,
                                    @RequestParam(defaultValue = "1") int page,
                                    @RequestParam(defaultValue = "20") int pageSize) {
        ScopeBuilder.Scope scope = ScopeBuilder.build("material_type", "supplier", true);
        List<String> cond = new ArrayList<>();
        List<Object> params = new ArrayList<>();
        if (keyword != null && !keyword.trim().isEmpty()) {
            String k = Sql.like(keyword);
            cond.add("(supplier LIKE ? OR auditor LIKE ? OR scope LIKE ? OR summary LIKE ? OR material_type LIKE ?)");
            params.addAll(List.of(k, k, k, k, k));
        }
        if (materialType != null && !materialType.isEmpty()) {
            cond.add("material_type = ?");
            params.add(materialType);
        }
        if (result != null && !result.isEmpty()) {
            cond.add("result = ?");
            params.add(result);
        }
        if (supplier != null && !supplier.isEmpty()) {
            cond.add("supplier = ?");
            params.add(supplier);
        }
        if (!scope.where.isEmpty()) {
            cond.add(scope.where.substring(5));
        }
        params.addAll(scope.params);
        String where = cond.isEmpty() ? "" : " WHERE " + String.join(" AND ", cond);
        Long total = jdbc.queryForObject("SELECT COUNT(*) FROM audits" + where, Long.class, params.toArray());
        int p = Math.max(1, page);
        int ps = Math.max(1, Math.min(100, pageSize));
        List<Map<String, Object>> items = jdbc.queryForList(
                "SELECT * FROM audits" + where + " ORDER BY id ASC LIMIT ? OFFSET ?",
                addParams(params, ps, (p - 1) * ps));
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("total", total == null ? 0 : total);
        resp.put("page", p);
        resp.put("pageSize", ps);
        resp.put("items", items);
        return resp;
    }

    // ---------- 新增 / 更新 / 删除 ----------

    @PostMapping("/audits")
    @RequirePerm("action:create")
    @Transactional
    public Map<String, Object> create(@RequestBody(required = false) Map<String, Object> body) {
        Map<String, String> data = pickAudit(body, false);
        String now = Sql.now();
        data.put("created_at", now);
        data.put("updated_at", now);
        long id = insert(data);
        return jdbc.queryForMap("SELECT * FROM audits WHERE id = ?", id);
    }

    private long insert(Map<String, String> data) {
        String keys = String.join(",", data.keySet());
        String marks = String.join(",", java.util.Collections.nCopies(data.size(), "?"));
        jdbc.update("INSERT INTO audits (" + keys + ") VALUES (" + marks + ")",
                data.values().toArray());
        Long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        return id == null ? 0 : id;
    }

    @PutMapping("/audits/{id}")
    @RequirePerm("action:edit")
    public Map<String, Object> update(@PathVariable long id,
                                      @RequestBody(required = false) Map<String, Object> body) {
        List<Map<String, Object>> exists = jdbc.queryForList("SELECT id FROM audits WHERE id = ?", id);
        if (exists.isEmpty()) {
            throw ApiException.notFound("稽核记录不存在");
        }
        Map<String, String> data = pickAudit(body, true);
        data.put("updated_at", Sql.now());
        if (data.size() <= 1) {
            throw ApiException.badRequest("没有可更新的字段");
        }
        List<String> sets = new ArrayList<>();
        List<Object> params = new ArrayList<>();
        for (Map.Entry<String, String> e : data.entrySet()) {
            sets.add(e.getKey() + " = ?");
            params.add(e.getValue());
        }
        params.add(id);
        jdbc.update("UPDATE audits SET " + String.join(",", sets) + " WHERE id = ?", params.toArray());
        return jdbc.queryForMap("SELECT * FROM audits WHERE id = ?", id);
    }

    @DeleteMapping("/audits/{id}")
    @RequirePerm("action:delete")
    public Map<String, Object> delete(@PathVariable long id) {
        int n = jdbc.update("DELETE FROM audits WHERE id = ?", id);
        if (n == 0) {
            throw ApiException.notFound("稽核记录不存在");
        }
        return Map.of("ok", true);
    }

    // ---------- 批量导入 / 导出 ----------

    @PostMapping("/audits/batch")
    @RequirePerm("action:import")
    @Transactional
    public Map<String, Object> batch(@RequestBody(required = false) Map<String, Object> payload) {
        Object raw = payload == null ? null : payload.get("items");
        if (!(raw instanceof List<?> items) || items.isEmpty()) {
            throw ApiException.badRequest("没有可导入的数据");
        }
        int success = 0;
        List<Map<String, Object>> errors = new ArrayList<>();
        String now = Sql.now();
        for (int i = 0; i < items.size(); i++) {
            Object o = items.get(i);
            Map<String, Object> body = new LinkedHashMap<>();
            if (o instanceof Map<?, ?> m) {
                for (Map.Entry<?, ?> e : m.entrySet()) {
                    body.put(String.valueOf(e.getKey()), e.getValue());
                }
            }
            try {
                Map<String, String> data = pickAudit(body, false);
                data.put("created_at", now);
                data.put("updated_at", now);
                insert(data);
                success++;
            } catch (ApiException e) {
                Map<String, Object> err = new LinkedHashMap<>();
                err.put("rowIndex", i + 1);
                err.put("row", o);
                err.put("message", e.getMessage());
                errors.add(err);
            } catch (Exception e) {
                Map<String, Object> err = new LinkedHashMap<>();
                err.put("rowIndex", i + 1);
                err.put("row", o);
                err.put("message", e.getMessage() == null ? "数据格式错误" : e.getMessage());
                errors.add(err);
            }
        }
        return Map.of("success", success, "errors", errors);
    }

    @GetMapping("/audits/export")
    @RequirePerm("action:export")
    public ResponseEntity<byte[]> export(@RequestParam(required = false) String keyword,
                                         @RequestParam(required = false) String materialType,
                                         @RequestParam(required = false) String result) {
        ScopeBuilder.Scope scope = ScopeBuilder.build("material_type", "supplier", true);
        List<String> cond = new ArrayList<>();
        List<Object> params = new ArrayList<>();
        if (keyword != null && !keyword.trim().isEmpty()) {
            String k = Sql.like(keyword);
            cond.add("(supplier LIKE ? OR auditor LIKE ? OR scope LIKE ? OR summary LIKE ? OR material_type LIKE ?)");
            params.addAll(List.of(k, k, k, k, k));
        }
        if (materialType != null && !materialType.isEmpty()) {
            cond.add("material_type = ?");
            params.add(materialType);
        }
        if (result != null && !result.isEmpty()) {
            cond.add("result = ?");
            params.add(result);
        }
        if (!scope.where.isEmpty()) {
            cond.add(scope.where.substring(5));
        }
        params.addAll(scope.params);
        String where = cond.isEmpty() ? "" : " WHERE " + String.join(" AND ", cond);
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT * FROM audits" + where + " ORDER BY id DESC", params.toArray());
        byte[] bytes = ExcelWriter.buildXlsx("稽核记录", exportHeaders(), rows, exportFields());
        return ResponseEntity.ok()
                .header(org.springframework.http.HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"audits_" + Sql.today() + ".xlsx\"")
                .contentType(org.springframework.http.MediaType.parseMediaType(
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
                .body(bytes);
    }

    // ---------- 看板统计 ----------

    @GetMapping("/audits/stats")
    public Map<String, Object> stats() {
        ScopeBuilder.Scope scope = ScopeBuilder.build("material_type", "supplier", true);
        String where = " WHERE 1=1" + scope.where;
        Object[] args = scope.params.toArray();
        Long total = jdbc.queryForObject("SELECT COUNT(*) FROM audits" + where, Long.class, args);
        List<Map<String, Object>> byResult = jdbc.queryForList(
                "SELECT result AS name, COUNT(*) AS value FROM audits" + where
                        + " GROUP BY result ORDER BY value DESC", args);
        List<Map<String, Object>> recent = jdbc.queryForList(
                "SELECT id, supplier, audit_date, auditor, scope, result, score FROM audits" + where
                        + " ORDER BY id DESC LIMIT 8", args);
        // 按供应商聚合：稽核次数、问题个数、结果分布、最近稽核时间（复刻 Node 版逻辑）
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT supplier, material_type, audit_date, scope, result FROM audits WHERE supplier != ''"
                        + scope.where, args);
        Map<String, Map<String, Object>> map = new LinkedHashMap<>();
        for (Map<String, Object> r : rows) {
            String name = Sql.s(r.get("supplier"));
            Map<String, Object> item = map.get(name);
            if (item == null) {
                item = new LinkedHashMap<>();
                item.put("name", name);
                item.put("count", 0L);
                item.put("issues", 0L);
                item.put("results", new LinkedHashMap<String, Long>());
                item.put("materialType", Sql.s(r.get("material_type")));
                item.put("lastDate", Sql.s(r.get("audit_date")));
                map.put(name, item);
            }
            item.put("count", ((Number) item.get("count")).longValue() + 1);
            item.put("issues", ((Number) item.get("issues")).longValue() + countIssues(r.get("scope")));
            String result = Sql.s(r.get("result"));
            if (result.isEmpty()) {
                result = "未知";
            }
            @SuppressWarnings("unchecked")
            Map<String, Long> results = (Map<String, Long>) item.get("results");
            results.put(result, results.getOrDefault(result, 0L) + 1);
            String auditDate = Sql.s(r.get("audit_date"));
            if (!auditDate.isEmpty() && auditDate.compareTo(Sql.s(item.get("lastDate"))) > 0) {
                item.put("lastDate", auditDate);
            }
        }
        List<Map<String, Object>> bySupplier = new ArrayList<>();
        for (Map<String, Object> item : map.values()) {
            long issues = ((Number) item.remove("issues")).longValue();
            item.put("issueCount", issues);
            bySupplier.add(item);
        }
        bySupplier.sort((a, b) -> {
            int c = Long.compare(((Number) b.get("count")).longValue(),
                    ((Number) a.get("count")).longValue());
            return c != 0 ? c : Long.compare(((Number) b.get("issueCount")).longValue(),
                    ((Number) a.get("issueCount")).longValue());
        });
        // 年度趋势：横轴=年，纵轴=问题个数，每个供应商一条曲线（问题总量 TOP 6）
        Map<String, Map<String, Long>> trendMap = new LinkedHashMap<>();
        for (Map<String, Object> r : rows) {
            String auditDate = Sql.s(r.get("audit_date"));
            if (auditDate.length() < 4) {
                continue;
            }
            String year = auditDate.substring(0, 4);
            if (!year.matches("\\d{4}")) {
                continue;
            }
            String name = Sql.s(r.get("supplier"));
            Map<String, Long> pts = trendMap.computeIfAbsent(name, k -> new LinkedHashMap<>());
            pts.put(year, pts.getOrDefault(year, 0L) + countIssues(r.get("scope")));
        }
        List<String> years = new ArrayList<>(new java.util.TreeSet<>(trendMap.values().stream()
                .flatMap(m -> m.keySet().stream()).toList()));
        List<Map<String, Object>> trendSeries = new ArrayList<>();
        for (Map.Entry<String, Map<String, Long>> e : trendMap.entrySet()) {
            Map<String, Object> s = new LinkedHashMap<>();
            s.put("name", e.getKey());
            List<Long> values = new ArrayList<>();
            for (String y : years) {
                values.add(e.getValue().getOrDefault(y, 0L));
            }
            s.put("values", values);
            trendSeries.add(s);
        }
        trendSeries.sort((a, b) -> Long.compare(sumValues(b.get("values")), sumValues(a.get("values"))));
        if (trendSeries.size() > 6) {
            trendSeries = new ArrayList<>(trendSeries.subList(0, 6));
        }
        Map<String, Object> issueTrend = new LinkedHashMap<>();
        issueTrend.put("years", years);
        issueTrend.put("series", trendSeries);
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("total", total == null ? 0 : total);
        resp.put("byResult", byResult);
        resp.put("recent", recent);
        resp.put("bySupplier", bySupplier);
        resp.put("issueTrend", issueTrend);
        return resp;
    }

    private static long sumValues(Object values) {
        long s = 0;
        if (values instanceof List<?> list) {
            for (Object v : list) {
                s += ((Number) v).longValue();
            }
        }
        return s;
    }

    /** 统计 scope 文本中的问题个数：优先数字编号条目，否则按非空行数。 */
    private static long countIssues(Object scopeVal) {
        String s = String.valueOf(scopeVal == null ? "" : scopeVal).trim();
        if (s.isEmpty()) {
            return 0;
        }
        long numbered = 0;
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("\\d+\\s*[、.．\\)）]").matcher(s);
        while (m.find()) {
            numbered++;
        }
        if (numbered > 0) {
            return numbered;
        }
        long lines = 0;
        for (String l : s.split("\\r?\\n")) {
            if (!l.trim().isEmpty()) {
                lines++;
            }
        }
        return lines;
    }

    private Object[] addParams(List<Object> params, Object... extra) {
        List<Object> all = new ArrayList<>(params);
        all.addAll(List.of(extra));
        return all.toArray();
    }
}
