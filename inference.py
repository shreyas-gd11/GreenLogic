#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import traceback

from greenlogic_agent import BaselineGreenLogicAgent
from greenlogic_openenv import CROPS, DEFAULT_SEED, GreenLogicEnv


def build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run one validator-compatible GreenLogic inference episode.")
    parser.add_argument("--crop", default="tomato", choices=sorted(CROPS), help="Crop task to evaluate.")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED, help="Random seed for environment dynamics.")
    return parser


def emit(tag: str, payload: dict[str, object]) -> None:
    print(f"{tag} {json.dumps(payload, sort_keys=True)}", flush=True)


def main() -> int:
    args = build_argument_parser().parse_args()

    try:
        emit("[START]", {"crop": args.crop, "seed": args.seed})

        env = GreenLogicEnv(crop_type=args.crop, seed=args.seed)
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
