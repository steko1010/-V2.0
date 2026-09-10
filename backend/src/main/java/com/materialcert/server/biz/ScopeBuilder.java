package com.materialcert.server.biz;

import com.materialcert.server.auth.AuthContext;
import com.materialcert.server.common.Sql;
import java.util.ArrayList;
import java.util.List;

/**
 * 第三层：数据范围过滤。等价 Node scopeWhere，参数化构建：
 * - 超管不过滤；
 * - 品类：有授权列表时 `(cat IN (...) OR cat='' OR cat IS NULL)`；allowAllWhenEmpty=false 且空列表时 1=0；
 * - 供应商：有授权列表时 `sup IN (...)`；allowAllWhenEmpty=false 且空列表时 1=0；
 * 本项目所有调用点均 allowAllWhenEmpty=true（即无供应商授权=不限制供应商维度）。
 */
public final class ScopeBuilder {

    public static final class Scope {
        /** 拼接后的条件（无 where 关键字），可能为空串。 */
        public final String where;
        public final List<Object> params;

        Scope(String where, List<Object> params) {
            this.where = where;
            this.params = params;
        }
    }

    private ScopeBuilder() {
    }

    public static Scope build(String categoryField, String supplierField, boolean allowAllWhenEmpty) {
        boolean superUser = Boolean.TRUE.equals(AuthContext.user().get("isSuper"));
        if (superUser) {
            return new Scope("", List.of());
        }
        List<String> cats = AuthContext.categoriesScope();
        List<String> sups = AuthContext.suppliersScope();
        List<String> parts = new ArrayList<>();
        List<Object> params = new ArrayList<>();

        if (categoryField != null && !categoryField.isBlank()) {
            if (!cats.isEmpty()) {
                parts.add("(" + categoryField + " IN (" + Sql.inPlaceholders(cats.size())
                        + ") OR " + categoryField + " = '' OR " + categoryField + " IS NULL)");
                params.addAll(cats);
            } else if (!allowAllWhenEmpty) {
                parts.add("1=0");
            }
        }
        if (supplierField != null && !supplierField.isBlank()) {
            if (!sups.isEmpty()) {
                parts.add("(" + supplierField + " IN (" + Sql.inPlaceholders(sups.size()) + "))");
                params.addAll(sups);
            } else if (!allowAllWhenEmpty) {
                parts.add("1=0");
            }
        }
        String where = parts.isEmpty() ? "" : " AND " + String.join(" AND ", parts);
        return new Scope(where, params);
    }
}
