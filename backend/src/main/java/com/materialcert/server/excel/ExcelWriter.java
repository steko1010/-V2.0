package com.materialcert.server.excel;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;

/** 服务端 Excel(.xlsx) 导出，列宽估算与 Node 版 xlsx 库相近。 */
public final class ExcelWriter {

    private ExcelWriter() {
    }

    /**
     * 生成 xlsx 字节：表头 headers + 数据行 rows（每行按字段 fields 取值），
     * 列宽 = max(12, min(32, 中文标题*2+4))，与 Node buildXlsxBuffer 一致。
     */
    public static byte[] buildXlsx(String sheetName, List<String> headers,
                                   List<Map<String, Object>> rows, List<String> fields) {
        try (XSSFWorkbook wb = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            Sheet sheet = wb.createSheet(sheetName);
            // 表头
            Row head = sheet.createRow(0);
            for (int c = 0; c < headers.size(); c++) {
                Cell cell = head.createCell(c);
                cell.setCellValue(headers.get(c));
                int w = Math.max(12, Math.min(32, headers.get(c).length() * 2 + 4));
                sheet.setColumnWidth(c, w * 256);
            }
            // 数据
            int r = 1;
            for (Map<String, Object> row : rows) {
                Row dataRow = sheet.createRow(r++);
                for (int c = 0; c < fields.size(); c++) {
                    Object v = row.get(fields.get(c));
                    if (v == null) {
                        dataRow.createCell(c).setCellValue("");
                    } else if (v instanceof Number num) {
                        dataRow.createCell(c).setCellValue(num.doubleValue());
                    } else {
                        dataRow.createCell(c).setCellValue(String.valueOf(v));
                    }
                }
            }
            wb.write(out);
            return out.toByteArray();
        } catch (IOException e) {
            throw new IllegalStateException("生成 Excel 失败", e);
        }
    }
}
