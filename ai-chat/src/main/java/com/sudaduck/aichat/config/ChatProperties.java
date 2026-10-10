package com.sudaduck.aichat.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

@ConfigurationProperties(prefix = "chat")
public record ChatProperties(
        Duration sessionTtl,
        int historyLimit
) {
}
