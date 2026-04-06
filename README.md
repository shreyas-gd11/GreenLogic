# GreenLogic - AI-Powered Agricultural Environment

GreenLogic is a reinforcement learning environment that simulates real-world agricultural decision-making. It allows AI agents to learn optimal crop management strategies using `step()`, `reset()`, and `state()` interactions in an OpenEnv-style loop.

## Features

- Real-world farming simulation
- Q-learning baseline agent
- Explainable AI with mistakes and corrections in the JS demo flow
- Dynamic weather system
- Multi-crop tasks with easy, medium, and hard difficulty levels
- Deterministic evaluation with fixed-seed inference

## State Space

The environment state includes:

- Soil moisture
- Temperature
- Crop health
- Crop type
- Day
- Rainfall and weather condition

## Action Space

The agent can choose one of three actions:

- `water`
- `fertilize`
- `do_nothing`

## Reward Design

The reward is normalized to the range `0.0` to `1.0`.

- Optimal moisture and strong crop health give positive reward
- Overwatering and dry conditions produce penalties
- Partial rewards are awarded at every step, not only at the end
- Reward depends on environment state, not on a hard-coded “correct action”

## Tasks

- Tomato (Easy)
- Rice (Medium)
- Sugarcane (Hard)

Each crop has different moisture thresholds, temperature ranges, fertilizer timing, and drying behavior.

## OpenEnv Compliance

The canonical Python environment implements:

- `reset()`
- `step(action)`
- `state()`

Core files:

- [soilixa_openenv.py](E:/Meta/soilixa_openenv.py)
- [soilixa_models.py](E:/Meta/soilixa_models.py)
- [soilixa_agent.py](E:/Meta/soilixa_agent.py)
- [run_inference.py](E:/Meta/run_inference.py)
- [openenv.yaml](E:/Meta/openenv.yaml)

## Example Output

```text
Crop: Rice (Medium)
Final Score: 287
Normalized Score: 0.72
Result: Good Crop
```

## Run Inference

Run one deterministic evaluation episode:

```bash
python -B run_inference.py --crop tomato
```

Run reproducibility validation:

```bash
python -B run_inference.py --crop rice --runs 3
```

Optional cross-seed check:

```bash
python -B run_inference.py --crop rice --runs 3 --vary-seed
```

## Project Notes

- `openenv.yaml` defines the environment metadata and task difficulty mapping
- The Python path is the canonical evaluation path for compliance and inference
- Docker and deployment files were intentionally left unchanged
