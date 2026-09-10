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
 * 供应商模块（含扩展档案、导入导出、统计、专属审核/物料管理接口）。
 */
@RestController
@RequestMapping("/api")
public class SuppliersController {

    private final JdbcTemplate jdbc;

    public SuppliersController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** 供应商全部可写字段（基础 9 项 + 扩展档案）。 */
    private static List<String> writeFields() {
        List<String> fields = new ArrayList<>(List.of(
                "name", "contact", "phone", "email", "address", "category",
                "rating", "status", "remark"));
        fields.addAll(Biz.fieldNames(Biz.SUPPLIER_FIELDS));
        return fields;
    }

    private Map<String, String> pickSupplier(Map<String, Object> body, boolean partial) {
        Map<String, String> out = Biz.pick(body == null ? Map.of() : body, writeFields());
        if (!partial && Sql.s(out.get("name")).isEmpty()) {
            throw ApiException.badRequest("供应商名称不能为空");
        }
        if (out.containsKey("status") && !Biz.SUPPLIER_STATUSES.contains(out.get("status"))) {
            out.put("status", "合作中");
        }
        return out;
    }

    // ---------- 列表（整表，前端本地分页） ----------

    @GetMapping("/suppliers")
    public Map<String, Object> list(@RequestParam(required = false) String keyword,
                                    @RequestParam(required = false) String materialType) {
        ScopeBuilder.Scope scope = ScopeBuilder.build("material_type", "name", true);
        List<String> cond = new ArrayList<>();
        List<Object> params = new ArrayList<>();
        if (keyword != null && !keyword.trim().isEmpty()) {
            String k = Sql.like(keyword);
            cond.add("(name LIKE ? OR contact LIKE ? OR phone LIKE ? OR email LIKE ? "
                    + "OR material_type LIKE ?)");
            params.addAll(List.of(k, k, k, k, k));
        }
        if (materialType != null && !materialType.isEmpty()) {
            cond.add("material_type = ?");
            params.add(materialType);
        }
        if (!scope.where.isEmpty()) {
            cond.add(scope.where.substring(5));
        }
        params.addAll(scope.params);
        String where = cond.isEmpty() ? "" : " WHERE " + String.join(" AND ", cond);
        // 供应商整表查询，前端本地分页；服务端限制 500 行（与 Node 版一致）
        List<Map<String, Object>> items = jdbc.queryForList(
                "SELECT * FROM suppliers" + where + " ORDER BY id ASC LIMIT 500", params.toArray());
        return Map.of("total", (long) items.size(), "items", items);
    }

    // ---------- 新增 / 更新 / 删除 ----------

    @PostMapping("/suppliers")
    @RequirePerm("action:create")
    @Transactional
    public Map<String, Object> create(@RequestBody(required = false) Map<String, Object> body) {
        Map<String, String> data = pickSupplier(body, false);
        data.put("created_at", Sql.now());
        data.put("updated_at", Sql.now());
        long id = insert(data);
        return jdbc.queryForMap("SELECT * FROM suppliers WHERE id = ?", id);
    }

    private long insert(Map<String, String> data) {
        String keys = String.join(",", data.keySet());
        String marks = String.join(",", java.util.Collections.nCopies(data.size(), "?"));
        jdbc.update("INSERT INTO suppliers (" + keys + ") VALUES (" + marks + ")",
                data.values().toArray());
        Long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        return id == null ? 0 : id;
    }

    @PutMapping("/suppliers/{id}")
    @RequirePerm("action:edit")
    public Map<String, Object> update(@PathVariable long id,
                                      @RequestBody(required = false) Map<String, Object> body) {
        List<Map<String, Object>> exists = jdbc.queryForList("SELECT id FROM suppliers WHERE id = ?", id);
        if (exists.isEmpty()) {
            throw ApiException.notFound("供应商不存在");
        }
        Map<String, String> data = pickSupplier(body, true);
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
        jdbc.update("UPDATE suppliers SET " + String.join(",", sets) + " WHERE id = ?", params.toArray());
        return jdbc.queryForMap("SELECT * FROM suppliers WHERE id = ?", id);
    }

    @DeleteMapping("/suppliers/{id}")
    @RequirePerm("action:delete")
    public Map<String, Object> delete(@PathVariable long id) {
        int n = jdbc.update("DELETE FROM suppliers WHERE id = ?", id);
        if (n == 0) {
            throw ApiException.notFound("供应商不存在");
        }
        return Map.of("ok", true);
    }

    // ---------- 统计 ----------

