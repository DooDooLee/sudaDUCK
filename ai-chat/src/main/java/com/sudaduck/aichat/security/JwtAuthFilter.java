package com.sudaduck.aichat.security;

import io.jsonwebtoken.JwtException;
import org.springframework.core.annotation.Order;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.server.reactive.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilter;
import org.springframework.web.server.WebFilterChain;
import reactor.core.publisher.Mono;

import java.nio.charset.StandardCharsets;

/**
 * /api/** 는 Bearer 토큰 필수. 통과하면 userId 를 exchange 속성과 Reactor Context 에 넣는다.
 * Spring Security 를 통째로 들이기엔 필요한 게 이것뿐이라 필터 하나로 끝낸다.
 */
@Component
@Order(0)
public class JwtAuthFilter implements WebFilter {

    public static final String USER_ID = "userId";
    private static final String BEARER = "Bearer ";
    private static final byte[] UNAUTHORIZED_BODY =
            "{\"message\":\"인증이 필요합니다.\"}".getBytes(StandardCharsets.UTF_8);

    private final JwtTokenProvider tokenProvider;

    public JwtAuthFilter(JwtTokenProvider tokenProvider) {
        this.tokenProvider = tokenProvider;
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
        String path = exchange.getRequest().getPath().pathWithinApplication().value();
        if (!path.startsWith("/api/") || exchange.getRequest().getMethod() == HttpMethod.OPTIONS) {
            return chain.filter(exchange);
        }

        String header = exchange.getRequest().getHeaders().getFirst(HttpHeaders.AUTHORIZATION);
        if (header == null || !header.startsWith(BEARER)) {
            return unauthorized(exchange.getResponse());
        }

        Long userId;
        try {
            userId = tokenProvider.getUserId(header.substring(BEARER.length()));
        } catch (JwtException | IllegalArgumentException e) {
            return unauthorized(exchange.getResponse());
        }
        if (userId == null) {
            return unauthorized(exchange.getResponse());
        }

        exchange.getAttributes().put(USER_ID, userId);
        return chain.filter(exchange)
                .contextWrite(ctx -> ctx.put(USER_ID, userId));
    }

    private Mono<Void> unauthorized(ServerHttpResponse response) {
        response.setStatusCode(HttpStatus.UNAUTHORIZED);
        response.getHeaders().setContentType(MediaType.APPLICATION_JSON);
        DataBuffer body = response.bufferFactory().wrap(UNAUTHORIZED_BODY);
        return response.writeWith(Mono.just(body));
    }
}
