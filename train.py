from __future__ import annotations

import argparse
import json
import statistics
import subprocess
import time
from pathlib import Path

from agent import BackendSimulationClient, DEFAULT_API_BASE, DEFAULT_MODEL_PATH, QLearningAgent, ascii_safe

ROOT = Path(__file__).resolve().parent
ARTIFACTS_DIR = ROOT / "artifacts"
TRAINING_HISTORY_PATH = ARTIFACTS_DIR / "training_history.json"
LEARNING_CURVE_PATH = ARTIFACTS_DIR / "learning_curve.svg"


class ManagedBackend:
    def __init__(self, api_base: str) -> None:
        self.client = BackendSimulationClient(api_base)
        self.process: subprocess.Popen[bytes] | None = None

    def _healthy(self) -> bool:
        try:
            return bool(self.client.health().get("ok"))
        except Exception:
            return False

    def __enter__(self) -> "ManagedBackend":
        if self._healthy():
            return self

        self.process = subprocess.Popen(
            ["node", "server.js"],
            cwd=ROOT,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        deadline = time.time() + 12
        while time.time() < deadline:
            if self._healthy():
                return self
            time.sleep(0.2)

        raise RuntimeError("Backend did not start within 12 seconds.")

    def __exit__(self, exc_type, exc, tb) -> None:
        if self.process is None:
            return

        self.process.terminate()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()


def moving_average(values: list[int], window: int) -> list[float]:
    averages: list[float] = []
    for index in range(len(values)):
        start = max(0, index - window + 1)
        chunk = values[start : index + 1]
        averages.append(statistics.fmean(chunk))
    return averages


def scale_point(value: float, minimum: float, maximum: float, height: int, top: int, bottom: int) -> float:
    usable_height = height - top - bottom
    if maximum == minimum:
        return top + usable_height / 2
    ratio = (value - minimum) / (maximum - minimum)
    return height - bottom - ratio * usable_height


def build_polyline(values: list[float], width: int, height: int, left: int, right: int, top: int, bottom: int) -> str:
    if not values:
        return ""

    usable_width = width - left - right
    minimum = min(values)
    maximum = max(values)
    if minimum == maximum:
        minimum -= 1
        maximum += 1

    points: list[str] = []
    for index, value in enumerate(values):
        x = left if len(values) == 1 else left + (usable_width * index / (len(values) - 1))
        y = scale_point(value, minimum, maximum, height, top, bottom)
        points.append(f"{x:.2f},{y:.2f}")
    return " ".join(points)


def build_learning_curve_svg(scores: list[int], smoothed_scores: list[float]) -> str:
    width = 960
    height = 420
    left = 68
    right = 24
    top = 32
    bottom = 52
    all_values = [*scores, *smoothed_scores] or [0]
    minimum = min(all_values)
    maximum = max(all_values)
    if minimum == maximum:
        minimum -= 1
        maximum += 1

    raw_points = build_polyline(scores, width, height, left, right, top, bottom)
    smooth_points = build_polyline(smoothed_scores, width, height, left, right, top, bottom)

    grid_lines: list[str] = []
    for step in range(5):
        value = minimum + ((maximum - minimum) * step / 4)
        y = scale_point(value, minimum, maximum, height, top, bottom)
        grid_lines.append(
            f'<line x1="{left}" y1="{y:.2f}" x2="{width - right}" y2="{y:.2f}" stroke="rgba(20,60,40,0.14)" stroke-width="1" />'
        )
        grid_lines.append(
            f'<text x="{left - 10}" y="{y + 4:.2f}" text-anchor="end" font-size="12" fill="#4d6357">{value:.0f}</text>'
        )

    if scores:
        episode_ticks = [
            1,
            max(1, len(scores) // 4),
            max(1, len(scores) // 2),
            max(1, (len(scores) * 3) // 4),
            len(scores),
        ]
    else:
        episode_ticks = [1]

    tick_labels: list[str] = []
    seen_ticks: set[int] = set()
    for tick in episode_ticks:
        if tick in seen_ticks:
            continue
        seen_ticks.add(tick)
        x = left if len(scores) <= 1 else left + ((width - left - right) * (tick - 1) / (len(scores) - 1))
        tick_labels.append(
            f'<line x1="{x:.2f}" y1="{height - bottom}" x2="{x:.2f}" y2="{height - bottom + 8}" stroke="#67806d" stroke-width="1" />'
        )
        tick_labels.append(
            f'<text x="{x:.2f}" y="{height - bottom + 24}" text-anchor="middle" font-size="12" fill="#4d6357">{tick}</text>'
        )

    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-labelledby="curveTitle curveDesc">
  <title id="curveTitle">Q-learning training curve</title>
  <desc id="curveDesc">Episode score trend across {len(scores)} training episodes.</desc>
  <rect width="{width}" height="{height}" rx="24" fill="#fff7ec" />
  <rect x="16" y="16" width="{width - 32}" height="{height - 32}" rx="20" fill="#f8fbf4" stroke="rgba(26,82,54,0.09)" />
  <text x="{left}" y="44" font-size="22" font-family="Trebuchet MS, Segoe UI, sans-serif" font-weight="700" fill="#173626">AI Learning Curve</text>
  <text x="{left}" y="66" font-size="13" font-family="Trebuchet MS, Segoe UI, sans-serif" fill="#567062">{len(scores)} episodes using the live GreenLogic simulation backend</text>
  {''.join(grid_lines)}
  <line x1="{left}" y1="{height - bottom}" x2="{width - right}" y2="{height - bottom}" stroke="#67806d" stroke-width="1.2" />
  <line x1="{left}" y1="{top}" x2="{left}" y2="{height - bottom}" stroke="#67806d" stroke-width="1.2" />
  {''.join(tick_labels)}
  <polyline points="{raw_points}" fill="none" stroke="rgba(214,167,76,0.75)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
  <polyline points="{smooth_points}" fill="none" stroke="#1f6b45" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round" />
  <rect x="{width - 260}" y="36" width="14" height="14" rx="7" fill="rgba(214,167,76,0.88)" />
  <text x="{width - 238}" y="47" font-size="12" font-family="Trebuchet MS, Segoe UI, sans-serif" fill="#4d6357">Episode score</text>
  <rect x="{width - 260}" y="58" width="14" height="14" rx="7" fill="#1f6b45" />
  <text x="{width - 238}" y="69" font-size="12" font-family="Trebuchet MS, Segoe UI, sans-serif" fill="#4d6357">20-episode moving average</text>
</svg>
"""


def save_training_history(
    history: list[dict[str, object]],
    scores: list[int],
    average_scores: list[float],
    model_path: Path,
    episodes: int,
) -> None:
    try:
        model_reference = str(model_path.relative_to(ROOT))
    except ValueError:
        model_reference = str(model_path)

    payload = {
        "episodes": episodes,
        "modelPath": model_reference,
        "movingAverageWindow": 20,
        "scores": scores,
        "movingAverage": average_scores,
        "history": history,
    }
    TRAINING_HISTORY_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Train the GreenLogic Q-learning agent.")
    parser.add_argument("--episodes", type=int, default=500, help="Number of training episodes.")
    parser.add_argument("--api-base", default=DEFAULT_API_BASE, help="Backend API base URL.")
    parser.add_argument("--model-path", default=str(DEFAULT_MODEL_PATH), help="Path to write the Q-table JSON file.")
    parser.add_argument("--seed", type=int, default=7, help="Random seed for training.")
    return parser


def main() -> None:
    args = build_argument_parser().parse_args()
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    model_path = Path(args.model_path)
    crops = ["tomato", "rice", "sugarcane"]
    agent = QLearningAgent(seed=args.seed)
    scores: list[int] = []
    history: list[dict[str, object]] = []

    with ManagedBackend(args.api_base):
        client = BackendSimulationClient(args.api_base)
        for episode in range(1, args.episodes + 1):
            crop_id = crops[(episode - 1) % len(crops)]
            result = agent.run_episode(client, crop_id, training=True)
            scores.append(result.score)
            history.append(
                {
                    "episode": episode,
                    "cropId": crop_id,
                    "score": result.score,
                    "outcome": result.outcome,
                    "steps": len(result.steps),
                    "epsilon": round(agent.epsilon, 6),
                }
            )
            print(
                f"Episode {episode:03d}/{args.episodes} | crop={crop_id:<10} | "
                f"score={result.score:4d} | outcome={ascii_safe(result.outcome):<18} | epsilon={agent.epsilon:.3f}"
            )

    average_scores = moving_average(scores, 20)
    agent.save(model_path)
    save_training_history(history, scores, average_scores, model_path, args.episodes)
    LEARNING_CURVE_PATH.write_text(build_learning_curve_svg(scores, average_scores), encoding="utf-8")

    print(f"Saved Q-table to {model_path}")
    print(f"Saved training history to {TRAINING_HISTORY_PATH}")
    print(f"Saved learning curve to {LEARNING_CURVE_PATH}")


if __name__ == "__main__":
    main()
