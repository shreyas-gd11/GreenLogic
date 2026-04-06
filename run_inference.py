from __future__ import annotations

import sys
sys.dont_write_bytecode = True

import argparse

from soilixa_agent import BaselineSoilixaAgent
from soilixa_openenv import CROPS, DEFAULT_SEED, SoilixaEnv


def build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run one Soilixa OpenEnv baseline episode.")
    parser.add_argument("--crop", default="tomato", choices=sorted(CROPS), help="Crop task to evaluate.")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED, help="Random seed for environment dynamics.")
    parser.add_argument("--runs", type=int, default=1, help="Number of deterministic validation runs.")
    parser.add_argument("--vary-seed", action="store_true", help="Increment the seed between validation runs.")
    return parser


def run_episode(crop_name: str, seed: int) -> tuple[int, float, str, str]:
    env = SoilixaEnv(crop_type=crop_name, seed=seed)
    agent = BaselineSoilixaAgent()
    agent.epsilon = 0.0

    result = env.reset()

    while not result.done:
        action = agent.act(result.observation)
        result = env.step(action)

    state = env.state()
    crop = CROPS[state.cropType]
    return env.final_score(), env.normalized_score(), env.result_label(), f"{crop.displayName} ({crop.difficulty})"


def main() -> None:
    args = build_argument_parser().parse_args()
    scores: list[int] = []
    normalized_scores: list[float] = []
    label = ""
    result_name = ""

    for run_index in range(args.runs):
        run_seed = args.seed + run_index if args.vary_seed else args.seed
        score, normalized, outcome, crop_label = run_episode(args.crop, run_seed)
        scores.append(score)
        normalized_scores.append(normalized)
        label = crop_label
        result_name = outcome

    print(f"Crop: {label}")
    print(f"Final Score: {scores[-1]}")
    print(f"Normalized Score: {normalized_scores[-1]:.2f}")
    print(f"Result: {result_name}")

    if args.runs > 1:
        average_score = sum(scores) / len(scores)
        average_normalized = sum(normalized_scores) / len(normalized_scores)
        print(f"Scores: {scores}")
        print(f"Average Score: {average_score:.2f}")
        print(f"Average Normalized Score: {average_normalized:.2f}")


if __name__ == "__main__":
    main()
