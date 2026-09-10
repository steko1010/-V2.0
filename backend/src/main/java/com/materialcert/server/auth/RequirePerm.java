package com.materialcert.server.auth;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 接口权限守卫声明。value 为权限码（任一命中即放行，与 Node requirePermission 语义一致）。
 * categoryAction=true 时复刻 requireCategoryAction：必须同时持有 page:categories 与任一 action 码。
 * 超管（isSuper）一律放行。
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface RequirePerm {

    String[] value() default {};

    boolean categoryAction() default false;
}
