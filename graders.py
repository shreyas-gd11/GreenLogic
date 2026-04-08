from __future__ import annotations

from typing import Any

from greenlogic_openenv import MAX_FINAL_SCORE

SCORE_EPSILON = 0.01


def _strict_unit_interval(value: float) -> float:
    return max(SCORE_EPSILON, min(1.0 - SCORE_EPSILON, float(value)))


def _state_like(payload: Any) -> dict[str, Any]:
    if payload is None:
        return {}
    if isinstance(payload, dict):
        if "state" in payload and isinstance(payload["state"], dict):
            return payload["state"]
        return payload
    if hasattr(payload, "to_dict"):
        return payload.to_dict()
    return {}


def _base_score(payload: Any) -> float:
    state = _state_like(payload)
    if "normalizedScore" in state:
        return float(state["normalizedScore"])
    if "totalScore" in state:
        return float(state["totalScore"]) / float(MAX_FINAL_SCORE)
    if "score" in state:
        return float(state["score"]) / float(MAX_FINAL_SCORE)
    return 0.5


class _BaseTaskGrader:
    crop_type: str = ""
    bias: float = 0.0

    def grade(self, payload: Any) -> float:
        state = _state_like(payload)
        score = _base_score(state) + self.bias
        if self.crop_type and state.get("cropType") and state.get("cropType") != self.crop_type:
            score -= 0.05
        return _strict_unit_interval(score)

    def __call__(self, payload: Any) -> float:
        return self.grade(payload)


class EasyGrader(_BaseTaskGrader):
    crop_type = "tomato"
    bias = 0.02


class MediumGrader(_BaseTaskGrader):
    crop_type = "rice"
    bias = 0.0


class HardGrader(_BaseTaskGrader):
    crop_type = "sugarcane"
    bias = -0.02


def easy_grader(payload: Any) -> float:
    return EasyGrader().grade(payload)


def medium_grader(payload: Any) -> float:
    return MediumGrader().grade(payload)


def hard_grader(payload: Any) -> float:
    return HardGrader().grade(payload)
