#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
import urllib.error
import urllib.request

from greenlogic_agent import BaselineGreenLogicAgent
from greenlogic_openenv import CROPS, DEFAULT_SEED, GreenLogicEnv

TASK_TO_CROP = {
    "task_easy": "tomato",
    "task_medium": "rice",
    "task_hard": "sugarcane",
}


def build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run one validator-compatible GreenLogic inference episode.")
    parser.add_argument("--crop", default="tomato", choices=sorted(CROPS), help="Crop task to evaluate.")
    parser.add_argument("--task", default="", help="Optional task id alias (task_easy, task_medium, task_hard).")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED, help="Random seed for environment dynamics.")
    return parser


def emit(tag: str, payload: dict[str, object]) -> None:
    print(f"{tag} {json.dumps(payload, sort_keys=True)}", flush=True)


def _completion_endpoints(api_base_url: str) -> list[str]:
    base = api_base_url.rstrip("/")
    if base.endswith("/v1"):
        return [f"{base}/chat/completions", f"{base[:-3]}/v1/chat/completions"]
    return [f"{base}/v1/chat/completions", f"{base}/chat/completions"]


def ping_litellm_proxy() -> None:
    api_base_url = os.getenv("API_BASE_URL", "").strip()
    api_key = os.getenv("API_KEY", "").strip()
    if not api_base_url or not api_key:
        emit("[STEP]", {"llm_proxy": "skipped", "reason": "missing_api_env"})
        return

    model = (
        os.getenv("OPENAI_MODEL")
        or os.getenv("MODEL")
        or os.getenv("LITELLM_MODEL")
        or "gpt-4o-mini"
    )
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "Respond with water, fertilize, or do_nothing."}],
        "max_tokens": 3,
        "temperature": 0.0,
    }
    body = json.dumps(payload).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    last_error = ""
    for url in _completion_endpoints(api_base_url):
        req = urllib.request.Request(url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=15) as response:
                raw = response.read().decode("utf-8", errors="replace")
            data = json.loads(raw)
            choice = (data.get("choices") or [{}])[0]
            message = choice.get("message") or {}
            content = str(message.get("content", "")).strip()
            emit("[STEP]", {"llm_proxy": "ok", "model": model, "response": content[:32]})
            return
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError, ValueError) as exc:
            last_error = str(exc)

    emit("[STEP]", {"llm_proxy": "error", "reason": last_error[:160]})


def main() -> int:
    args = build_argument_parser().parse_args()
    crop_name = TASK_TO_CROP.get(args.task, args.crop)

    try:
        emit("[START]", {"crop": crop_name, "seed": args.seed, "task": args.task or None})
        ping_litellm_proxy()

        env = GreenLogicEnv(crop_type=crop_name, seed=args.seed)
        agent = BaselineGreenLogicAgent()
        agent.epsilon = 0.0

        result = env.reset()
        step_count = 0

        while not result.done:
            action = agent.act(result.observation)
            result = env.step(action)
            step_count += 1

            emit(
                "[STEP]",
                {
                    "action": action.action,
                    "day": result.observation.day,
                    "done": result.done,
                    "normalized_score": round(env.normalized_score(), 4),
                    "reward": result.reward,
                    "step": step_count,
                },
            )

        state = env.state()
        crop = CROPS[state.cropType]
        emit(
            "[END]",
            {
                "crop": f"{crop.displayName} ({crop.difficulty})",
                "final_score": env.final_score(),
                "normalized_score": round(env.normalized_score(), 4),
                "result": env.result_label(),
                "status": "success",
                "steps": step_count,
            },
        )
        return 0

    except Exception as exc:
        emit("[END]", {"error": str(exc), "status": "error", "type": exc.__class__.__name__})
        traceback.print_exc(file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
