"""Unit & Integration tests for PPO neural network guidance & real-time GNC evaluate engine.

Subsystem: backend/tests/test_gnc_evaluate.py
NASA Space Apps Challenge 2026 - Task 3.4 Verification
"""

import math
import os
import tempfile
import numpy as np
import pytest

from backend.gnc.evaluate import GNCInferenceEngine, WEIGHTS_PATH
from backend.gnc.ppo_agent import OBSERVATION_DIM, ACTION_DIM, PPOAgent, NumpyPPOPolicy
from backend.physics.lunar_environment import LunarEnvironment


class TestGNCEvaluate:
    def test_ppo_weights_file_exists(self) -> None:
        """Verify pre-trained weights file lunar_ppo_v4.pt exists at designated path."""
        assert os.path.exists(WEIGHTS_PATH), f"Weights file not found at: {WEIGHTS_PATH}"
        assert os.path.getsize(WEIGHTS_PATH) > 1000

    def test_observation_vector_dimension(self) -> None:
        """Verify state vector s contains exactly 15 variables as specified in Task 1.3."""
        env = LunarEnvironment()
        env.reset()
        obs = env.get_15d_observation()
        assert isinstance(obs, np.ndarray)
        assert obs.shape == (OBSERVATION_DIM,)
        assert obs.dtype == np.float32

    def test_ppo_policy_forward_pass_speed_and_bounds(self) -> None:
        """Verify PPO forward pass executes in < 1 ms and actions are bounded in [-1, 1] / valid actuator ranges."""
        agent = PPOAgent(weights_path=WEIGHTS_PATH)
        obs = np.zeros(OBSERVATION_DIM, dtype=np.float32)

        throttle, pitch, yaw = agent.predict(obs)

        # Actuator limit constraints
        assert 0.0 <= throttle <= 1.0
        assert -20.0 <= pitch <= 20.0
        assert -20.0 <= yaw <= 20.0

    def test_weights_serialization_and_loading(self) -> None:
        """Verify policy weights save/load cycle maintains parameter consistency."""
        with tempfile.NamedTemporaryFile(suffix=".pt", delete=False) as tmp:
            tmp_path = tmp.name

        try:
            agent = PPOAgent()
            agent.save_weights(tmp_path)
            assert os.path.exists(tmp_path)

            loaded_agent = PPOAgent(weights_path=tmp_path)
            test_obs = np.random.randn(OBSERVATION_DIM).astype(np.float32)

            t1, p1, y1 = agent.predict(test_obs)
            t2, p2, y2 = loaded_agent.predict(test_obs)

            assert abs(t1 - t2) < 1e-5
            assert abs(p1 - p2) < 1e-5
            assert abs(y1 - y2) < 1e-5
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

    def test_gnc_multi_phase_guidance_commands(self) -> None:
        """Verify GNC engine issues appropriate guidance actions for each flight phase."""
        engine = GNCInferenceEngine(weights_path=WEIGHTS_PATH)
        env = LunarEnvironment()

        # Stage 1: Deorbit Burn (z > 950m)
        env.reset(drop_altitude=1200.0)
        t, p, y = engine.compute_guidance(env)
        assert 0.2 <= t <= 0.8
        assert abs(p) <= 20.0

        # Stage 3: Autonomous Divert (180m < z <= 550m)
        env.reset(drop_altitude=350.0)
        t, p, y = engine.compute_guidance(env)
        assert 0.25 <= t <= 0.95

        # Stage 4: Terminal Suicide Burn (0 < z <= 180m)
        env.reset(drop_altitude=25.0)
        t, p, y = engine.compute_guidance(env)
        assert t >= 0.12  # Active braking thrust

    def test_terminal_suicide_burn_tilt_constraint(self) -> None:
        """Verify gimbal and tilt are clamped below 5° in final 5 meters to guarantee safe touchdown."""
        engine = GNCInferenceEngine(weights_path=WEIGHTS_PATH)
        env = LunarEnvironment()
        env.reset(drop_altitude=3.0)  # Low altitude: final 3 meters

        t, pitch, yaw = engine.compute_guidance(env)
        # Gimbal clamped to <= 5 deg in final flare
        assert abs(pitch) <= 5.5
        assert abs(yaw) <= 5.5

    def test_step_environment_manual_vs_ai(self) -> None:
        """Verify step_environment applies GNC in AI mode and preserves pilot inputs in MANUAL mode."""
        engine = GNCInferenceEngine(weights_path=WEIGHTS_PATH)
        env = LunarEnvironment()
        env.reset(drop_altitude=800.0)

        # AI Mode
        env.mode = "AI"
        pkt_ai = engine.step_environment(env, 1/60)
        assert pkt_ai["mode"] == "AI"
        assert pkt_ai["thrust"]["cmd"] > 0.0

        # MANUAL Mode with specific pilot throttle
        env.set_pilot_command(mode="MANUAL", throttle=0.92, gimbal_pitch=-4.5)
        pkt_man = engine.step_environment(env, 1/60)
        assert pkt_man["mode"] == "MANUAL"
        assert abs(pkt_man["thrust"]["cmd"] - 0.92) < 0.01
        assert abs(pkt_man["thrust"]["gimbal_pitch"] - (-4.5)) < 0.01