    @GetMapping("/suppliers/stats")
    public Map<String, Object> stats() {
        ScopeBuilder.Scope scope = ScopeBuilder.build("material_type", "name", true);
        String where = " WHERE 1=1" + scope.where;
        Object[] args = scope.params.toArray();
        Long total = jdbc.queryForObject("SELECT COUNT(*) FROM suppliers" + where, Long.class, args);
        List<Map<String, Object>> byStatus = jdbc.queryForList(
                "SELECT status AS name, COUNT(*) AS value FROM suppliers" + where
                        + " GROUP BY status ORDER BY value DESC", args);
        List<Map<String, Object>> byRating = jdbc.queryForList(
                "SELECT rating AS name, COUNT(*) AS value FROM suppliers" + where
                        + " GROUP BY rating ORDER BY rating ASC", args);
        List<Map<String, Object>> byCategory = jdbc.queryForList(
                "SELECT material_type AS name, COUNT(*) AS value FROM suppliers WHERE material_type != ''"
                        + scope.where + " GROUP BY material_type ORDER BY value DESC", args);
        // 供应商对应物料数量排行（按物料自身的品类/供应商范围过滤）
        ScopeBuilder.Scope mscope = ScopeBuilder.build("category", "supplier", true);
        List<Map<String, Object>> materialCounts = jdbc.queryForList(
                "SELECT supplier AS name, COUNT(*) AS value FROM materials WHERE supplier != ''"
                        + mscope.where + " GROUP BY supplier ORDER BY value DESC LIMIT 10",
                mscope.params.toArray());
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("total", total == null ? 0 : total);
        resp.put("byStatus", byStatus);
        resp.put("byRating", byRating);
        resp.put("byCategory", byCategory);
        resp.put("materialCounts", materialCounts);
        return resp;
    }

    // ---------- 批量导入 / 导出 ----------

