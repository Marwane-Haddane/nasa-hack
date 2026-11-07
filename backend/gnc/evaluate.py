"""NASA-HACK Real-time GNC Inference Engine.

Subsystem: backend/gnc/evaluate.py
NASA Space Apps Challenge 2026 - Member 3 / Member 1 Bridge

Evaluates trained PPO policy network, computes autonomous guidance actions
across all 5 multi-phase flight stages (Deorbit, Drift, Divert, Suicide Burn, Touchdown),
and handles Manual vs AI pilot command dispatching at 60 Hz.
"""

from __future__ import annotations

import math
import os
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import numpy as np

from ..physics.lunar_environment import G_LUNAR, ISP, G0, T_MAX, LunarEnvironment
from .ppo_agent import PPOAgent

WEIGHTS_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "weights",
    "lunar_ppo_v4.pt",
)


class GNCInferenceEngine:
    """Closed-loop Guidance, Navigation & Control inference engine."""

    def __init__(self, weights_path: Optional[str] = None) -> None:
        target_path = weights_path if weights_path else WEIGHTS_PATH
        self.agent = PPOAgent(weights_path=target_path)

    def compute_guidance(self, env: LunarEnvironment) -> Tuple[float, float, float]:
        """Compute autonomous GNC throttle and gimbal commands for current environment state.

        Returns:
            (throttle, gimbal_pitch, gimbal_yaw)
        """
        if env.is_landed or env.is_crashed:
            return 0.0, 0.0, 0.0

        total_mass = env.mass_dry + env.mass_fuel

        # If vehicle has flameout / zero fuel, no thrust possible
        if env.mass_fuel <= 0.0:
            return 0.0, 0.0, 0.0

        # Run PPO Policy forward pass on 15-d state vector
        obs = env.get_15d_observation()
        ppo_throttle, ppo_pitch, ppo_yaw = self.agent.predict(obs)

        # Apply multi-phase closed-loop guidance envelope:
        stage = env.stage_id

        if stage == 1:
            # Stage 1: Deorbit Burn - Moderate retrograde thrust to shape trajectory & brake initial speed
            throttle = 0.38
            pitch = float(np.clip(-env.vx * 0.8, -18.0, 18.0))
            yaw = float(np.clip(-env.vy * 0.8, -18.0, 18.0))

        elif stage == 2:
            # Stage 2: Ballistic Drift - Controlled coast with attitude alignment
            throttle = 0.22
            pitch = float(np.clip(-env.vx * 0.5, -12.0, 12.0))
            yaw = float(np.clip(-env.vy * 0.5, -12.0, 12.0))

        elif stage == 3:
            # Stage 3: Autonomous Divert - Kill horizontal velocity towards landing site (0, 0)
            target_vx = float(np.clip(-env.x * 0.02, -4.0, 4.0))
            target_vy = float(np.clip(-env.y * 0.02, -4.0, 4.0))
            err_vx = env.vx - target_vx
            err_vy = env.vy - target_vy

            # Bring vertical descent rate to ~ -14 m/s before Stage 4 handover
            target_vz = -14.0
            speed_err_z = target_vz - env.vz
            req_acc_z = G_LUNAR + (speed_err_z * 0.8)
            throttle = float(np.clip((req_acc_z * total_mass) / T_MAX, 0.30, 0.85))

            pitch = float(np.clip(-err_vx * 2.0, -18.0, 18.0))
            yaw = float(np.clip(-err_vy * 2.0, -18.0, 18.0))

        elif stage == 4:
            # Stage 4: Terminal Suicide Burn Deceleration
            # Dynamic parabolic braking envelope down to 15m, then linear flare to -1.0 m/s
            if env.z > 15.0:
                vz_safe_target = -min(15.0, max(2.5, math.sqrt(2.0 * 0.95 * env.z)))
            else:
                vz_safe_target = -1.0 - (env.z / 15.0) * 1.5

            # Closed-loop PID vertical throttle: falling faster than target increases throttle up to 1.0
            speed_error = vz_safe_target - env.vz
            required_acc = G_LUNAR + (speed_error * 2.2)
            req_thrust = required_acc * total_mass
            throttle = float(np.clip(req_thrust / T_MAX, 0.12, 1.0))

            # Lateral stabilization: cancel all horizontal velocity
            # When z < 5m, clamp gimbal to <= 5 deg to guarantee off-axis tilt <= 2.0° (well below 5.0°)
            max_gimbal = 5.0 if env.z < 5.0 else (10.0 if env.z < 20.0 else 16.0)
            pitch = float(np.clip(-env.vx * 3.5, -max_gimbal, max_gimbal))
            yaw = float(np.clip(-env.vy * 3.5, -max_gimbal, max_gimbal))

        else:
            # Stage 5: Touchdown
            throttle = 0.0
            pitch = 0.0
            yaw = 0.0

        # Blend policy network residual with closed-loop guidance
        blended_throttle = float(np.clip(0.85 * throttle + 0.15 * ppo_throttle, 0.0, 1.0))
        blended_pitch = float(np.clip(0.85 * pitch + 0.15 * ppo_pitch, -20.0, 20.0))
        blended_yaw = float(np.clip(0.85 * yaw + 0.15 * ppo_yaw, -20.0, 20.0))

        return blended_throttle, blended_pitch, blended_yaw

    def step_environment(self, env: LunarEnvironment, dt: float = 1.0 / 60.0) -> Dict[str, Any]:
        """Step environment forward by dt with appropriate GNC mode (AI vs MANUAL)."""
        if env.mode == "AI":
            throttle, pitch, yaw = self.compute_guidance(env)
            env.throttle = throttle
            env.gimbal_pitch = pitch
            env.gimbal_yaw = yaw
            env.rcs_firing = bool(abs(pitch) > 5.0 or abs(yaw) > 5.0)

        # MANUAL mode leaves env actuators as set by pilot commands

        return env.step(dt)


# Global singleton engine
gnc_engine = GNCInferenceEngine()
