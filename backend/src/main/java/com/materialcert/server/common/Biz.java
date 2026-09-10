package com.materialcert.server.common;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 业务常量：认证状态/资料枚举、字段白名单（中文列名, 数据库字段）、
 * 权限清单与种子数据，全部由 Node 版 db.js / server.js 迁移而来。
 */
public final class Biz {

    private Biz() {
    }

    /** 认证状态（三区）。 */
    public static final List<String> STATUSES = List.of("绿区", "黄区", "红区");

    /** 资料项。 */
    public static final List<String> DOCS = List.of("rohs", "reach", "msds", "datasheet");

    public static final Map<String, String> DOC_LABELS = Map.of(
            "rohs", "ROHS", "reach", "REACH", "msds", "MSDS", "datasheet", "规格书");

    /** 资料状态。 */
    public static final List<String> DOC_STATUSES = List.of("有", "无", "待补");

    /** 项目规格字段：中文列名 -> 数据库字段（按列表展示顺序）。 */
    public static final String[][] PROJECT_SPEC_FIELDS = {
            {"基线", "baseline"},
            {"量产封样时间", "mass_production_sample_date"},
            {"项目尺寸", "project_size"},
            {"MOD厂", "mod_factory"},
            {"MOD料号", "mod_part_no"},
            {"panel", "panel"},
            {"IC", "ic"},
            {"CG厂", "cg_factory"},
            {"CG材质", "cg_material"},
            {"FPC", "fpc"},
            {"OCA", "oca"},
            {"POL", "pol"},
            {"COG-ACF", "cog_acf"},
            {"FOG-ACF", "fog_acf"},
            {"元器件包封胶", "component_sealant"},
            {"一线胶", "one_line_glue"},
            {"面胶", "face_glue"},
            {"银浆", "silver_paste"},
            {"硅酮胶", "silicone_glue"},
            {"盲孔一道胶", "blind_hole_glue_1"},
            {"盲孔二道胶", "blind_hole_glue_2"},
            {"背光厂", "backlight_factory"},
            {"遮光胶", "shading_tape"},
            {"上/下增光", "upper_lower_brightness"},
            {"扩散", "diffuser"},
            {"LED灯胶", "led_glue"},
            {"反射", "reflector"},
            {"LED", "led"},
            {"LGP", "lgp"},
            {"胶框", "glue_frame"},
            {"铁框", "iron_frame"},
    };

    /** 供应商扩展字段：中文列名 -> 数据库字段。 */
    public static final String[][] SUPPLIER_FIELDS = {
            {"物料品类", "material_type"},
            {"公司简介", "company_profile"},
            {"产品类型", "product_type"},
            {"产能(手机)", "capacity_phone"},
            {"模组客户", "module_customers"},
            {"终端客户", "terminal_customers"},
            {"体系能力", "system_capability"},
            {"自动化能力", "automation_capability"},
            {"检验能力", "inspection_capability"},
            {"追溯能力", "traceability_capability"},
            {"测试能力", "testing_capability"},
            {"返修", "rework"},
            {"优势", "strengths"},
            {"劣势", "weaknesses"},
            {"附件", "attachment"},
            {"审核地址", "audit_address"},
            {"审核时间", "audit_time"},
            {"审核成员", "audit_members"},
            {"审核结果", "audit_result"},
            {"QSA", "qsa"},
            {"QPA", "qpa"},
            {"审核记录", "audit_record"},
            {"传音量产记录", "mass_production_record"},
    };

    /** 供应商可写字段（建表核心字段 + 扩展字段）。 */
    public static final List<String> SUPPLIER_WRITE_FIELDS = fieldNames(new String[][]{
            {"", "name"}, {"", "contact"}, {"", "phone"}, {"", "email"}, {"", "address"},
            {"", "category"}, {"", "rating"}, {"", "status"}, {"", "remark"},
    }, SUPPLIER_FIELDS);

    /** 预研字段。 */
    public static final List<String> PRESTUDY_FIELDS = List.of(
            "category", "topic", "risk", "milestone_lx", "milestone_p1",
            "milestone_p2", "milestone_p3", "status", "owner");

    /** 稽核字段。 */
    public static final List<String> AUDIT_FIELDS = List.of(
            "supplier", "audit_date", "auditor", "material_type", "scope",
            "result", "score", "summary", "action");

    /** QCP 字段。 */
    public static final List<String> QCP_FIELDS = List.of(
            "category", "name", "supplier", "process", "control_item", "spec",
            "method", "freq", "device", "responsible", "status", "remark");

