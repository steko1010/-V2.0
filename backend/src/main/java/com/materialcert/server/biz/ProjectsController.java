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

/**
 * BOM / 项目模块：物料清单 CRUD、批量导入、导出、看板统计。
 */
@RestController
@RequestMapping("/api")
public class ProjectsController {

    private final JdbcTemplate jdbc;

    public ProjectsController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static List<String> allowedFields() {
        return Biz.projectFields();
    }

    private Map<String, String> pickProject(Map<String, Object> body, boolean partial) {
        Map<String, String> out = Biz.pick(body == null ? Map.of() : body, allowedFields());
        if (!partial && Sql.s(out.get("project_name")).isEmpty()) {
            throw ApiException.badRequest("项目名称不能为空");
        }
        return out;
    }

    // ---------- 列表 ----------

    @GetMapping("/projects")
    public Map<String, Object> list(@RequestParam(required = false) String keyword,
                                    @RequestParam(required = false) String category,
                                    @RequestParam(required = false) String supplier,
                                    @RequestParam(required = false) String source,
                                    @RequestParam(defaultValue = "1") int page,
                                    @RequestParam(defaultValue = "20") int pageSize) {
        ScopeBuilder.Scope scope = ScopeBuilder.build("category", "supplier", true);
        List<String> cond = new ArrayList<>();
        List<Object> params = new ArrayList<>();
        if (keyword != null && !keyword.trim().isEmpty()) {
            String k = Sql.like(keyword);
            cond.add("(project_name LIKE ? OR supplier LIKE ? OR flow LIKE ?)");
            params.addAll(List.of(k, k, k));
        }
        if (category != null && !category.isEmpty()) {
            cond.add("category = ?");
            params.add(category);
        }
        if (supplier != null && !supplier.isEmpty()) {
            cond.add("supplier = ?");
            params.add(supplier);
        }
        if (source != null && !source.isEmpty()) {
            cond.add("source = ?");
            params.add(source);
        }
        if (!scope.where.isEmpty()) {
            cond.add(scope.where.substring(5));
        }
        params.addAll(scope.params);
        String where = cond.isEmpty() ? "" : " WHERE " + String.join(" AND ", cond);
        Long total = jdbc.queryForObject("SELECT COUNT(*) FROM projects" + where, Long.class, params.toArray());
        int p = Math.max(1, page);
        int ps = Math.max(1, Math.min(100, pageSize));
        List<Map<String, Object>> items = jdbc.queryForList(
                "SELECT * FROM projects" + where + " ORDER BY id ASC LIMIT ? OFFSET ?",
                addParams(params, ps, (p - 1) * ps));
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("total", total == null ? 0 : total);
        resp.put("page", p);
        resp.put("pageSize", ps);
        resp.put("items", items);
        return resp;
    }

    // ---------- 新增 / 更新 / 删除 ----------

    @PostMapping("/projects")
    @RequirePerm("action:create")
    @Transactional
    public Map<String, Object> create(@RequestBody(required = false) Map<String, Object> body) {
        Map<String, String> data = pickProject(body, false);
        data.putIfAbsent("source", "手动");
        String now = Sql.now();
        data.put("created_at", now);
        data.put("updated_at", now);
        long id = insert(data);
        return jdbc.queryForMap("SELECT * FROM projects WHERE id = ?", id);
    }

    private long insert(Map<String, String> data) {
        String keys = String.join(",", data.keySet());
        String marks = String.join(",", java.util.Collections.nCopies(data.size(), "?"));
        jdbc.update("INSERT INTO projects (" + keys + ") VALUES (" + marks + ")",
                data.values().toArray());
        Long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        return id == null ? 0 : id;
    }

    @PutMapping("/projects/{id}")
    @RequirePerm("action:edit")
    public Map<String, Object> update(@PathVariable long id,
                                      @RequestBody(required = false) Map<String, Object> body) {
        List<Map<String, Object>> exists = jdbc.queryForList("SELECT id FROM projects WHERE id = ?", id);
        if (exists.isEmpty()) {
            throw ApiException.notFound("BOM 记录不存在");
        }
        Map<String, String> data = pickProject(body, true);
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
        jdbc.update("UPDATE projects SET " + String.join(",", sets) + " WHERE id = ?", params.toArray());
        return jdbc.queryForMap("SELECT * FROM projects WHERE id = ?", id);
    }

    @DeleteMapping("/projects/{id}")
    @RequirePerm("action:delete")
    public Map<String, Object> delete(@PathVariable long id) {
        int n = jdbc.update("DELETE FROM projects WHERE id = ?", id);
        if (n == 0) {
            throw ApiException.notFound("BOM 记录不存在");
        }
        return Map.of("ok", true);
    }

    // ---------- 批量导入 / 导出 ----------