    @PostMapping("/suppliers/batch")
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
            Map<String, Object> rowBody = new LinkedHashMap<>();
            if (o instanceof Map<?, ?> m) {
                for (Map.Entry<?, ?> e : m.entrySet()) {
                    rowBody.put(String.valueOf(e.getKey()), e.getValue());
                }
            }
            try {
                Map<String, String> data = pickSupplier(rowBody, false);
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

    private static final List<String> EXPORT_HEADERS = buildExportHeaders();

    private static List<String> buildExportHeaders() {
        List<String> headers = new ArrayList<>(List.of(
                "供应商名称", "联系人", "联系电话", "邮箱", "地址", "供应商类别",
                "评级", "状态", "备注"));
        for (String[] row : Biz.SUPPLIER_FIELDS) {
            headers.add(row[0]);
        }
        return headers;
    }

    private static final List<String> EXPORT_FIELDS = writeFields();

    @GetMapping("/suppliers/export")
    @RequirePerm("action:export")
    public ResponseEntity<byte[]> export() {
        ScopeBuilder.Scope scope = ScopeBuilder.build("material_type", "name", true);
        String where = " WHERE 1=1" + scope.where;
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT * FROM suppliers" + where + " ORDER BY id", scope.params.toArray());
        byte[] bytes = ExcelWriter.buildXlsx("供应商", EXPORT_HEADERS, rows, EXPORT_FIELDS);
        return ResponseEntity.ok()
                .header(org.springframework.http.HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"suppliers_" + Sql.today() + ".xlsx\"")
                .contentType(org.springframework.http.MediaType.parseMediaType(
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
                .body(bytes);
    }

    // ---------- 供应商专属子资源（审核记录/物料/评价） ----------

    @GetMapping("/suppliers/{id}")
    @RequirePerm("action:edit")
    public Map<String, Object> detail(@PathVariable long id) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT * FROM suppliers WHERE id = ?", id);
        if (rows.isEmpty()) {
            throw ApiException.notFound("供应商不存在");
        }
        return rows.get(0);
    }

    /** 新增/更新审核记录。 */
    @PostMapping("/suppliers/{id}/audit")
    @RequirePerm("action:create")
    public Map<String, Object> audit(@PathVariable long id,
                                     @RequestBody(required = false) Map<String, Object> body) {
        List<Map<String, Object>> sRows = jdbc.queryForList("SELECT * FROM suppliers WHERE id = ?", id);
        if (sRows.isEmpty()) {
            throw ApiException.notFound("供应商不存在");
        }
        Map<String, Object> supplier = sRows.get(0);
        Map<String, Object> b = body == null ? Map.of() : body;
        String result = Sql.s(b.get("result"));
        String auditDate = Sql.s(b.get("audit_date"));
        jdbc.update("UPDATE suppliers SET "
                        + "audit_date = ?, audit_members = ?, audit_result = ?, "
                        + "audit_address = ?, audit_time = ?, audit_record = ?, "
                        + "qsa = ?, qpa = ?, updated_at = ? WHERE id = ?",
                Sql.s(b.get("audit_date")), Sql.s(b.get("audit_members")), result,
                Sql.s(b.get("audit_address")), auditDate, Sql.s(b.get("audit_record")),
                Sql.s(b.get("qsa")), Sql.s(b.get("qpa")), Sql.now(), id);
        // 追加一条稽核记录
        jdbc.update("INSERT INTO audits (supplier, audit_date, auditor, material_type, scope, result, score, summary, action, created_at, updated_at) "
                        + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                supplier.get("name"), auditDate, Sql.s(b.get("audit_members")),
                supplier.get("material_type"), Sql.s(b.get("audit_record")), result,
                Sql.s(b.get("qsa")), Sql.s(b.get("scope")), Sql.s(b.get("action")),
                Sql.now(), Sql.now());
        return Map.of("ok", true);
    }

    /** 新增物料。 */
    @PostMapping("/suppliers/{id}/materials")
    @RequirePerm("action:create")
    @Transactional
    public Map<String, Object> addMaterial(@PathVariable long id,
                                           @RequestBody(required = false) Map<String, Object> body) {
        List<Map<String, Object>> sRows = jdbc.queryForList("SELECT * FROM suppliers WHERE id = ?", id);
        if (sRows.isEmpty()) {
            throw ApiException.notFound("供应商不存在");
        }
        Map<String, Object> supplier = sRows.get(0);
        String name = Sql.s(body == null ? null : body.get("name"));
        if (name.isEmpty()) {
            throw ApiException.badRequest("物料名称不能为空");
        }
        Map<String, String> data = new LinkedHashMap<>();
        data.put("name", name);
        data.put("model", Sql.or(body == null ? null : body.get("model"), ""));
        data.put("supplier", String.valueOf(supplier.get("name")));
        data.put("manufacturer", Sql.or(body == null ? null : body.get("manufacturer"),
                String.valueOf(supplier.get("name"))));
        data.put("category", Sql.or(body == null ? null : body.get("category"),
                String.valueOf(supplier.get("material_type"))));
        data.put("code", "");
        data.put("status", "黄区");
        data.put("cert_expire_date", Sql.or(body == null ? null : body.get("cert_expire_date"), ""));
        data.put("rohs", "待补");
        data.put("reach", "待补");
        data.put("msds", "待补");
        data.put("datasheet", "待补");
        data.put("applied_by", "供应商档案导入");
        data.put("applied_at", Sql.today());
        data.put("remark", Sql.or(body == null ? null : body.get("remark"), ""));
        data.put("created_at", Sql.now());
        data.put("updated_at", Sql.now());
        long newId = insertMaterial(data);
        return jdbc.queryForMap("SELECT * FROM materials WHERE id = ?", newId);
    }

    private long insertMaterial(Map<String, String> data) {
        String keys = String.join(",", data.keySet());
        String marks = String.join(",", java.util.Collections.nCopies(data.size(), "?"));
        jdbc.update("INSERT INTO materials (" + keys + ") VALUES (" + marks + ")",
                data.values().toArray());
        Long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        return id == null ? 0 : id;
    }

    @PostMapping("/suppliers/{id}/review")
    @RequirePerm("action:edit")
    public Map<String, Object> review(@PathVariable long id,
                                      @RequestBody(required = false) Map<String, Object> body) {
        List<Map<String, Object>> exists = jdbc.queryForList("SELECT id FROM suppliers WHERE id = ?", id);
        if (exists.isEmpty()) {
            throw ApiException.notFound("供应商不存在");
        }
        Map<String, Object> b = body == null ? Map.of() : body;
        String rating = Sql.s(b.get("rating"));
        if (!Biz.SUPPLIER_RATINGS.contains(rating)) {
            throw ApiException.badRequest("评级取值不正确");
        }
        jdbc.update("UPDATE suppliers SET rating = ?, updated_at = ? WHERE id = ?", rating, Sql.now(), id);
        return Map.of("ok", true);
    }

    @PostMapping("/suppliers/{id}/deleteMaterials")
    @RequirePerm("action:delete")
    public Map<String, Object> deleteMaterials(@PathVariable long id,
                                               @RequestBody(required = false) Map<String, Object> body) {
        List<Map<String, Object>> exists = jdbc.queryForList("SELECT id FROM suppliers WHERE id = ?", id);
        if (exists.isEmpty()) {
            throw ApiException.notFound("供应商不存在");
        }
        List<Object> ids = body == null ? List.of() : intList(body.get("ids"));
        if (ids.isEmpty()) {
            throw ApiException.badRequest("请指定要删除的物料");
        }
        int n = 0;
        for (Object o : ids) {
            long mid = Sql.longVal(o, 0);
            if (mid > 0) {
                n += jdbc.update("DELETE FROM materials WHERE id = ?", mid);
            }
        }
        return Map.of("ok", true, "deleted", n);
    }

    private List<Object> intList(Object raw) {
        List<Object> out = new ArrayList<>();
        if (raw instanceof List<?> list) {
            out.addAll(list);
        }
        return out;
    }
}
