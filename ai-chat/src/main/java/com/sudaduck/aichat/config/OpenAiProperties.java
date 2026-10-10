package com.sudaduck.aichat.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

@ConfigurationProperties(prefix = "openai")
public record OpenAiProperties(
        String baseUrl,
        String apiKey,
        String model,
        Duration responseTimeout,
        Duration streamTimeout,
        int maxConnections,
        int retryMaxAttempts,
        Duration retryBackoff
) {

    public OpenAiProperties {
        if (baseUrl == null || baseUrl.isBlank()) baseUrl = "https://api.openai.com";
        if (model == null || model.isBlank()) model = "gpt-4o-mini";
        if (responseTimeout == null) responseTimeout = Duration.ofSeconds(60);
        if (streamTimeout == null) streamTimeout = Duration.ofSeconds(60);
        if (maxConnections <= 0) maxConnections = 2000;
        if (retryMaxAttempts < 0) retryMaxAttempts = 3;
        if (retryBackoff == null) retryBackoff = Duration.ofSeconds(1);
    }
}
