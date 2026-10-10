package com.example.DuckDuck.global.config;

import com.example.DuckDuck.global.security.jwt.JwtTokenProvider;
import com.example.DuckDuck.global.security.jwt.JwtAuthenticationFilter;
import com.example.DuckDuck.global.security.oauth.CustomOAuth2UserService;
import com.example.DuckDuck.global.security.oauth.OAuth2SuccessHandler;
import jakarta.servlet.DispatcherType;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.List;

@Configuration
@EnableWebSecurity
@RequiredArgsConstructor
public class SecurityConfig {

    private final JwtTokenProvider jwtTokenProvider;
    private final OAuth2SuccessHandler oAuth2SuccessHandler;
    private final CustomOAuth2UserService customOAuth2UserService;
    private final StringRedisTemplate redisTemplate;

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception{
        http
                //CSRF 및 Form Login 비활성화
                //cors설정
                .cors(cors -> cors.configurationSource(corsConfigurationSource()))
                .csrf(AbstractHttpConfigurer::disable)
                .formLogin(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)

                //Stateless 설정
                .sessionManagement(session ->
                        session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))

                //요청 권한 설정
                .authorizeHttpRequests(auth -> auth
                        // SSE(SseEmitter) 완료 시 ASYNC 재디스패치는 최초 요청에서 이미 인증됨
                        .dispatcherTypeMatchers(DispatcherType.ASYNC).permitAll()
                        .requestMatchers(
                                "/v3/api-docs/**",
                                "/swagger-ui/**",
                                "/swagger-ui.html"
                        ).permitAll() //swagger 관련 주소 모두 허용
                        .requestMatchers(
                                "/api/v1/auth/**",
                                "/oauth2/**",
                                "/login/**",
                                "/api/v1/gpt/translate",
                                "/api/v1/topics",
                                "/ws/**",
                                "/audio/**"  // ← 여기 추가! (TTS 오디오 파일)
                        ).permitAll() // 로그인 관련은 모두 허용
                        .requestMatchers("/api/v1/rooms/*/webrtc/token").permitAll() // openvidu 잠깐 설정
                        .anyRequest().authenticated() // 그 외 나머지는 인증 필요
                )

                .oauth2Login(oauth2 -> oauth2
                        .userInfoEndpoint(userInfo -> userInfo.userService(customOAuth2UserService))
                        .successHandler(oAuth2SuccessHandler)
                )
                .exceptionHandling(exception -> exception
                        .authenticationEntryPoint(((request, response, authException) -> {
                            response.sendError(HttpServletResponse.SC_UNAUTHORIZED, "인증이 필요합니다.");
                        })))

                //jwt 필터 추가
                .addFilterBefore(new JwtAuthenticationFilter(jwtTokenProvider,redisTemplate),
                        UsernamePasswordAuthenticationFilter.class);



        return http.build();
    }
    //cors설정을 위한 bean
    @Bean
    public CorsConfigurationSource corsConfigurationSource(){
        CorsConfiguration configuration = new CorsConfiguration();

        // 허용할 프론트엔드 도메인 (주의: 쿠키 사용 시 "*"는 절대 안 됨)
        configuration.setAllowedOrigins(List.of(
                "http://localhost:5173",          // 로컬 테스트용 (Vue 기본 포트 예시)
                "http://192.168.30.196:5173",       // 확인하신 실제 내 IP 주소
                "http://127.0.0.1:5173",
                "https://i14e104.p.ssafy.io",    // ✅ 추가: HTTPS 도메인
                "http://i14e104.p.ssafy.io"
        ));

        // 허용할 HTTP 메서드
        configuration.setAllowedMethods(List.of("GET", "POST","PATCH", "PUT", "DELETE", "OPTIONS"));

        // 허용할 헤더
        configuration.setAllowedHeaders(List.of("Authorization", "Content-Type", "Cache-Control"));

        // 쿠키 및 자격 증명 허용 (가장 중요!)
        configuration.setAllowCredentials(true);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**",configuration);
        return source;

    }
}
