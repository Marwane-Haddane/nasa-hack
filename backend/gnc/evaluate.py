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
from ..physics.dem_parser import dem_parser
from .ppo_agent import PPOAgent

# --- Guidance tuning constants ---
H_ACC = 0.55        # horizontal braking acceleration used for the speed profile (m/s^2)
H_VMAX = 40.0       # max horizontal speed command (m/s)
H_GAIN = 0.8        # horizontal velocity loop gain (1/s)
V_DESCENT_MAX = 25.0  # max descent rate (m/s)
V_GAIN = 1.0        # vertical velocity loop gain (1/s)
PPO_BLEND = 0.0     # weight of the PPO network in the final command (0 = off)

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
        """Closed-loop guidance based on altitude ABOVE GROUND (AGL) and a braking profile.

        Returns: (throttle, gimbal_pitch_deg, gimbal_yaw_deg)
        """
        if env.is_landed or env.is_crashed:
            return 0.0, 0.0, 0.0
        if env.mass_fuel <= 0.0:
            return 0.0, 0.0, 0.0

        total_mass = env.mass_dry + env.mass_fuel

        # PPO policy forward pass (kept as a small residual, see PPO_BLEND)
        obs = env.get_15d_observation()
        ppo_throttle, ppo_pitch, ppo_yaw = self.agent.predict(obs)

        # --- Altitude above ground (the terrain is NOT flat) ---
        terrain_z = dem_parser.get_elevation(env.x, env.y)
        agl = max(0.0, env.z - terrain_z)

        # --- Horizontal guidance: braking profile towards the pad (0, 0) ---
        dist = math.hypot(env.x, env.y)
        if dist > 1e-6:
            ux, uy = -env.x / dist, -env.y / dist
        else:
            ux, uy = 0.0, 0.0
        v_des_mag = min(H_VMAX, math.sqrt(2.0 * H_ACC * max(dist - 2.0, 0.0)))
        if agl < 25.0:
            v_des_mag *= agl / 25.0      # converge to ~0 horizontal speed near the ground
        vdx, vdy = ux * v_des_mag, uy * v_des_mag
        ax_cmd = float(np.clip(H_GAIN * (vdx - env.vx), -1.6, 1.6))
        ay_cmd = float(np.clip(H_GAIN * (vdy - env.vy), -1.6, 1.6))

        # --- Vertical guidance: descent-rate profile vs AGL ---
        if agl > 40.0:
            vz_target = -min(V_DESCENT_MAX, math.sqrt(2.0 * 0.8 * (agl - 40.0)) + 3.0)
        else:
            vz_target = -(0.5 + 0.065 * agl)
        az_cmd = V_GAIN * (vz_target - env.vz)

        # Gimbal limit (also keeps the final tilt below 5 deg)
        if agl < 20.0:
            gmax = 5.0
        elif agl < 40.0:
            gmax = 8.0
        else:
            gmax = 20.0

        # First estimate: throttle for the vertical axis
        thr_v = total_mass * (G_LUNAR + az_cmd) / T_MAX
        # While high and still descending, allow extra thrust to brake sideways
        a_lat = math.hypot(ax_cmd, ay_cmd)
        thr_lat = total_mass * a_lat / (T_MAX * math.sin(math.radians(gmax)))
        if agl > 250.0 and env.vz < -1.0:
            throttle = max(thr_v, min(thr_lat, 0.8))
        else:
            throttle = thr_v
        throttle = float(np.clip(throttle, 0.0, 1.0))

        # Gimbal from lateral acceleration command: a = T/m * sin(gimbal)
        thrust = max(throttle * T_MAX, 1.0)
        sp = float(np.clip(ax_cmd * total_mass / thrust, -1.0, 1.0))
        sy = float(np.clip(ay_cmd * total_mass / thrust, -1.0, 1.0))
        pitch = float(np.clip(math.degrees(math.asin(sp)), -gmax, gmax))
        yaw = float(np.clip(math.degrees(math.asin(sy)), -gmax, gmax))

        if env.stage_id == 5:
            return 0.0, 0.0, 0.0

        # Re-compute vertical throttle taking gimbal cosine into account
        cos_g = max(0.5, math.cos(math.radians(pitch)) * math.cos(math.radians(yaw)))
        if not (agl > 250.0 and env.vz < -1.0 and throttle > thr_v):
            throttle = float(np.clip(total_mass * (G_LUNAR + az_cmd) / (T_MAX * cos_g), 0.0, 1.0))

        # Small residual from the PPO network (PPO_BLEND = 0 -> pure closed-loop guidance)
        b = PPO_BLEND if agl > 40.0 else 0.0
        blended_throttle = float(np.clip((1 - b) * throttle + b * ppo_throttle, 0.0, 1.0))
        blended_pitch = float(np.clip((1 - b) * pitch + b * ppo_pitch, -gmax, gmax))
        blended_yaw = float(np.clip((1 - b) * yaw + b * ppo_yaw, -gmax, gmax))
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
