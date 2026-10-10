#!/usr/bin/env python3
"""실제 OpenAI 응답 시간 실측. mock GPT 의 지연값을 정하기 위한 것.

- chat: 싱글 모드 채팅과 같은 프롬프트(system + 대화 몇 줄)로 stream=true. 첫 토큰까지 / 전체 시간
- script: 쉐도잉 문장 생성 프롬프트(ScriptPrompt 와 동일 구조)로 stream=false. 전체 시간

사용: OPENAI_API_KEY 환경변수 또는 ../ai-chat/.env 에서 읽음
  python3 bench/measure-openai.py [--n 10]
"""
import argparse
import json
import os
import re
import statistics
import sys
import time
import urllib.request
from pathlib import Path

URL = "https://api.openai.com/v1/chat/completions"

SYSTEM_PROMPT = """너는 '수덕'이라는 이름의 오리 캐릭터야. 한국어로 수다 떠는 연습 상대 역할을 해.
오늘 대화 주제: 좋아하는 음식

규칙
- 한국어로만 말한다.
- 친구처럼 편한 반말을 쓴다.
- 한 번에 한두 문장만 말한다. 길게 설명하지 않는다.
- 매번 마지막에 상대가 더 이야기하게 만드는 질문을 하나 던진다.
- 상대의 말을 평가하거나 고쳐주지 않는다. 그냥 자연스럽게 대화를 이어간다.
"""

CHAT_HISTORY = [
    ("assistant", "안녕! 오늘은 좋아하는 음식에 대해 얘기해보자. 너는 어떤 음식 제일 좋아해?"),
    ("user", "나는 떡볶이를 제일 좋아해. 매운 거 잘 먹거든"),
    ("assistant", "오, 떡볶이! 매운 떡볶이도 좋아해? 아니면 덜 매운 게 더 좋아?"),
    ("user", "매운 게 좋아. 근데 너무 매우면 땀이 많이 나서 좀 그래"),
]

SCRIPT_SENTENCES = [
    "어제 친구랑 한강에서 치킨 먹었어",
    "주말에 부산으로 여행 가고 싶어",
    "요즘 자주 듣는 노래가 있는데 가사가 좋아",
    "날씨가 좋아서 기분이 정말 좋았어",
    "이번 주말에는 친구랑 한강에서 자전거 타려고 해",
]


def load_key():
    key = os.environ.get("OPENAI_API_KEY")
    if key:
        return key
    env = Path(__file__).resolve().parent.parent / "ai-chat" / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("OPENAI_API_KEY="):
                return line.split("=", 1)[1].strip()
    sys.exit("OPENAI_API_KEY 없음")


def script_prompt(korean):
    src = Path(__file__).resolve().parent.parent / "ai-chat/src/main/java/com/sudaduck/aichat/shadowing/ScriptPrompt.java"
    text = src.read_text(encoding="utf-8")
    m = re.search(r'TEMPLATE = """\n(.*?)""";', text, re.S)
    template = m.group(1)
    # 텍스트 블록의 공통 들여쓰기 제거
    lines = template.splitlines()
    indent = min(len(l) - len(l.lstrip()) for l in lines if l.strip())
    template = "\n".join(l[indent:] for l in lines)
    return template.replace("%s", korean)


def call(key, body, stream):
    req = urllib.request.Request(
        URL,
        data=json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream" if stream else "application/json",
        },
    )
    t0 = time.perf_counter()
    first = None
    tokens = 0
    with urllib.request.urlopen(req, timeout=60) as resp:
        if not stream:
            resp.read()
            return None, time.perf_counter() - t0, 1
        for raw in resp:
            line = raw.decode("utf-8").strip()
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                break
            delta = json.loads(data)["choices"][0]["delta"].get("content")
            if delta:
                tokens += 1
                if first is None:
                    first = time.perf_counter() - t0
    return first, time.perf_counter() - t0, tokens


def summarize(name, values):
    values = sorted(values)
    p95 = values[min(len(values) - 1, int(round(0.95 * len(values))) - 1)]
    print(f"  {name:12s} avg {statistics.mean(values)*1000:7.0f} ms | median {statistics.median(values)*1000:7.0f} ms | min {values[0]*1000:6.0f} | max {values[-1]*1000:6.0f} | p95 {p95*1000:6.0f}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=10)
    ap.add_argument("--model", default=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"))
    args = ap.parse_args()
    key = load_key()

    print(f"model={args.model} n={args.n}")
    print("\n[chat] stream=true, system + 대화 4줄 + 새 메시지")
    firsts, totals, counts = [], [], []
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages += [{"role": r, "content": c} for r, c in CHAT_HISTORY]
    messages.append({"role": "user", "content": "응 그래도 매운 게 최고야. 너는 뭐 좋아해?"})
    for i in range(args.n):
        f, t, n = call(key, {"model": args.model, "stream": True, "messages": messages}, stream=True)
        firsts.append(f); totals.append(t); counts.append(n)
        print(f"  #{i+1:2d} first {f*1000:5.0f} ms  total {t*1000:5.0f} ms  tokens {n}")
    summarize("first token", firsts)
    summarize("total", totals)
    print(f"  tokens/reply avg {statistics.mean(counts):.0f}")

    print("\n[script] stream=false, 쉐도잉 문장 생성 프롬프트")
    totals = []
    for i in range(args.n):
        korean = SCRIPT_SENTENCES[i % len(SCRIPT_SENTENCES)]
        body = {"model": args.model, "messages": [{"role": "user", "content": script_prompt(korean)}]}
        _, t, _ = call(key, body, stream=False)
        totals.append(t)
        print(f"  #{i+1:2d} total {t*1000:5.0f} ms  ({korean[:18]})")
    summarize("total", totals)


if __name__ == "__main__":
    main()
