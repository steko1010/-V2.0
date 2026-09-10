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

/** 预研 / 项目专项。 */
@RestController
@RequestMapping("/api")
public class PrestudiesController {

    private final JdbcTemplate jdbc;

    public PrestudiesController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static List<String> allowedFields() {
        List<String> fields = new ArrayList<>(Biz.PRESTUDY_FIELDS);
        fields.add("source");
        fields.add("progress");
        return fields;
    }

    private Map<String, String> pickPrestudy(Map<String, Object> body, boolean partial) {
        Map<String, String> out = Biz.pick(body == null ? Map.of() : body, allowedFields());
        if (!partial && Sql.s(out.get("topic")).isEmpty()) {
            throw ApiException.badRequest("专项名称不能为空");
        }
        return out;
    }

    private static List<String> exportHeaders() {
        return List.of("物料品类", "专项名称", "风险", "立项", "P1", "P2", "P3", "状态", "责任人");
    }

    private static List<String> exportFields() {
        return List.of("category", "topic", "risk", "milestone_lx", "milestone_p1", "milestone_p2",
                "milestone_p3", "status", "owner");
    }

    @GetMapping("/prestudies")
    public Map<String, Object> list(@RequestParam(required = false) String keyword,
                                    @RequestParam(required = false) String category,
                                    @RequestParam(required = false) String status,
                                    @RequestParam(defaultValue = "1") int page,
                                    @RequestParam(defaultValue = "20") int pageSize) {
        ScopeBuilder.Scope scope = ScopeBuilder.build("category", null, true);
        List<String> cond = new ArrayList<>();
        List<Object> params = new ArrayList<>();
        if (keyword != null && !keyword.trim().isEmpty()) {
            String k = Sql.like(keyword);
            cond.add("(category LIKE ? OR topic LIKE ? OR risk LIKE ? OR milestone_lx LIKE ? "
                    + "OR milestone_p1 LIKE ? OR milestone_p2 LIKE ? OR milestone_p3 LIKE ? "
                    + "OR status LIKE ? OR owner LIKE ?)");
            params.addAll(List.of(k, k, k, k, k, k, k, k, k));
        }
        if (category != null && !category.isEmpty()) {
            cond.add("category = ?");
            params.add(category);
        }
        if (status != null && !status.isEmpty()) {
            cond.add("status = ?");
            params.add(status);
        }
        if (!scope.where.isEmpty()) {
            cond.add(scope.where.substring(5));
        }
        params.addAll(scope.params);
        String where = cond.isEmpty() ? "" : " WHERE " + String.join(" AND ", cond);
        Long total = jdbc.queryForObject("SELECT COUNT(*) FROM prestudies" + where, Long.class, params.toArray());
        int p = Math.max(1, page);
        int ps = Math.max(1, Math.min(100, pageSize));
        List<Map<String, Object>> items = jdbc.queryForList(
                "SELECT * FROM prestudies" + where + " ORDER BY id ASC LIMIT ? OFFSET ?",
                addParams(params, ps, (p - 1) * ps));
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("total", total == null ? 0 : total);
        resp.put("page", p);
        resp.put("pageSize", ps);
        resp.put("items", items);
        return resp;
    }

    @PostMapping("/prestudies")
    @RequirePerm("action:create")
    @Transactional
    public Map<String, Object> create(@RequestBody(required = false) Map<String, Object> body) {
        Map<String, String> data = pickPrestudy(body, false);
        data.putIfAbsent("source", "手动");
        String now = Sql.now();
        data.put("created_at", now);
        data.put("updated_at", now);
        long id = insert(data);
        return jdbc.queryForMap("SELECT * FROM prestudies WHERE id = ?", id);
    }

    private long insert(Map<String, String> data) {
        String keys = String.join(",", data.keySet());
        String marks = String.join(",", java.util.Collections.nCopies(data.size(), "?"));
        jdbc.update("INSERT INTO prestudies (" + keys + ") VALUES (" + marks + ")",
                data.values().toArray());
        Long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        return id == null ? 0 : id;
    }

