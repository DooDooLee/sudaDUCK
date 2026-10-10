package com.sudaduck.aichat.shadowing;

import java.util.List;

public record ShadowingResponse(String sessionId, List<ShadowingScript> scripts) {
}
