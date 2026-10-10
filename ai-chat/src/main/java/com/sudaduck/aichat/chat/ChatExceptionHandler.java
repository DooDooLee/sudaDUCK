package com.sudaduck.aichat.chat;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.bind.support.WebExchangeBindException;
import org.springframework.web.reactive.function.client.WebClientException;
import org.springframework.web.server.ServerWebInputException;

import java.util.Map;
import java.util.concurrent.TimeoutException;

/**
 * JSON 응답 엔드포인트용. SSE 엔드포인트 실패는 ChatController.toSse 에서 error 이벤트로 바뀐다.
 * SSE 엔드포인트의 검증 실패(400)도 여기로 오는데, Accept: text/event-stream 이면 본문이 SSE 로 감싸져 나간다.
 * 그래서 Content-Type 을 JSON 으로 못박는다.
 */
@Slf4j
@RestControllerAdvice
public class ChatExceptionHandler {

    @ExceptionHandler(SessionNotFoundException.class)
    public ResponseEntity<Map<String, String>> sessionNotFound(SessionNotFoundException e) {
        return json(HttpStatus.NOT_FOUND, e.getMessage());
    }

    @ExceptionHandler(WebExchangeBindException.class)
    public ResponseEntity<Map<String, String>> invalid(WebExchangeBindException e) {
        String reason = e.getFieldErrors().isEmpty()
                ? "잘못된 요청입니다."
                : e.getFieldErrors().get(0).getDefaultMessage();
        return json(HttpStatus.BAD_REQUEST, reason);
    }

    // 본문 없음, JSON 깨짐 등
    @ExceptionHandler(ServerWebInputException.class)
    public ResponseEntity<Map<String, String>> unreadable(ServerWebInputException e) {
        return json(HttpStatus.BAD_REQUEST, "잘못된 요청 본문입니다.");
    }

    @ExceptionHandler({WebClientException.class, TimeoutException.class})
    public ResponseEntity<Map<String, String>> upstream(Exception e) {
        log.error("OpenAI 호출 실패: {}", e.toString());
        return json(HttpStatus.BAD_GATEWAY, "AI 응답 생성에 실패했습니다.");
    }

    private static ResponseEntity<Map<String, String>> json(HttpStatusCode status, String message) {
        return ResponseEntity.status(status)
                .contentType(MediaType.APPLICATION_JSON)
                .body(Map.of("message", message));
    }
}
