from __future__ import annotations

import argparse
import json
import random
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ACTIONS = ("water", "fertilize", "do_nothing")
DEFAULT_API_BASE = "http://localhost:5000"
DEFAULT_MODEL_PATH = Path(__file__).resolve().parent / "artifacts" / "q_table.json"


def ascii_safe(text: str) -> str:
    normalized = text.encode("ascii", "ignore").decode("ascii").strip()
    return normalized or text


def bucket_moisture(moisture: int, low: int, high: int) -> str:
    if moisture < low - 10:
        return "very_dry"
    if moisture < low:
        return "dry"
    if moisture <= high:
        return "optimal"
    if moisture <= high + 12:
        return "wet"
    return "waterlogged"


def bucket_temperature(temperature: int, low: int, high: int) -> str:
    if temperature < low:
        return "cool"
    if temperature > high:
        return "hot"
    return "ideal"


def bucket_health(health: int) -> str:
    if health < 45:
        return "critical"
    if health < 65:
        return "weak"
    if health < 85:
        return "stable"
    return "strong"


def encode_state(simulation: dict[str, Any]) -> str:
    crop = simulation["crop"]
    moisture_low, moisture_high = crop["moistureRange"]
    temp_low, temp_high = crop["temperatureRange"]
    fertilizer_due = "due" if simulation["day"] in crop["fertilizerDays"] else "wait"

    return "|".join(
        [
            f"crop={crop['id']}",
            f"day={simulation['day']:02d}",
            f"moisture={bucket_moisture(simulation['moisture'], moisture_low, moisture_high)}",
            f"temp={bucket_temperature(simulation['temperature'], temp_low, temp_high)}",
            f"health={bucket_health(simulation['cropHealth'])}",
            f"fertilizer={fertilizer_due}",
        ]
    )


def apply_safety_rule(simulation: dict[str, Any], action: str) -> str:
    crop = simulation["crop"]
    moisture_low = crop["moistureRange"][0]
    moisture_high = crop["moistureRange"][1]

    if simulation["moisture"] > moisture_high:
        return "do_nothing"

    if action == "water" and simulation["moisture"] >= moisture_low:
        return "do_nothing"

    if simulation["cropHealth"] > 80 and action == "fertilize":
        return "do_nothing"

    return action


@dataclass
class EpisodeResult:
    crop_id: str
    score: int
    outcome: str
    steps: list[dict[str, Any]]
    final_state: dict[str, Any]


class BackendSimulationClient:
    def __init__(self, api_base: str = DEFAULT_API_BASE) -> None:
        self.api_base = api_base.rstrip("/")

    def _request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        data = None
        headers = {"Content-Type": "application/json"}
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")

        request = urllib.request.Request(f"{self.api_base}{path}", data=data, headers=headers, method=method)

        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            message = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"{method} {path} failed with {error.code}: {message}") from error
        except urllib.error.URLError as error:
            raise RuntimeError(f"Unable to reach backend at {self.api_base}: {error.reason}") from error

    def health(self) -> dict[str, Any]:
        return self._request("GET", "/api/health")

    def create_simulation(self, crop_id: str) -> dict[str, Any]:
        return self._request("POST", "/api/simulations", {"cropId": crop_id})

    def apply_action(self, simulation_id: str, action: str) -> dict[str, Any]:
        return self._request("POST", f"/api/simulations/{simulation_id}/actions", {"action": action})


