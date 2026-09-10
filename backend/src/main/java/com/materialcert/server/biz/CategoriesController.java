package com.materialcert.server.biz;

import com.materialcert.server.auth.RequirePerm;
import com.materialcert.server.common.ApiException;
import com.materialcert.server.common.Sql;
import com.materialcert.server.excel.ExcelWriter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.dao.DuplicateKeyException;
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
 * 品类管理（material_categories 三级树），管理员专属模块。
 * 列表、动态分类树、增删改、Excel 导入导出均在此。
 */
@RestController
@RequestMapping("/api")
public class CategoriesController {

    private static final List<String> HEADERS = List.of("大分类", "中分类", "小分类");
    private static final List<String> FIELDS = List.of("big", "mid", "small");

    private final JdbcTemplate jdbc;

    public CategoriesController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private Map<String, String> pickCategory(Map<String, Object> b) {
        Map<String, String> out = new LinkedHashMap<>();
        String big = Sql.s(b.get("big"));
        String mid = Sql.s(b.get("mid"));
        String small = Sql.s(b.get("small"));
        if (big.isEmpty() && mid.isEmpty() && small.isEmpty()) {
            throw ApiException.badRequest("请至少填写一个大/中/小分类名称");
        }
        out.put("big", big);
        out.put("mid", mid);
        out.put("small", small);
        return out;
    }

    @GetMapping("/material-categories")
    @RequirePerm("page:categories")
    public Map<String, Object> list(@RequestParam(defaultValue = "1") int page,
                                    @RequestParam(defaultValue = "20") int pageSize,
                                    @RequestParam(required = false) String keyword) {
        List<String> cond = new ArrayList<>();
        List<Object> params = new ArrayList<>();
        if (keyword != null && !keyword.trim().isEmpty()) {
            String k = Sql.like(keyword);
            cond.add("(big LIKE ? OR mid LIKE ? OR small LIKE ?)");
            params.addAll(List.of(k, k, k));
        }
        String where = cond.isEmpty() ? "" : " WHERE " + String.join(" AND ", cond);
        Long total = jdbc.queryForObject("SELECT COUNT(*) FROM material_categories" + where, Long.class, params.toArray());
        int p = Math.max(1, page);
        int ps = Math.max(1, Math.min(100, pageSize));
        List<Map<String, Object>> items = jdbc.queryForList(
                "SELECT id, big, mid, small, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at "
                        + "FROM material_categories" + where + " ORDER BY big, mid, small, id ASC LIMIT ? OFFSET ?",
                addParams(params, ps, (p - 1) * ps));
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("total", total == null ? 0 : total);
        resp.put("page", p);
        resp.put("pageSize", ps);
        resp.put("pages", total == null || ps == 0 ? 0 : (int) Math.ceil((double) total / ps));
        resp.put("items", items);
        return resp;
    }

    /** 全量分类树：大分类 -> 中分类 -> 小分类。 */
    @GetMapping("/categories/tree")
    @RequirePerm("page:categories")
    public Map<String, Object> tree() {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT big, mid, small FROM material_categories ORDER BY big, mid, small");
        List<Map<String, Object>> tree = new ArrayList<>();
        Map<String, Map<String, Object>> bigMap = new LinkedHashMap<>();
        for (Map<String, Object> r : rows) {
            String big = Sql.s(r.get("big"));
            String mid = Sql.s(r.get("mid"));
            String small = Sql.s(r.get("small"));
            Map<String, Object> bigNode = bigMap.get(big);
            if (bigNode == null) {
                bigNode = new LinkedHashMap<>();
                bigNode.put("name", big);
                bigNode.put("children", new ArrayList<>());
                bigMap.put(big, bigNode);
                tree.add(bigNode);
            }
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> bigChildren = (List<Map<String, Object>>) bigNode.get("children");
            if (mid.isEmpty()) {
                continue;
            }
            Map<String, Object> midNode = null;
            for (Map<String, Object> m : bigChildren) {
                if (mid.equals(m.get("name"))) {
                    midNode = m;
                    break;
                }
            }
            if (midNode == null) {
                midNode = new LinkedHashMap<>();
                midNode.put("name", mid);
                midNode.put("children", new ArrayList<>());
                bigChildren.add(midNode);
            }
            if (!small.isEmpty()) {
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> midChildren = (List<Map<String, Object>>) midNode.get("children");
                midChildren.add(Map.of("name", small));
            }
        }
        return Map.of("items", tree);
    }

    @PostMapping("/material-categories")
    @RequirePerm(categoryAction = true, value = "action:create")
    @Transactional
    public Map<String, Object> create(@RequestBody(required = false) Map<String, Object> body) {
        Map<String, String> data = pickCategory(body == null ? Map.of() : body);
        if (isDup(data, 0)) {
            throw ApiException.conflict("该品类已存在");
        }
        jdbc.update("INSERT INTO material_categories (big, mid, small, created_at, updated_at) "
                + "VALUES (?, ?, ?, ?, ?)", data.get("big"), data.get("mid"), data.get("small"),
                Sql.now(), Sql.now());
        return Map.of("ok", true, "id", lastId(), "big", data.get("big"),
                "mid", data.get("mid"), "small", data.get("small"));
    }