    @PutMapping("/prestudies/{id}")
    @RequirePerm("action:edit")
    public Map<String, Object> update(@PathVariable long id,
                                      @RequestBody(required = false) Map<String, Object> body) {
        List<Map<String, Object>> exists = jdbc.queryForList("SELECT id FROM prestudies WHERE id = ?", id);
        if (exists.isEmpty()) {
            throw ApiException.notFound("专项不存在");
        }
        Map<String, String> data = pickPrestudy(body, true);
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
        jdbc.update("UPDATE prestudies SET " + String.join(",", sets) + " WHERE id = ?", params.toArray());
        return jdbc.queryForMap("SELECT * FROM prestudies WHERE id = ?", id);
    }

    @DeleteMapping("/prestudies/{id}")
    @RequirePerm("action:delete")
    public Map<String, Object> delete(@PathVariable long id) {
        int n = jdbc.update("DELETE FROM prestudies WHERE id = ?", id);
        if (n == 0) {
            throw ApiException.notFound("专项不存在");
        }
        return Map.of("ok", true);
    }

    @PostMapping("/prestudies/batch")
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
                Map<String, String> data = pickPrestudy(body, false);
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

    @GetMapping("/prestudies/export")
    @RequirePerm("action:export")
    public ResponseEntity<byte[]> export() {
        ScopeBuilder.Scope scope = ScopeBuilder.build("category", null, true);
        String where = " WHERE 1=1" + scope.where;
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT *, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at FROM prestudies"
                        + where + " ORDER BY id DESC", scope.params.toArray());
        byte[] bytes = ExcelWriter.buildXlsx("项目专项", exportHeaders(), rows, exportFields());
        return ResponseEntity.ok()
                .header(org.springframework.http.HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"prestudies_" + Sql.today() + ".xlsx\"")
                .contentType(org.springframework.http.MediaType.parseMediaType(
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
                .body(bytes);
    }

    @GetMapping("/prestudies/stats")
    public Map<String, Object> stats() {
        ScopeBuilder.Scope scope = ScopeBuilder.build("category", null, true);
        String where = " WHERE 1=1" + scope.where;
        Object[] args = scope.params.toArray();
        Long total = jdbc.queryForObject("SELECT COUNT(*) FROM prestudies" + where, Long.class, args);
        List<Map<String, Object>> byCategory = jdbc.queryForList(
                "SELECT category AS name, COUNT(*) AS value FROM prestudies WHERE category != ''"
                        + scope.where + " GROUP BY category ORDER BY value DESC", args);
        List<Map<String, Object>> byStatus = jdbc.queryForList(
                "SELECT status AS name, COUNT(*) AS value FROM prestudies WHERE status != ''"
                        + scope.where + " GROUP BY status ORDER BY value DESC", args);
        List<Map<String, Object>> byProgress = new ArrayList<>();
        for (String[] milestone : new String[][]{{"立项", "milestone_lx"}, {"P1", "milestone_p1"},
                {"P2", "milestone_p2"}, {"P3", "milestone_p3"}}) {
            Long c = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM prestudies WHERE " + milestone[1] + " != ''" + scope.where,
                    Long.class, args);
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("name", milestone[0]);
            row.put("value", c == null ? 0 : c);
            byProgress.add(row);
        }
        List<Map<String, Object>> byOwner = jdbc.queryForList(
                "SELECT owner AS name, COUNT(*) AS value FROM prestudies WHERE owner != ''"
                        + scope.where + " GROUP BY owner ORDER BY value DESC LIMIT 10", args);
        List<Map<String, Object>> recent = jdbc.queryForList(
                "SELECT id, category, topic, milestone_lx, milestone_p1, milestone_p2, milestone_p3, "
                        + "status, owner FROM prestudies" + where + " ORDER BY id DESC LIMIT 8", args);
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("total", total == null ? 0 : total);
        resp.put("byCategory", byCategory);
        resp.put("byStatus", byStatus);
        resp.put("byProgress", byProgress);
        resp.put("byOwner", byOwner);
        resp.put("recent", recent);
        return resp;
    }

    private Object[] addParams(List<Object> params, Object... extra) {
        List<Object> all = new ArrayList<>(params);
        all.addAll(List.of(extra));
        return all.toArray();
    }
}
