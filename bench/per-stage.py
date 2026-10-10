#!/usr/bin/env python3
"""k6 실행이 끝난 뒤 Prometheus 에 쌓인 서버 지표를 k6 단계(VU 구간)별로 잘라 표로 만든다.

k6 요약 파일의 수정 시각과 실행 시간으로 시작 시각을 역산하고, 각 단계의 끝 시점에서
직전 60초 구간의 서버 측 p95, 스레드 수 등을 읽는다.

사용: python3 bench/per-stage.py <label> <a|b> [--stages 50,100,200,400,800] [--stage-sec 60]
"""
import argparse
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

PROM = os.environ.get("PROM_URL", "http://localhost:9090")
APP = {"a": "duckduck-tomcat", "b": "chat-webflux"}


def q(expr, t):
    url = f"{PROM}/api/v1/query?" + urllib.parse.urlencode({"query": expr, "time": t})
    with urllib.request.urlopen(url, timeout=10) as r:
        res = json.load(r)["data"]["result"]
    return float(res[0]["value"][1]) if res else None


def fmt_ms(v):
    return "-" if v is None else f"{v*1000:.0f}ms"


def fmt_n(v):
    return "-" if v is None else f"{v:.0f}"


def fmt_pct(v):
    return "-" if v is None else f"{v*100:.0f}%"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("label")
    ap.add_argument("target", choices=["a", "b"])
    ap.add_argument("--scenario", default="chat")
    ap.add_argument("--stages", default="50,100,200,400,800")
    ap.add_argument("--stage-sec", type=int, default=60)
    ap.add_argument("--uri", default=".*/messages")
    args = ap.parse_args()

    results = Path(__file__).resolve().parent / "results"
    summary_txt = results / f"{args.label}-{args.scenario}-summary.txt"
    text = summary_txt.read_text(encoding="utf-8")
    m = re.search(r"실행 ([0-9.]+)s", text)
    if not m:
        sys.exit("요약 파일에서 실행 시간을 못 찾음")
    duration = float(m.group(1))
    end = summary_txt.stat().st_mtime
    start = end - duration

    app = APP[args.target]
    stages = [int(s) for s in args.stages.split(",")]
    win = f"{args.stage_sec}s"

    p95 = (f'histogram_quantile(0.95, sum by (le) (rate(http_server_requests_seconds_bucket'
           f'{{application="{app}",uri=~"{args.uri}"}}[{win}])))')
    rps = f'sum(rate(http_server_requests_seconds_count{{application="{app}",uri=~"{args.uri}"}}[{win}]))'
    threads = f'max_over_time(jvm_threads_live_threads{{application="{app}"}}[{win}])'
    heap = f'max_over_time(sum(jvm_memory_used_bytes{{application="{app}",area="heap"}})[{win}:5s])'
    cpu = f'avg_over_time(process_cpu_usage{{application="{app}"}}[{win}])'
    tomcat_busy = f'max_over_time(tomcat_threads_busy_threads{{application="{app}"}}[{win}])'
    exec_active = f'max_over_time(executor_active_threads{{application="{app}",name="chatTaskExecutor"}}[{win}])'
    exec_queue = f'max_over_time(executor_queued_tasks{{application="{app}",name="chatTaskExecutor"}}[{win}])'
    netty_conn = f'max_over_time(reactor_netty_connection_provider_active_connections{{application="{app}"}}[{win}])'

    rows = []
    t = start
    for vus in stages:
        t += args.stage_sec
        row = {
            "vus": vus,
            "p95": q(p95, t),
            "rps": q(rps, t),
            "threads": q(threads, t),
            "heap_mb": (q(heap, t) or 0) / 1024 / 1024,
            "cpu": q(cpu, t),
        }
        if args.target == "a":
            row["tomcat_busy"] = q(tomcat_busy, t)
            row["exec_active"] = q(exec_active, t)
            row["exec_queue"] = q(exec_queue, t)
        else:
            row["netty_conn"] = q(netty_conn, t)
        rows.append(row)

    title = f"{args.label} ({app}) {args.scenario} 단계별 서버 지표"
    lines = [f"# {title}", "", f"- k6 시작 추정 {start:.0f} ~ 종료 {end:.0f} (epoch), 단계 {args.stage_sec}s", ""]
    if args.target == "a":
        lines.append("| 동시 사용자 | 서버 p95 | req/s | 톰캣 바쁜 스레드 | 실행기 활성 | 실행기 큐 | JVM 스레드 | 힙 MB | CPU |")
        lines.append("|---|---|---|---|---|---|---|---|---|")
        for r in rows:
            lines.append(f"| {r['vus']} | {fmt_ms(r['p95'])} | {fmt_n(r['rps'])} | {fmt_n(r['tomcat_busy'])} | "
                         f"{fmt_n(r['exec_active'])} | {fmt_n(r['exec_queue'])} | {fmt_n(r['threads'])} | "
                         f"{r['heap_mb']:.0f} | {fmt_pct(r['cpu'])} |")
    else:
        lines.append("| 동시 사용자 | 서버 p95 | req/s | OpenAI 동시 연결 | JVM 스레드 | 힙 MB | CPU |")
        lines.append("|---|---|---|---|---|---|---|")
        for r in rows:
            lines.append(f"| {r['vus']} | {fmt_ms(r['p95'])} | {fmt_n(r['rps'])} | {fmt_n(r['netty_conn'])} | "
                         f"{fmt_n(r['threads'])} | {r['heap_mb']:.0f} | {fmt_pct(r['cpu'])} |")
    out = results / f"{args.label}-{args.scenario}-per-stage.md"
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    print(f"\n-> {out}")


if __name__ == "__main__":
    main()
