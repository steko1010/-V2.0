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
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
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
 * 物料汇总（与 Node server.js 物料模块一一对应）：
 * 列表 / 新增 / 批量导入 / 导出 / 更新 / 删除 / 选型查重。
 */
@RestController
@RequestMapping("/api")
public class MaterialsController {

    private static final List<String> MATERIAL_ALLOWED = List.of(
            "code", "name", "model", "category", "supplier", "manufacturer",
            "unit", "status", "cert_expire_date", "rohs", "reach", "msds",
            "datasheet", "applied_by", "applied_at", "remark");

    private static final List<String> EXPORT_HEADERS = List.of(
            "编码", "物料名称", "型号规格", "分类", "供应商", "制造商", "认证状态",
            "认证到期", "ROHS", "REACH", "申请人");
    private static final List<String> EXPORT_FIELDS = List.of(
            "code", "name", "model", "category", "supplier", "manufacturer", "status",
            "cert_expire_date", "rohs", "reach", "applied_by");

    private final JdbcTemplate jdbc;

    public MaterialsController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ---------- 校验 ----------

    /** 过滤合法字段并校验枚举（等价 pickMaterial）。 */
    private Map<String, String> pickMaterial(Map<String, Object> body, boolean partial) {
        Map<String, String> out = Biz.pick(body, MATERIAL_ALLOWED);
        if (!partial && Sql.s(out.get("name")).isEmpty()) {
            throw ApiException.badRequest("物料名称不能为空");
        }
        if (out.containsKey("status") && !Biz.STATUSES.contains(out.get("status"))) {
            out.put("status", "黄区");
        }
        for (String d : Biz.DOCS) {
            if (out.containsKey(d) && !Biz.DOC_STATUSES.contains(out.get(d))) {
                out.put(d, "待补");
            }
        }
        return out;
    }

    /** 自动生成物料编码 M-年份-4位序号（等价 Node generateCode）。 */
    private synchronized String generateCode() {
        String prefix = "M-" + java.time.Year.now().getValue() + "-";
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT code FROM materials WHERE code LIKE ? ORDER BY code DESC LIMIT 1", prefix + "%");
        long next = 1;
        if (!rows.isEmpty() && rows.get(0).get("code") != null) {
            String c = String.valueOf(rows.get(0).get("code"));
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("(\\d+)$").matcher(c);
            if (m.find()) {
                next = Long.parseLong(m.group(1)) + 1;
            }
        }
        return prefix + String.format("%04d", next);
    }

    // ---------- 列表 ----------

