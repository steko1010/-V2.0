package com.materialcert.server.web;

import com.materialcert.server.config.WebConfig;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/**
 * React SPA（/app）托管：命中 dist 真实文件（.js/.css/.svg…）则返回文件；
 * 其余路径回退 index.html（history 路由），等价 Node 的 express.static + app.get('/app/*')。
 */
@Controller
public class AppController {

    private final WebConfig webConfig;

    public AppController(WebConfig webConfig) {
        this.webConfig = webConfig;
    }

    @GetMapping({"/app", "/app/", "/app/**"})
    public ResponseEntity<Resource> spa(HttpServletRequest request) throws IOException {
        String uri = request.getRequestURI(); // 例如 /app/login 或 /app/assets/x.js
        return serve(uri);
    }

    private ResponseEntity<Resource> serve(String uri) throws IOException {
        Path dist = webConfig.frontendPath();
        String rel = uri;
        if (rel.startsWith("/app")) {
            rel = rel.substring(4); // 去掉 /app 前缀，剩余可能为空或以 / 开头
        }
        if (rel.isEmpty()) {
            rel = "/";
        }
        String norm = rel.startsWith("/") ? rel.substring(1) : rel;
        Path file = dist.resolve(norm).normalize();
        if (!file.startsWith(dist)) {
            file = dist;
        }
        if (Files.isRegularFile(file)) {
            byte[] bytes = Files.readAllBytes(file);
            return ResponseEntity.ok()
                    .header(HttpHeaders.CACHE_CONTROL, "no-store")
                    .contentType(guess(file))
                    .body(new ByteArrayResource(bytes));
        }
        // 带扩展名的缺失资源按 404（避免把 .js 404 变成 HTML），其余交给 SPA 入口
        if (norm.indexOf('.') >= 0 && norm.contains("/")) {
            return ResponseEntity.notFound().build();
        }
        Path index = dist.resolve("index.html");
        if (Files.isRegularFile(index)) {
            byte[] bytes = Files.readAllBytes(index);
            return ResponseEntity.ok()
                    .header(HttpHeaders.CACHE_CONTROL, "no-store")
                    .contentType(MediaType.TEXT_HTML)
                    .body(new ByteArrayResource(bytes));
        }
        return ResponseEntity.notFound().build();
    }

    private MediaType guess(Path file) {
        String name = file.getFileName().toString().toLowerCase();
        if (name.endsWith(".js")) {
            return MediaType.valueOf("text/javascript");
        }
        if (name.endsWith(".css")) {
            return MediaType.valueOf("text/css");
        }
        if (name.endsWith(".html")) {
            return MediaType.TEXT_HTML;
        }
        if (name.endsWith(".svg")) {
            return MediaType.valueOf("image/svg+xml");
        }
        if (name.endsWith(".png")) {
            return MediaType.IMAGE_PNG;
        }
        if (name.endsWith(".jpg") || name.endsWith(".jpeg")) {
            return MediaType.IMAGE_JPEG;
        }
        if (name.endsWith(".woff2")) {
            return MediaType.valueOf("font/woff2");
        }
        if (name.endsWith(".json")) {
            return MediaType.APPLICATION_JSON;
        }
        return MediaType.APPLICATION_OCTET_STREAM;
    }
}
