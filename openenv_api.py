from __future__ import annotations

import json
import sys

from greenlogic_models import GreenLogicState, StepResult, Thresholds
from greenlogic_openenv import GreenLogicEnv


def thresholds_from_dict(payload: dict) -> Thresholds:
    return Thresholds(
        optimalMin=float(payload["optimalMin"]),
        optimalMax=float(payload["optimalMax"]),
        low=float(payload["low"]),
        high=float(payload["high"]),
    )


def state_from_dict(payload: dict) -> GreenLogicState:
    return GreenLogicState(
        episodeId=payload["episodeId"],
        stepCount=int(payload["stepCount"]),
        day=int(payload["day"]),
        soilMoisture=float(payload["soilMoisture"]),
        temperature=float(payload["temperature"]),
        cropHealth=float(payload["cropHealth"]),
        cropType=payload["cropType"],
        difficulty=payload["difficulty"],
        rainfall=float(payload["rainfall"]),
        weather=payload["weather"],
        thresholds=thresholds_from_dict(payload["thresholds"]),
        cumulativeReward=float(payload["cumulativeReward"]),
        totalScore=int(payload["totalScore"]),
        done=bool(payload["done"]),
        lastAction=payload.get("lastAction"),
    )


def load_payload() -> dict:
    raw = sys.stdin.read().strip()
    if not raw:
        return {}
    return json.loads(raw)


def emit(result: StepResult, env: GreenLogicEnv) -> None:
    sys.stdout.write(
        json.dumps(
            {
                "result": result.to_dict(),
                "state": env.state().to_dict(),
            }
        )
    )


def main() -> int:
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python openenv_api.py <reset|step|state>")

    command = sys.argv[1]
    payload = load_payload()

    if command == "reset":
      crop_type = payload.get("cropType") or payload.get("crop") or "tomato"
      seed = payload.get("seed")
      env = GreenLogicEnv(crop_type=crop_type, seed=seed)
      result = env.reset(crop_type=crop_type, seed=seed)
      emit(result, env)
      return 0

    if command == "step":
      state_payload = payload.get("state")
      if not state_payload:
          raise SystemExit("Missing state payload for step.")

      action = payload.get("action") or payload.get("move") or payload.get("input")
      if not action:
          raise SystemExit("Missing action payload for step.")

      env = GreenLogicEnv(crop_type=state_payload["cropType"])
      env._state = state_from_dict(state_payload)  # noqa: SLF001 - bridge for stateless API wrapper
      result = env.step(action)
      emit(result, env)
      return 0

    if command == "state":
      state_payload = payload.get("state")
      if not state_payload:
          raise SystemExit("Missing state payload for state.")

      env = GreenLogicEnv(crop_type=state_payload["cropType"])
      env._state = state_from_dict(state_payload)  # noqa: SLF001 - bridge for stateless API wrapper
      sys.stdout.write(json.dumps({"state": env.state().to_dict()}))
      return 0

    raise SystemExit(f"Unsupported command: {command}")


if __name__ == "__main__":
    raise SystemExit(main())
