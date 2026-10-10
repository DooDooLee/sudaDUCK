package com.sudaduck.aichat.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.netty.http.client.HttpClient;
import reactor.netty.resources.ConnectionProvider;

@Configuration
public class WebClientConfig {

    @Bean
    public WebClient openAiWebClient(OpenAiProperties props, WebClient.Builder builder) {
        ConnectionProvider pool = ConnectionProvider.builder("openai")
                .maxConnections(props.maxConnections())
                // 풀이 꽉 찼을 때 대기열 크기. -1이면 제한 없음.
                // 기본값(maxConnections * 2)을 넘으면 요청이 바로 실패하므로 부하테스트 전에 풀어둔다.
                .pendingAcquireMaxCount(-1)
                // reactor_netty_connection_provider_* 지표. 부하테스트에서 풀 대기 여부를 본다.
                .metrics(true)
                .build();

        HttpClient httpClient = HttpClient.create(pool)
                .responseTimeout(props.responseTimeout());

        return builder
                .baseUrl(props.baseUrl())
                .clientConnector(new ReactorClientHttpConnector(httpClient))
                .defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer " + props.apiKey())
                .build();
    }
}
