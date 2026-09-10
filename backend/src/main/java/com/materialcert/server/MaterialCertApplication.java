package com.materialcert.server;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * 物料开发认证管理系统后端（Spring Boot 3.x 迁移版）。
 * 与 Node 版保持相同的 HTTP 契约：/api 前缀 REST 接口 + session cookie 会话
 * （名称 sid 由前端透明携带，无需改动前端）+ /app（React SPA）与 /uploads 静态托管。
 */
@SpringBootApplication
public class MaterialCertApplication {

    public static void main(String[] args) {
        SpringApplication.run(MaterialCertApplication.class, args);
    }
}