    @GetMapping("/materials")
    public Map<String, Object> list(@RequestParam(required = false) String keyword,
                                    @RequestParam(required = false) String category,
                                    @RequestParam(required = false) String status,
                                    @RequestParam(required = false) String supplier,
                                    @RequestParam(defaultValue = "1") int page,
                                    @RequestParam(defaultValue = "20") int pageSize) {
        ScopeBuilder.Scope scope = ScopeBuilder.build("category", "supplier", true);
        List<String> cond = new ArrayList<>();
        List<Object> params = new ArrayList<>();
        if (keyword != null && !keyword.trim().isEmpty()) {
            String k = Sql.like(keyword);
            cond.add("(code LIKE ? OR name LIKE ? OR model LIKE ? OR supplier LIKE ? OR manufacturer LIKE ?)");
            params.add(k);
            params.add(k);
            params.add(k);
            params.add(k);
            params.add(k);
        }
        if (category != null && !category.isEmpty()) {
            cond.add("category = ?");
            params.add(category);
        }
        if (status != null && !status.isEmpty()) {
            cond.add("status = ?");
            params.add(status);
        }
        if (supplier != null && !supplier.isEmpty()) {
            cond.add("supplier = ?");
            params.add(supplier);
        }
        if (!scope.where.isEmpty()) {
            cond.add(scope.where.substring(5)); // 去掉 " AND "
        }
        params.addAll(scope.params);

        String whereSql = cond.isEmpty() ? "" : " WHERE " + String.join(" AND ", cond);
        int p = Math.max(1, page);
        int ps = Math.max(1, Math.min(100, pageSize));

        long total = queryCount("SELECT COUNT(*) FROM materials" + whereSql, params);
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT * FROM materials" + whereSql + " ORDER BY id ASC LIMIT ? OFFSET ?",
                append(params, ps, (p - 1) * ps));

        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("total", total);
        resp.put("page", p);
        resp.put("pageSize", ps);
        resp.put("items", rows);
        return resp;
    }

    private long queryCount(String sql, List<Object> params) {
        Long c = jdbc.queryForObject(sql, Long.class, params.toArray());
        return c == null ? 0 : c;
    }

    private Object[] append(List<Object> params, Object... extra) {
        List<Object> all = new ArrayList<>(params);
        all.addAll(List.of(extra));
        return all.toArray();
    }

    // ---------- 新增 ----------

    @PostMapping("/materials")
    @RequirePerm("action:create")
    @Transactional
    public Map<String, Object> create(@RequestBody(required = false) Map<String, Object> body) {
        Map<String, String> data = pickMaterial(body == null ? Map.of() : body, false);
        if (data.get("code") == null || data.get("code").isEmpty()) {
            data.put("code", generateCode());
        }
        String now = Sql.now();
        data.put("created_at", now);
        data.put("updated_at", now);
        try {
            long id = insertMaterial(data);
            return jdbc.queryForMap("SELECT * FROM materials WHERE id = ?", id);
        } catch (DuplicateKeyException e) {
            throw ApiException.conflict("物料编码已存在，请勿重复录入");
        }
    }

    private long insertMaterial(Map<String, String> data) {
        String keys = String.join(",", data.keySet());
        String marks = String.join(",", java.util.Collections.nCopies(data.size(), "?"));
        jdbc.update("INSERT INTO materials (" + keys + ") VALUES (" + marks + ")",
                data.values().toArray());
        return jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
    }

    // ---------- 批量导入 ----------

    @PostMapping("/materials/batch")
    @RequirePerm("action:import")
    @Transactional
    public Map<String, Object> batch(@RequestBody(required = false) Map<String, Object> payload) {
        List<Map<String, Object>> items = extractItems(payload);
        if (items.isEmpty()) {
            throw ApiException.badRequest("没有可导入的数据");
        }
        Map<String, Object> results = new LinkedHashMap<>();
        results.put("success", 0);
        results.put("skipped", new ArrayList<>());
        results.put("errors", new ArrayList<>());
        List<Object> errors = new ArrayList<>();
        String now = Sql.now();
        int success = 0;
        for (Map<String, Object> raw : items) {
            try {
                Map<String, String> data = pickMaterial(raw == null ? Map.of() : raw, false);
                if (data.get("code") == null || data.get("code").isEmpty()) {
                    data.put("code", generateCode());
                }
                data.put("created_at", now);
                data.put("updated_at", now);
                insertMaterial(data);
                success++;
            } catch (DuplicateKeyException e) {
                Map<String, Object> err = new LinkedHashMap<>();
                err.put("row", raw);
                err.put("message", "编码 " + String.valueOf(raw == null ? "" : raw.get("code")) + " 已存在");
                errors.add(err);
            } catch (ApiException e) {
                Map<String, Object> err = new LinkedHashMap<>();
                err.put("row", raw);
                err.put("message", e.getMessage());
                errors.add(err);
            } catch (Exception e) {
                Map<String, Object> err = new LinkedHashMap<>();
                err.put("row", raw);
                err.put("message", e.getMessage() == null ? "数据格式错误" : e.getMessage());
                errors.add(err);
            }
        }
        results.put("success", success);
        results.put("errors", errors);
        return results;
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> extractItems(Map<String, Object> payload) {
        if (payload == null) {
            return List.of();
        }
        Object raw = payload.get("items");
        if (raw instanceof List<?> list) {
            List<Map<String, Object>> items = new ArrayList<>();
            for (Object o : list) {
                if (o instanceof Map<?, ?> m) {
                    items.add((Map<String, Object>) m);
                }
            }
            return items;
        }
        return List.of();
    }

    // ---------- 导出 ----------

    @GetMapping("/materials/export")
    @RequirePerm("action:export")
    public ResponseEntity<byte[]> export(@RequestParam(required = false) String keyword,
                                         @RequestParam(required = false) String category,
                                         @RequestParam(required = false) String status,
                                         @RequestParam(required = false) String supplier) {
        ScopeBuilder.Scope scope = ScopeBuilder.build("category", "supplier", true);
        List<String> cond = new ArrayList<>();
        List<Object> params = new ArrayList<>();
        if (keyword != null && !keyword.trim().isEmpty()) {
            String k = Sql.like(keyword);
            cond.add("(code LIKE ? OR name LIKE ? OR model LIKE ? OR supplier LIKE ? OR manufacturer LIKE ?)");
            params.addAll(List.of(k, k, k, k, k));
        }
        if (category != null && !category.isEmpty()) {
            cond.add("category = ?");
            params.add(category);
        }
        if (status != null && !status.isEmpty()) {
            cond.add("status = ?");
            params.add(status);
        }
        if (supplier != null && !supplier.isEmpty()) {
            cond.add("supplier = ?");
            params.add(supplier);
        }
        if (!scope.where.isEmpty()) {
            cond.add(scope.where.substring(5));
        }
        params.addAll(scope.params);
        String whereSql = cond.isEmpty() ? "" : " WHERE " + String.join(" AND ", cond);
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT * FROM materials" + whereSql + " ORDER BY id ASC", params.toArray());
        byte[] bytes = ExcelWriter.buildXlsx("物料台账", EXPORT_HEADERS, rows, EXPORT_FIELDS);
        return excelResponse(bytes, "materials_" + Sql.today() + ".xlsx");
    }

    protected ResponseEntity<byte[]> excelResponse(byte[] bytes, String fileName) {
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + fileName + "\"")
                .contentType(MediaType.parseMediaType(
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
                .body(bytes);
    }

    // ---------- 更新 / 删除 ----------

    @PutMapping("/materials/{id}")
    @RequirePerm("action:edit")
    public Map<String, Object> update(@PathVariable long id,
                                      @RequestBody(required = false) Map<String, Object> body) {
        List<Map<String, Object>> exists = jdbc.queryForList(
                "SELECT id FROM materials WHERE id = ?", id);
        if (exists.isEmpty()) {
            throw ApiException.notFound("物料不存在");
        }
        Map<String, String> data = pickMaterial(body == null ? Map.of() : body, true);
        data.put("updated_at", Sql.now());
        List<String> keys = new ArrayList<>(data.keySet());
        if (keys.size() <= 1) {
            throw ApiException.badRequest("没有可更新的字段");
        }
        List<Object> params = new ArrayList<>(data.values());
        params.add(id);
        try {
            jdbc.update("UPDATE materials SET " + joinSet(keys) + " WHERE id = ?", params.toArray());
        } catch (DuplicateKeyException e) {
            throw ApiException.conflict("物料编码已存在，请勿重复录入");
        }
        return jdbc.queryForMap("SELECT * FROM materials WHERE id = ?", id);
    }

    private String joinSet(List<String> keys) {
        List<String> set = new ArrayList<>();
        for (String k : keys) {
            set.add(k + " = ?");
        }
        return String.join(",", set);
    }

    @DeleteMapping("/materials/{id}")
    @RequirePerm("action:delete")
    public Map<String, Object> delete(@PathVariable long id) {
        int n = jdbc.update("DELETE FROM materials WHERE id = ?", id);
        if (n == 0) {
            throw ApiException.notFound("物料不存在");
        }
        return Map.of("ok", true);
    }

    // ---------- 选型查重 ----------

    @PostMapping("/check")
    @RequirePerm("action:create")
    public Map<String, Object> check(@RequestBody(required = false) Map<String, Object> body) {
        Map<String, Object> b = body == null ? Map.of() : body;
        String name = Sql.s(b.get("name"));
        String model = Sql.s(b.get("model"));
        String supplier = Sql.s(b.get("supplier"));
        String manufacturer = Sql.s(b.get("manufacturer"));
        String code = Sql.s(b.get("code"));

        if (name.isEmpty() && model.isEmpty() && code.isEmpty()) {
            throw ApiException.badRequest("请至少输入物料名称、型号或编码之一");
        }
        // 1) 精确匹配
        List<String> cond = new ArrayList<>();
        List<Object> params = new ArrayList<>();
        if (!name.isEmpty()) {
            cond.add("name = ?");
            params.add(name);
        }
        if (!model.isEmpty()) {
            cond.add("model = ?");
            params.add(model);
        }
        if (!supplier.isEmpty()) {
            cond.add("supplier = ?");
            params.add(supplier);
        }
        if (!code.isEmpty()) {
            cond.add("code = ?");
            params.add(code);
        }
        List<Map<String, Object>> exact = jdbc.queryForList(
                "SELECT * FROM materials WHERE " + String.join(" OR ", cond)
                        + " ORDER BY id DESC LIMIT 50", params.toArray());

        // 2) 模糊匹配：名称/型号互相包含 + 剥离类别后缀提取核心词
        List<Map<String, Object>> fuzzy = new ArrayList<>();
        java.util.Set<Long> seen = new java.util.HashSet<>();
        for (Map<String, Object> row : exact) {
            seen.add(((Number) row.get("id")).longValue());
        }
        if (!name.isEmpty() || !model.isEmpty()) {
            List<String> terms = new ArrayList<>();
            addTerm(terms, name);
            addTerm(terms, Biz.stripSuffix(name));
            addTerm(terms, model);
            if (!terms.isEmpty()) {
                List<String> likes = new ArrayList<>();
                List<Object> lp = new ArrayList<>();
                for (String t : terms) {
                    likes.add("(name LIKE ? OR model LIKE ? OR code LIKE ?)");
                    String k = "%" + t + "%";
                    lp.add(k);
                    lp.add(k);
                    lp.add(k);
                }
                List<Map<String, Object>> rows = jdbc.queryForList(
                        "SELECT * FROM materials WHERE " + String.join(" OR ", likes)
                                + " ORDER BY id DESC LIMIT 50", lp.toArray());
                for (Map<String, Object> row : rows) {
                    long rid = ((Number) row.get("id")).longValue();
                    if (!seen.contains(rid)) {
                        fuzzy.add(row);
                        seen.add(rid);
                    }
                }
            }
        }
        boolean inLibrary = !exact.isEmpty();
        String tip;
        if (inLibrary) {
            tip = "该物料可能已在物料库中，请核实后再立项，避免重复开发。";
        } else if (!fuzzy.isEmpty()) {
            tip = "库中暂未找到完全一致的物料，但存在相似物料，建议先核对。";
        } else {
            tip = "库中未找到该物料，可以新增立项。";
        }
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("inLibrary", inLibrary);
        resp.put("tip", tip);
        resp.put("exact", exact);
        resp.put("fuzzy", fuzzy);
        return resp;
    }

    private void addTerm(List<String> terms, String t) {
        String s = t.trim();
        if (s.length() >= 2 && !terms.contains(s)) {
            terms.add(s);
        }
    }

    // ---------- 动态新增品类（下拉可动态添加，兼容旧接口） ----------

    @PostMapping("/categories")
    @RequirePerm("action:create")
    public Map<String, Object> addCategory(@RequestBody(required = false) Map<String, Object> body) {
        String name = Sql.s(body == null ? null : body.get("name"));
        if (name.isEmpty()) {
            throw ApiException.badRequest("品类名称不能为空");
        }
        jdbc.update("INSERT IGNORE INTO categories (name, created_at) VALUES (?, ?)", name, Sql.now());
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("ok", true);
        resp.put("name", name);
        return resp;
    }
}
