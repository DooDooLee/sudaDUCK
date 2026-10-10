package com.example.DuckDuck.domain.ai.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;

import java.util.List;

@Getter
@AllArgsConstructor
public class ShadowingResponse {

    private String sessionId;
    private List<ShadowingScript> scripts;
}
