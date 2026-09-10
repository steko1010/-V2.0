package com.materialcert.server.config;

import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.databind.JsonSerializer;
import com.fasterxml.jackson.databind.SerializerProvider;
import com.fasterxml.jackson.datatype.jsr310.deser.LocalDateDeserializer;
import com.fasterxml.jackson.datatype.jsr310.deser.LocalDateTimeDeserializer;
import com.fasterxml.jackson.datatype.jsr310.ser.LocalDateSerializer;
import com.fasterxml.jackson.datatype.jsr310.ser.LocalDateTimeSerializer;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.time.format.DateTimeFormatter;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 时间序列化与 Node 版保持一致：
 * LocalDateTime -> "yyyy-MM-dd HH:mm:ss"，LocalDate -> "yyyy-MM-dd"。
 * 同时兼容 MySQL DATETIME 返回的 java.sql.Timestamp / Date，避免默认输出带 "T" 的 ISO 文本。
 */
@Configuration
public class JacksonConfig {

    public static final DateTimeFormatter DATETIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    public static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("yyyy-MM-dd");

    @Bean
    public Jackson2ObjectMapperBuilderCustomizer jacksonCustomizer() {
        JsonSerializer<java.sql.Timestamp> tsSer = new JsonSerializer<>() {
            @Override
            public void serialize(java.sql.Timestamp v, JsonGenerator gen, SerializerProvider sp)
                    throws IOException {
                gen.writeString(new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(v));
            }
        };
        JsonSerializer<java.sql.Date> dateSer = new JsonSerializer<>() {
            @Override
            public void serialize(java.sql.Date v, JsonGenerator gen, SerializerProvider sp)
                    throws IOException {
                gen.writeString(v.toString());
            }
        };
        JsonSerializer<java.util.Date> utilDateSer = new JsonSerializer<>() {
            @Override
            public void serialize(java.util.Date v, JsonGenerator gen, SerializerProvider sp)
                    throws IOException {
                gen.writeString(new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(v));
            }
        };
        return builder -> builder
                .serializerByType(java.sql.Timestamp.class, tsSer)
                .serializerByType(java.sql.Date.class, dateSer)
                .serializerByType(java.util.Date.class, utilDateSer)
                .serializers(new LocalDateTimeSerializer(DATETIME), new LocalDateSerializer(DATE))
                .deserializers(new LocalDateTimeDeserializer(DATETIME), new LocalDateDeserializer(DATE));
    }
}
