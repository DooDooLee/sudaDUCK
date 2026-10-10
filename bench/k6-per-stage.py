#!/usr/bin/env python3
"""k6 CSV 출력(--out csv)을 단계(VU 구간)별로 잘라 손님 쪽 응답시간 표를 만든다.

서버 쪽 지표는 스레드가 요청을 집어든 뒤부터만 재므로, 톰캣 접속 대기열에서 기다린 시간이 빠진다.
그래서 구간별 비교는 이 손님 쪽 숫자를 쓴다.

사용: python3 bench/k6-per-stage.py results/full2-a-chat.csv.gz [--stages 50,100,200,400,800] [--stage-sec 60]
"""
import argparse
import csv
import gzip
import statistics
from collections import defaultdict
from pathlib import Path


def pct(values, p):
    if not values:
        return None
    values = sorted(values)
    k = (len(values) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(values) - 1)
    return values[lo] + (values[hi] - values[lo]) * (k - lo)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv")
    ap.add_argument("--stages", default="50,100,200,400,800")
    ap.add_argument("--stage-sec", type=int, default=60)
    ap.add_argument("--name", default="send_message")
    args = ap.parse_args()

    stages = [int(s) for s in args.stages.split(",")]
    opener = gzip.open if args.csv.endswith(".gz") else open
    waiting, duration, failed = defaultdict(list), defaultdict(list), defaultdict(int)
    t0 = None
    with opener(args.csv, "rt", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            m = row["metric_name"]
            if m not in ("http_req_waiting", "http_req_duration", "http_req_failed"):
                continue
            if row.get("name") != args.name:
                continue
            ts = int(row["timestamp"])
            if t0 is None or ts < t0:
                t0 = ts
            v = float(row["metric_value"])
            key = ts
            if m == "http_req_waiting":
                waiting[key].append(v)
            elif m == "http_req_duration":
                duration[key].append(v)
            else:
                failed[key] += int(v)

    def bucket(d):
        out = defaultdict(list)
        for ts, vals in d.items():
            idx = (ts - t0) // args.stage_sec
            out[idx].extend(vals if isinstance(vals, list) else [vals])
        return out

    w, d = bucket(waiting), bucket(duration)
    fcount = defaultdict(int)
    for ts, n in failed.items():
        fcount[(ts - t0) // args.stage_sec] += n

    label = Path(args.csv).name.split("-chat")[0]
    lines = [f"# {label} 손님(k6) 쪽 단계별 응답시간 ({args.name})", "",
             "| 동시 사용자 | 요청 수 | 첫 바이트 p50 | 첫 바이트 p95 | 첫 바이트 p99 | 전체 p95 | 실패 |",
             "|---|---|---|---|---|---|---|"]
    for i, vus in enumerate(stages):
        wv, dv = w.get(i, []), d.get(i, [])
        if not wv:
            lines.append(f"| {vus} | 0 | - | - | - | - | - |")
            continue
        lines.append(f"| {vus} | {len(wv)} | {pct(wv,0.5):.0f}ms | {pct(wv,0.95):.0f}ms | {pct(wv,0.99):.0f}ms | "
                     f"{pct(dv,0.95):.0f}ms | {fcount.get(i,0)} |")
    out = Path(args.csv).with_name(f"{label}-chat-k6-per-stage.md")
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    print(f"\n-> {out}")


if __name__ == "__main__":
    main()
