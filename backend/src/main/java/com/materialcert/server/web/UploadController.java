package com.materialcert.server.web;

import com.materialcert.server.auth.RequirePerm;
import com.materialcert.server.common.ApiException;
import com.materialcert.server.common.Sql;
import com.materialcert.server.config.WebConfig;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * 附件上传（等价 Node POST /api/upload）。兼容两类请求体：
 * 1) React 供应商页：{ name, base64 }，存 uploads 根目录；
 * 2) 旧版通用：{ file, folder? }，按 folder 存入子目录。
 * 返回 { url, filename }，url 可直接经 /uploads/** 访问。
 */
@RestController
public class UploadController {

    private final WebConfig webConfig;

    public UploadController(WebConfig webConfig) {
        this.webConfig = webConfig;
    }

    @PostMapping("/api/upload")
    @RequirePerm({"action:create", "action:edit"})
    public Map<String, Object> upload(@RequestBody(required = false) Map<String, Object> body) {
        Map<String, Object> b = body == null ? Map.of() : body;
        String base64 = b.containsKey("base64")
                ? Sql.s(b.get("base64"))
                : Sql.s(b.get("file"));
        String folder = Sql.s(b.getOrDefault("folder", ""));
        String rawName = Sql.s(b.get("name"));
        if (base64.isEmpty()) {
            throw ApiException.badRequest("请上传文件");
        }
        // 允许带 dataURL 前缀
        String data = base64;
        String mime = "";
        if (data.contains(",")) {
            int comma = data.indexOf(',');
            String head = data.substring(0, comma);
            if (head.contains(";base64")) {
                int slash = head.indexOf('/');
                int semi = head.indexOf(';');
                if (slash >= 0 && semi > slash) {
                    mime = head.substring(slash + 1, semi);
                }
                data = data.substring(comma + 1);
            }
        }
        byte[] bytes;
        try {
            bytes = Base64.getDecoder().decode(data);
        } catch (IllegalArgumentException e) {
            throw ApiException.badRequest("base64 内容不合法");
        }
        if (bytes.length > 20 * 1024 * 1024) {
            throw ApiException.badRequest("文件不能超过 20MB");
        }
        String safeName = sanitize(rawName.isEmpty() ? "file." + (mime.isEmpty() ? "bin" : mime) : rawName);
        String ext = safeName.contains(".")
                ? safeName.substring(safeName.lastIndexOf('.')).toLowerCase()
                : "";
        if (!isAllowedExt(ext)) {
            throw ApiException.badRequest("不支持的文件类型");
        }
        try {
            String stored = System.currentTimeMillis() + "_" + safeName;
            String url;
            Path dirNamePath = webConfig.uploadPath();
            if (!folder.isEmpty()) {
                dirNamePath = dirNamePath.resolve(sanitize(folder)).normalize();
                if (!dirNamePath.startsWith(webConfig.uploadPath())) {
                    dirNamePath = webConfig.uploadPath();
                }
                url = "/uploads/" + sanitize(folder) + "/" + stored;
            } else {
                url = "/uploads/" + stored;
            }
            Files.createDirectories(dirNamePath);
            Files.write(dirNamePath.resolve(stored), bytes);
            Map<String, Object> resp = new LinkedHashMap<>();
            resp.put("ok", true);
            resp.put("url", url);
            resp.put("filename", stored);
            resp.put("name", safeName);
            return resp;
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            throw new ApiException(500, "文件保存失败");
        }
    }

    private String sanitize(String name) {
        String n = name.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
        if (n.length() > 120) {
            n = n.substring(n.length() - 120);
        }
        return n;
    }

    private boolean isAllowedExt(String ext) {
        return ext.equals(".pdf") || ext.equals(".doc") || ext.equals(".docx")
                || ext.equals(".xls") || ext.equals(".xlsx") || ext.equals(".ppt")
                || ext.equals(".pptx") || ext.equals(".txt") || ext.equals(".png")
                || ext.equals(".jpg") || ext.equals(".jpeg") || ext.equals(".gif")
                || ext.equals(".webp") || ext.equals(".bmp") || ext.equals(".zip")
                || ext.equals(".rar") || ext.equals(".7z") || ext.equals(".csv");
    }
}