    @PutMapping("/material-categories/{id}")
    @RequirePerm(categoryAction = true, value = "action:edit")
    public Map<String, Object> update(@PathVariable long id,
                                      @RequestBody(required = false) Map<String, Object> body) {
        Map<String, String> data = pickCategory(body == null ? Map.of() : body);
        List<Map<String, Object>> exists = jdbc.queryForList(
                "SELECT id FROM material_categories WHERE id = ?", id);
        if (exists.isEmpty()) {
            throw ApiException.notFound("品类不存在");
        }
        if (isDup(data, id)) {
            throw ApiException.conflict("该品类已存在");
        }
        jdbc.update("UPDATE material_categories SET big = ?, mid = ?, small = ?, updated_at = ? WHERE id = ?",
                data.get("big"), data.get("mid"), data.get("small"), Sql.now(), id);
        return Map.of("ok", true);
    }

    /** 是否已存在相同的大/中/小分类（更新时排除自身）。 */
    private boolean isDup(Map<String, String> data, long excludeId) {
        String sql = "SELECT id FROM material_categories WHERE big = ? AND mid = ? AND small = ?";
        List<Object> params = new ArrayList<>(
                List.of(data.get("big"), data.get("mid"), data.get("small")));
        if (excludeId > 0) {
            sql += " AND id != ?";
            params.add(excludeId);
        }
        sql += " LIMIT 1";
        return !jdbc.queryForList(sql, params.toArray()).isEmpty();
    }

    @DeleteMapping("/material-categories/{id}")
    @RequirePerm(categoryAction = true, value = "action:delete")
    public Map<String, Object> delete(@PathVariable long id) {
        int n = jdbc.update("DELETE FROM material_categories WHERE id = ?", id);
        if (n == 0) {
            throw ApiException.notFound("品类不存在");
        }
        return Map.of("ok", true);
    }

    /** 批量删除（多选删除 / 接口兜底）。 */
    @DeleteMapping("/material-categories/batch")
    @RequirePerm(categoryAction = true, value = "action:delete")
    public Map<String, Object> batchDelete(@RequestBody(required = false) Map<String, Object> body) {
        Object raw = body == null ? null : body.get("ids");
        int deleted = 0;
        if (raw instanceof List<?> ids) {
            for (Object o : ids) {
                long cid = Sql.longVal(o, 0);
                if (cid > 0) {
                    deleted += jdbc.update("DELETE FROM material_categories WHERE id = ?", cid);
                }
            }
        }
        return Map.of("ok", true, "deleted", deleted);
    }

    @PostMapping("/material-categories/batch")
    @RequirePerm(categoryAction = true, value = "action:import")
    public Map<String, Object> batch(@RequestBody(required = false) Map<String, Object> payload) {
        Object rawItems = payload == null ? null : payload.get("items");
        if (!(rawItems instanceof List<?> items) || items.isEmpty()) {
            throw ApiException.badRequest("没有可导入的数据");
        }
        int success = 0;
        List<Map<String, Object>> errors = new ArrayList<>();
        for (Object o : items) {
            if (!(o instanceof Map<?, ?> m)) {
                continue;
            }
            Map<String, Object> body = new LinkedHashMap<>();
            for (Map.Entry<?, ?> e : m.entrySet()) {
                body.put(String.valueOf(e.getKey()), e.getValue());
            }
            try {
                Map<String, String> data = pickCategory(body);
                if (isDup(data, 0)) {
                    throw ApiException.conflict("该品类已存在");
                }
                String now = Sql.now();
                jdbc.update("INSERT INTO material_categories (big, mid, small, created_at, updated_at) "
                        + "VALUES (?, ?, ?, ?, ?)", data.get("big"), data.get("mid"), data.get("small"), now, now);
                success++;
            } catch (DuplicateKeyException | ApiException e) {
                Map<String, Object> err = new LinkedHashMap<>();
                err.put("row", m);
                err.put("message", e instanceof ApiException ae ? ae.getMessage() : "该品类已存在");
                errors.add(err);
            }
        }
        return Map.of("success", success, "errors", errors);
    }

    @GetMapping("/material-categories/export")
    @RequirePerm(categoryAction = true, value = "action:export")
    public ResponseEntity<byte[]> export() {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT big, mid, small FROM material_categories ORDER BY big, mid, small");
        byte[] bytes = ExcelWriter.buildXlsx("品类", HEADERS, rows, FIELDS);
        return ResponseEntity.ok()
                .header(org.springframework.http.HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"categories_" + Sql.today() + ".xlsx\"")
                .contentType(org.springframework.http.MediaType.parseMediaType(
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
                .body(bytes);
    }

    private long lastId() {
        Long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        return id == null ? 0 : id;
    }

    private Object[] addParams(List<Object> params, Object... extra) {
        List<Object> all = new ArrayList<>(params);
        all.addAll(List.of(extra));
        return all.toArray();
    }
}
