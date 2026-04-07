from __future__ import annotations

try:
    from flask import Flask, jsonify, request
except ModuleNotFoundError:  # pragma: no cover - validator/install environment should provide Flask
    Flask = None
    jsonify = None
    request = None

from greenlogic_openenv import GreenLogicEnv

app = Flask(__name__) if Flask is not None else None
_sessions: dict[str, GreenLogicEnv] = {}


def _session_id() -> str:
    if request.args.get("sessionId"):
        return request.args["sessionId"]
    if request.is_json:
        payload = request.get_json(silent=True) or {}
        return payload.get("sessionId", "default")
    return "default"


def _serialize_state(env: GreenLogicEnv) -> dict:
    state = env.state()
    return {
        "episodeId": state.episodeId,
        "stepCount": state.stepCount,
        "day": state.day,
        "soilMoisture": state.soilMoisture,
        "temperature": state.temperature,
        "cropHealth": state.cropHealth,
        "cropType": state.cropType,
        "difficulty": state.difficulty,
        "rainfall": state.rainfall,
        "weather": state.weather,
        "thresholds": state.thresholds.to_dict(),
        "cumulativeReward": state.cumulativeReward,
        "totalScore": state.totalScore,
        "done": state.done,
        "lastAction": state.lastAction,
    }


def reset() -> tuple:
    payload = request.get_json(silent=True) or {}
    crop_type = payload.get("cropType") or payload.get("crop") or "tomato"
    seed = payload.get("seed")
    env = GreenLogicEnv(crop_type=crop_type, seed=seed)
    result = env.reset(crop_type=crop_type, seed=seed)
    _sessions[_session_id()] = env
    return jsonify(
        {
            "observation": result.observation.to_dict(),
            "reward": result.reward,
            "done": result.done,
            "info": result.info,
            "state": _serialize_state(env),
        }
    )


def step() -> tuple:
    payload = request.get_json(silent=True) or {}
    env = _sessions.get(_session_id())
    if env is None:
        return jsonify({"error": "OpenEnv session not initialized. Call POST /reset first."}), 400

    action = payload.get("action") or payload.get("move") or payload.get("input")
    if not action:
        return jsonify({"error": "Valid action is required"}), 400

    result = env.step(action)
    return jsonify(
        {
            "observation": result.observation.to_dict(),
            "reward": result.reward,
            "done": result.done,
            "info": result.info,
            "state": _serialize_state(env),
        }
    )


def state() -> tuple:
    env = _sessions.get(_session_id())
    if env is None:
        return jsonify({"error": "OpenEnv session not initialized. Call POST /reset first."}), 400
    return jsonify({"state": _serialize_state(env)})


def health() -> tuple:
    return jsonify({"ok": True})


def main() -> None:
    if app is None:
        raise RuntimeError("Flask is required to run server.app. Install dependencies first.")
    app.run(host="0.0.0.0", port=7860)


if app is not None:
    app.add_url_rule("/reset", "reset", reset, methods=["POST"])
    app.add_url_rule("/step", "step", step, methods=["POST"])
    app.add_url_rule("/state", "state", state, methods=["GET"])
    app.add_url_rule("/health", "health", health, methods=["GET"])


if __name__ == "__main__":
    main()