    @PostMapping("/projects/batch")
    @RequirePerm("action:import")
    @Transactional
    public Map<String, Object> batch(@RequestBody(required = false) Map<String, Object> payload) {
        Object raw = payload == null ? null : payload.get("items");
        if (!(raw instanceof List<?> items) || items.isEmpty()) {
            throw ApiException.badRequest("没有可导入的数据");
        }
        int success = 0;
        List<Map<String, Object>> errors = new ArrayList<>();
        List<Object> skipped = new ArrayList<>();
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
                Map<String, String> data = pickProject(body, false);
                String projectName = Sql.s(data.get("project_name"));
                String supplier = Sql.s(data.get("supplier"));
                if (!projectName.isEmpty()) {
                    List<Map<String, Object>> dup = jdbc.queryForList(
                            "SELECT id FROM projects WHERE project_name = ? AND supplier = ?",
                            projectName, supplier);
                    if (!dup.isEmpty()) {
                        data.put("updated_at", now);
                        List<String> sets = new ArrayList<>();
                        List<Object> params = new ArrayList<>();
                        for (Map.Entry<String, String> e2 : data.entrySet()) {
                            sets.add(e2.getKey() + " = ?");
                            params.add(e2.getValue());
                        }
                        params.add(((Number) dup.get(0).get("id")).longValue());
                        jdbc.update("UPDATE projects SET " + String.join(",", sets) + " WHERE id = ?",
                                params.toArray());
                    } else {
                        data.put("source", "手动");
                        data.put("created_at", now);
                        data.put("updated_at", now);
                        insert(data);
                    }
                    success++;
                } else {
                    Map<String, Object> err = new LinkedHashMap<>();
                    err.put("rowIndex", i + 1);
                    err.put("row", o);
                    err.put("message", "项目名称不能为空");
                    errors.add(err);
                }
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
        return Map.of("success", success, "skipped", skipped, "errors", errors);
    }

    private static final List<String> EXPORT_HEADERS = buildHeaders();

    private static List<String> buildHeaders() {
        List<String> headers = new ArrayList<>(List.of("项目名称", "供应商", "物料品类", "流程", "来源"));
        for (String[] row : Biz.PROJECT_SPEC_FIELDS) {
            headers.add(row[0]);
        }
        headers.add("录入时间");
        return headers;
    }

    private static List<String> EXPORT_FIELDS() {
        List<String> fields = new ArrayList<>(List.of("project_name", "supplier", "category", "flow", "source"));
        fields.addAll(Biz.fieldNames(Biz.PROJECT_SPEC_FIELDS));
        fields.add("created_at");
        return fields;
    }

    @GetMapping("/projects/export")
    @RequirePerm("action:export")
    public ResponseEntity<byte[]> export(@RequestParam(required = false) String keyword) {
        ScopeBuilder.Scope scope = ScopeBuilder.build("category", "supplier", true);
        List<String> cond = new ArrayList<>();
        List<Object> params = new ArrayList<>();
        if (keyword != null && !keyword.trim().isEmpty()) {
            String k = Sql.like(keyword);
            cond.add("(project_name LIKE ? OR supplier LIKE ? OR flow LIKE ?)");
            params.addAll(List.of(k, k, k));
        }
        if (!scope.where.isEmpty()) {
            cond.add(scope.where.substring(5));
        }
        params.addAll(scope.params);
        String where = cond.isEmpty() ? "" : " WHERE " + String.join(" AND ", cond);
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT *, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at FROM projects"
                        + where + " ORDER BY id DESC", params.toArray());
        byte[] bytes = ExcelWriter.buildXlsx("BOM信息", EXPORT_HEADERS, rows, EXPORT_FIELDS());
        return ResponseEntity.ok()
                .header(org.springframework.http.HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"projects_" + Sql.today() + ".xlsx\"")
                .contentType(org.springframework.http.MediaType.parseMediaType(
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
                .body(bytes);
    }

    // ---------- 看板统计 ----------

    @GetMapping("/projects/stats")
    public Map<String, Object> stats() {
        ScopeBuilder.Scope scope = ScopeBuilder.build("category", "supplier", true);
        String where = " WHERE 1=1" + scope.where;
        Object[] args = scope.params.toArray();
        Long total = jdbc.queryForObject("SELECT COUNT(*) FROM projects" + where, Long.class, args);
        List<String> suppliers = strings(jdbc.queryForList(
                "SELECT DISTINCT supplier FROM projects WHERE supplier != ''" + scope.where
                        + " ORDER BY supplier", args));
        List<String> categories = strings(jdbc.queryForList(
                "SELECT DISTINCT category FROM projects WHERE category != ''" + scope.where
                        + " ORDER BY category", args));
        List<Map<String, Object>> recent = jdbc.queryForList(
                "SELECT * FROM projects" + where + " ORDER BY id DESC LIMIT 10", args);
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("total", total == null ? 0 : total);
        resp.put("suppliers", suppliers);
        resp.put("categories", categories);
        resp.put("recent", recent);
        return resp;
    }

    private List<String> strings(List<Map<String, Object>> rows) {
        List<String> out = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            out.add(Sql.s(r.values().iterator().next()));
        }
        return out;
    }

    private Object[] addParams(List<Object> params, Object... extra) {
        List<Object> all = new ArrayList<>(params);
        all.addAll(List.of(extra));
        return all.toArray();
    }
}
