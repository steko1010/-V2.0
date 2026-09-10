package com.materialcert.server.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.materialcert.server.auth.AuthInterceptor;
import com.materialcert.server.auth.UserDao;
import java.nio.file.Path;
import java.nio.file.Paths;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * 静态资源（/uploads、/app React 前端）与 /api 鉴权拦截器注册。
 * 与 Node 版保持一致的路径与「单机同源托管」形态。
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

    private final String uploadDir;
    private final String frontendDist;
    private final UserDao userDao;
    private final ObjectMapper objectMapper;

    public WebConfig(
            @Value("${app.upload-dir:../uploads}") String uploadDir,
            @Value("${app.frontend-dist:../frontend/dist}") String frontendDist,
            UserDao userDao,
            ObjectMapper objectMapper) {
        this.uploadDir = uploadDir;
        this.frontendDist = frontendDist;
        this.userDao = userDao;
        this.objectMapper = objectMapper;
    }

    public Path uploadPath() {
        return Paths.get(uploadDir).toAbsolutePath().normalize();
    }

    public Path frontendPath() {
        return Paths.get(frontendDist).toAbsolutePath().normalize();
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/uploads/**")
                .addResourceLocations(uploadPath().toUri().toString());
        // /app/assets 等构建产物走静态资源
        registry.addResourceHandler("/app/assets/**")
                .addResourceLocations(frontendPath().toUri().toString());
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new AuthInterceptor(userDao, objectMapper)).addPathPatterns("/api/**");
    }
}