class QLearningAgent:
    def __init__(
        self,
        *,
        learning_rate: float = 0.25,
        discount: float = 0.92,
        epsilon: float = 1.0,
        epsilon_min: float = 0.05,
        epsilon_decay: float = 0.992,
        seed: int | None = None,
    ) -> None:
        self.learning_rate = learning_rate
        self.discount = discount
        self.epsilon = epsilon
        self.epsilon_min = epsilon_min
        self.epsilon_decay = epsilon_decay
        self.random = random.Random(seed)
        self.q_table: dict[str, dict[str, float]] = {}

    def ensure_state(self, state_key: str) -> dict[str, float]:
        values = self.q_table.setdefault(state_key, {})
        for action in ACTIONS:
            values.setdefault(action, 0.0)
        return values

    def choose_action(self, state_key: str, *, training: bool) -> str:
        values = self.ensure_state(state_key)
        if training and self.random.random() < self.epsilon:
            return self.random.choice(list(ACTIONS))
        return self.greedy_action(values)

    def greedy_action(self, values: dict[str, float]) -> str:
        best_value = max(values.values())
        best_actions = [action for action in ACTIONS if values[action] == best_value]
        return self.random.choice(best_actions)

    def update_q_value(
        self,
        state_key: str,
        action: str,
        reward: float,
        next_state_key: str | None,
        *,
        done: bool,
    ) -> None:
        current_values = self.ensure_state(state_key)
        current_q = current_values[action]
        future_q = 0.0

        if not done and next_state_key is not None:
            next_values = self.ensure_state(next_state_key)
            future_q = max(next_values.values())

        updated_q = current_q + self.learning_rate * (
            reward + self.discount * future_q - current_q
        )
        current_values[action] = updated_q

    def decay_epsilon(self) -> None:
        self.epsilon = max(self.epsilon_min, self.epsilon * self.epsilon_decay)

    def save(self, model_path: str | Path = DEFAULT_MODEL_PATH) -> Path:
        target_path = Path(model_path)
        target_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "version": 1,
            "actions": list(ACTIONS),
            "stateEncoding": {
                "day": "exact day number",
                "moisture": ["very_dry", "dry", "optimal", "wet", "waterlogged"],
                "temperature": ["cool", "ideal", "hot"],
                "health": ["critical", "weak", "stable", "strong"],
                "fertilizer": ["due", "wait"],
            },
            "hyperparameters": {
                "learningRate": self.learning_rate,
                "discount": self.discount,
                "epsilon": self.epsilon,
                "epsilonMin": self.epsilon_min,
                "epsilonDecay": self.epsilon_decay,
            },
            "qTable": self.q_table,
        }

        target_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        return target_path

    @classmethod
    def load(cls, model_path: str | Path = DEFAULT_MODEL_PATH) -> "QLearningAgent":
        target_path = Path(model_path)
        payload = json.loads(target_path.read_text(encoding="utf-8"))
        hyperparameters = payload.get("hyperparameters", {})

        agent = cls(
            learning_rate=hyperparameters.get("learningRate", 0.25),
            discount=hyperparameters.get("discount", 0.92),
            epsilon=hyperparameters.get("epsilon", 0.0),
            epsilon_min=hyperparameters.get("epsilonMin", 0.05),
            epsilon_decay=hyperparameters.get("epsilonDecay", 0.992),
        )
        agent.q_table = {
            state_key: {action: float(value) for action, value in action_values.items()}
            for state_key, action_values in payload.get("qTable", {}).items()
        }
        return agent

    def run_episode(
        self,
        client: BackendSimulationClient,
        crop_id: str,
        *,
        training: bool,
    ) -> EpisodeResult:
        simulation = client.create_simulation(crop_id)["simulation"]
        steps: list[dict[str, Any]] = []

        while simulation["status"] != "complete":
            state_key = encode_state(simulation)
            proposed_action = self.choose_action(state_key, training=training)
            action = apply_safety_rule(simulation, proposed_action)
            response = client.apply_action(simulation["id"], action)
            next_simulation = response["simulation"]
            reward = next_simulation["lastActionSummary"]["scoreDelta"]
            done = next_simulation["status"] == "complete"
            next_state_key = None if done else encode_state(next_simulation)

            if training:
                self.update_q_value(state_key, action, reward, next_state_key, done=done)

            steps.append(
                {
                    "day": simulation["day"],
                    "state": state_key,
                    "action": action,
                    "reward": reward,
                    "nextState": next_state_key,
                }
            )
            simulation = next_simulation

        if training:
            self.decay_epsilon()

        outcome = simulation.get("outcome", {}).get("badge", "Unknown")
        return EpisodeResult(
            crop_id=crop_id,
            score=simulation["score"],
            outcome=outcome,
            steps=steps,
            final_state=simulation,
        )


def build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the GreenLogic Q-learning farm agent.")
    parser.add_argument("--api-base", default=DEFAULT_API_BASE, help="Backend API base URL.")
    parser.add_argument("--crop", default="tomato", help="Crop to simulate.")
    parser.add_argument("--model-path", default=str(DEFAULT_MODEL_PATH), help="Path to the Q-table JSON file.")
    parser.add_argument("--episodes", type=int, default=1, help="Number of episodes to run.")
    parser.add_argument("--train", action="store_true", help="Enable Q-table updates during the run.")
    parser.add_argument("--seed", type=int, default=7, help="Random seed for action selection.")
    return parser


def main() -> None:
    args = build_argument_parser().parse_args()
    model_path = Path(args.model_path)

    if model_path.exists():
        agent = QLearningAgent.load(model_path)
        agent.random.seed(args.seed)
        if args.train and agent.epsilon == 0.0:
            agent.epsilon = 1.0
    else:
        agent = QLearningAgent(seed=args.seed)

    client = BackendSimulationClient(args.api_base)

    for episode_number in range(1, args.episodes + 1):
        result = agent.run_episode(client, args.crop, training=args.train)
        print(
            f"Episode {episode_number:03d} | crop={result.crop_id} | "
            f"score={result.score:4d} | outcome={ascii_safe(result.outcome)} | epsilon={agent.epsilon:.3f}"
        )

    agent.save(model_path)


if __name__ == "__main__":
    main()
