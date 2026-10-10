package com.sudaduck.aichat.security;

import com.sudaduck.aichat.config.JwtProperties;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.io.Decoders;
import io.jsonwebtoken.security.Keys;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;

/**
 * 검증 전용. 토큰 발급은 A(sudaDUCK backend)가 하고 B 는 같은 키로 서명만 확인한다.
 * 서명 검증은 CPU 연산뿐이라 이벤트 루프에서 바로 돌려도 된다.
 */
@Component
public class JwtTokenProvider {

    private final SecretKey key;

    public JwtTokenProvider(JwtProperties props) {
        this.key = Keys.hmacShaKeyFor(Decoders.BASE64.decode(props.secret()));
    }

    /** 서명/만료가 잘못됐으면 JwtException 을 던진다. */
    public Long getUserId(String token) {
        return Jwts.parser()
                .verifyWith(key)
                .build()
                .parseSignedClaims(token)
                .getPayload()
                .get("userId", Long.class);
    }
}