    public static final List<String> AUDIT_RESULTS = List.of("合格", "有条件合格", "不合格");
    public static final List<String> SUPPLIER_STATUSES = List.of("合作中", "暂停", "淘汰");
    public static final List<String> SUPPLIER_RATINGS = List.of("A", "B", "C", "D");
    public static final List<String> QCP_STATUSES = List.of("草稿", "生效", "作废");

    /** 内置权限清单。 */
    public static final String[][] PERMISSIONS = {
            {"page:index", "物料汇总表", "menu", "10"},
            {"page:prestudy", "项目", "menu", "20"},
            {"page:selection", "选型", "menu", "30"},
            {"page:audits", "稽核", "menu", "40"},
            {"page:projects", "BOM信息", "menu", "50"},
            {"page:suppliers", "供应商信息", "menu", "60"},
            {"page:categories", "品类", "menu", "65"},
            {"page:qcps", "关键工艺", "menu", "70"},
            {"page:admin", "系统管理", "menu", "200"},
            {"action:create", "新增", "action", "100"},
            {"action:edit", "编辑", "action", "110"},
            {"action:delete", "删除", "action", "120"},
            {"action:export", "导出", "action", "130"},
            {"action:import", "导入", "action", "140"},
    };

    /** 管理员专属菜单。 */
    public static final List<String> ADMIN_ONLY_MENUS = List.of("page:admin", "page:categories");

    /** 账号自动生成专属角色时的默认页面菜单。 */
    public static final List<String> USER_ROLE_DEFAULT_PERMS = List.of(
            "page:index", "page:prestudy", "page:selection", "page:audits",
            "page:projects", "page:suppliers", "page:qcps");

    /** 常见物料类别后缀（从名称中剥离）。 */
    public static final List<String> SUFFIXES = List.of(
            "贴片电阻", "贴片电容", "贴片电感", "电阻", "电容", "电感", "二极管", "三极管",
            "晶体管", "芯片", "集成电路", "IC", "连接器", "插座", "排针", "排母", "开关",
            "按钮", "传感器", "线束", "线材", "线缆", "电缆", "电池", "电芯", "马达",
            "电机", "继电器", "保险丝", "熔断器", "晶振", "滤波器", "变压器", "磁珠",
            "磁环", "端子", "螺钉", "螺栓", "螺母", "垫圈", "垫片", "弹簧", "铆钉",
            "标签", "铭牌", "纸箱", "包装袋", "泡沫", "密封圈", "密封垫", "散热片",
            "散热器", "风扇", "导轨", "齿轮", "皮带", "轴承", "灯泡", "灯珠", "显示屏",
            "触摸屏", "电路板", "PCB", "排线", "天线", "麦克风", "扬声器", "蜂鸣器",
            "摄像头", "透镜", "镜片", "支架", "外壳", "护套", "套管", "胶带", "双面胶",
            "扎带", "卡扣", "卡箍", "垫块", "绝缘片", "保护罩", "防尘罩");

    /** 剥离类别后缀，返回核心特征词。 */
    public static String stripSuffix(String name) {
        String s = String.valueOf(name == null ? "" : name).trim();
        for (String suffix : SUFFIXES) {
            if (s.endsWith(suffix) && s.length() > suffix.length()) {
                s = s.substring(0, s.length() - suffix.length());
                break;
            }
        }
        return s.trim();
    }

    /** 从 [[中文, 字段]...] 取字段名列表。 */
    public static List<String> fieldNames(String[][]... tables) {
        List<String> names = new ArrayList<>();
        for (String[][] table : tables) {
            for (String[] row : table) {
                names.add(row[1]);
            }
        }
        return names;
    }

    /** 项目表全部可写字段（含基本列 + 规格列）。 */
    public static List<String> projectFields() {
        List<String> fields = new ArrayList<>(List.of("supplier", "category", "project_name", "flow"));
        fields.addAll(fieldNames(PROJECT_SPEC_FIELDS));
        return fields;
    }

    /** 构造一个可插入的字段 Map（自动 trim、null→''）。 */
    public static Map<String, String> pick(Map<String, Object> body, List<String> allowed) {
        Map<String, String> out = new LinkedHashMap<>();
        if (body == null) {
            return out;
        }
        for (String key : allowed) {
            Object v = body.get(key);
            if (v != null) {
                out.put(key, String.valueOf(v).trim());
            }
        }
        return out;
    }
}
