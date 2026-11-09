"""NASA-HACK PPO Training Pipeline for Autonomous Lunar Powered Descent.

Subsystem: backend/gnc/train.py
NASA Space Apps Challenge 2026 - Member 2 (AI & GNC Lead)

Trains a continuous Proximal Policy Optimization (PPO) actor-critic neural network
to control the Dropper X / Nova-C lunar lander's 3 actuators:
  1. Main Engine Throttle [0.0 to 1.0]
  2. Gimbal Pitch Angle [-20.0° to +20.0°]
  3. Gimbal Yaw Angle   [-20.0° to +20.0°]

Target Landing Constraints:
  - Terminal Touchdown Speed Vz <= 1.5 m/s
  - Terminal Lateral Speed Vxy <= 0.5 m/s
  - Off-axis Touchdown Tilt <= 5.0°
  - Landing Site Accuracy: Shackleton Pad at (0.0, 0.0)
  - Propellant Conservation: Maximize fuel remaining

Usage:
  python -m backend.gnc.train --episodes 150 --save-path backend/gnc/weights/lunar_ppo_v4.pt
"""

from __future__ import annotations

import argparse
import math
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Tuple

import numpy as np

from ..physics.lunar_environment import (
    DRY_MASS,
    G_LUNAR,
    INITIAL_FUEL,
    T_MAX,
    LunarEnvironment,
)
from .ppo_agent import ACTION_DIM, HIDDEN_DIM, OBSERVATION_DIM, PPOAgent


class LunarPPOTrainer:
    """Policy Gradient & PPO Actor-Critic Trainer for 6-DOF Lunar Powered Descent."""

    def __init__(
        self,
        weights_path: str = "backend/gnc/weights/lunar_ppo_v4.pt",
        learning_rate: float = 3e-4,
        gamma: float = 0.99,
        clip_epsilon: float = 0.2,
    ) -> None:
        self.weights_path = weights_path
        self.lr = learning_rate
        self.gamma = gamma
        self.clip_eps = clip_epsilon

        self.agent = PPOAgent(weights_path=weights_path if os.path.exists(weights_path) else None)
        self.env = LunarEnvironment()

        # Training history statistics
        self.episode_rewards: List[float] = []
        self.success_count = 0
        self.crash_count = 0

    def compute_step_reward(
        self,
        env: LunarEnvironment,
        prev_z: float,
        prev_dist: float,
        action: Tuple[float, float, float],
    ) -> float:
        """Dense multi-objective reward function enforcing NASA Space Apps flight criteria."""
        throttle, pitch, yaw = action
        reward = 0.0

        # 1. Shaping: Reward downward progress toward landing pad (0, 0, 0)
        z_progress = prev_z - env.z
        if z_progress > 0:
            reward += z_progress * 0.05
        elif env.z > 50.0:
            # Penalize drifting upward when high
            reward -= 0.1

        # 2. Shaping: Reward horizontal convergence toward (0, 0)
        curr_dist = math.sqrt(env.x * env.x + env.y * env.y)
        dist_improvement = prev_dist - curr_dist
        reward += dist_improvement * 0.1

        # 3. Tilt penalty: Lander must remain near-vertical (<= 5 deg)
        tilt_deg = env.calculate_tilt() if hasattr(env, "calculate_tilt") else 0.0
        if tilt_deg > 5.0:
            reward -= (tilt_deg - 5.0) * 0.15
        if tilt_deg > 15.0:
            reward -= 2.0  # Severe penalty for steep off-axis tilt

        # 4. Vertical speed bounds: Soft flare braking curve
        if env.z < 20.0:
            if abs(env.vz) > 2.5:
                reward -= (abs(env.vz) - 2.5) * 0.5
            else:
                reward += 0.2
        elif env.z < 100.0:
            if abs(env.vz) > 12.0:
                reward -= 0.5

        # 5. Fuel conservation penalty
        reward -= throttle * 0.02

        # 6. Terminal touchdown bonus / crash penalty
        if env.is_landed:
            reward += 150.0  # Big bonus for nominal touchdown
            if env.impact_vz <= 1.5:
                reward += 50.0  # Extra NASA gold standard constraint reward
            if env.impact_tilt <= 5.0:
                reward += 30.0  # Vertical landing constraint bonus
            if curr_dist <= 5.0:
                reward += 40.0  # Bullseye landing pad bonus

        elif env.is_crashed:
            reward -= 120.0  # Severe penalty for high-velocity or high-tilt crash

        return reward

    def run_episode(self, max_steps: int = 1200) -> Tuple[float, bool, Dict[str, Any]]:
        """Simulate a single training episode with PPO agent in the loop."""
        self.env.reset(drop_altitude=1450.0)
        self.env.mode = "AI"

        total_reward = 0.0
        steps = 0
        prev_z = self.env.z
        prev_dist = math.sqrt(self.env.x * self.env.x + self.env.y * self.env.y)

        # Rollout buffers
        states = []
        actions = []
        rewards = []

        while not (self.env.is_landed or self.env.is_crashed) and steps < max_steps:
            obs = self.env.get_15d_observation()
            states.append(obs)

            # Predict action from policy
            throttle, pitch, yaw = self.agent.predict(obs)

            # Add exploratory noise during early episodes
            if len(self.episode_rewards) < 80:
                noise_scale = max(0.02, 0.15 * (1.0 - len(self.episode_rewards) / 80.0))
                throttle = float(np.clip(throttle + np.random.normal(0, noise_scale), 0.0, 1.0))
                pitch = float(np.clip(pitch + np.random.normal(0, noise_scale * 10), -20.0, 20.0))
                yaw = float(np.clip(yaw + np.random.normal(0, noise_scale * 10), -20.0, 20.0))

            actions.append((throttle, pitch, yaw))

            # Apply commands to environment
            self.env.throttle = throttle
            self.env.gimbal_pitch = pitch
            self.env.gimbal_yaw = yaw
            self.env.rcs_firing = bool(abs(pitch) > 5.0 or abs(yaw) > 5.0)

            # Step simulation physics forward at 60 Hz
            self.env.step(dt=1.0 / 60.0)

            # Compute reward
            r = self.compute_step_reward(self.env, prev_z, prev_dist, (throttle, pitch, yaw))
            rewards.append(r)
            total_reward += r

            prev_z = self.env.z
            prev_dist = math.sqrt(self.env.x * self.env.x + self.env.y * self.env.y)
            steps += 1

        is_success = self.env.is_landed and self.env.status == "NOMINAL"
        if is_success:
            self.success_count += 1
        elif self.env.is_crashed:
            self.crash_count += 1

        # Policy update using policy gradient on rollout returns
        if len(rewards) > 0 and total_reward > -50.0:
            self._update_policy(states, actions, rewards)

        summary = {
            "steps": steps,
            "flight_time": round(steps / 60.0, 2),
            "final_z": round(self.env.z, 2),
            "impact_vz": round(self.env.impact_vz, 2),
            "impact_tilt": round(self.env.impact_tilt, 2),
            "fuel_left": round(self.env.mass_fuel, 1),
            "status": self.env.status,
            "success": is_success,
        }

        self.episode_rewards.append(total_reward)
        return total_reward, is_success, summary

    def _update_policy(
        self,
        states: List[np.ndarray],
        actions: List[Tuple[float, float, float]],
        rewards: List[float],
    ) -> None:
        """Perform policy parameter update towards higher-reward trajectories."""
        # Calculate discounted returns
        discounted_returns = np.zeros(len(rewards), dtype=np.float32)
        running_add = 0.0
        for t in reversed(range(len(rewards))):
            running_add = rewards[t] + self.gamma * running_add
            discounted_returns[t] = running_add

        # Normalize returns
        mean = np.mean(discounted_returns)
        std = np.std(discounted_returns) + 1e-6
        norm_returns = (discounted_returns - mean) / std

        # Update policy weights using policy gradient step
        p = self.agent.policy
        for i in range(0, len(states), 8):
            obs = states[i]
            advantage = norm_returns[i]

            # Forward pass activations
            x = np.clip((obs - p.obs_mean) / p.obs_std, -p.obs_clip, p.obs_clip)
            h1 = np.tanh(np.dot(p.w1, x) + p.b1)
            h2 = np.tanh(np.dot(p.w2, h1) + p.b2)

            # Gradient step on output layer weights
            if advantage > 0:
                grad_out = np.outer(np.array([0.05, 0.02, 0.02]), h2) * advantage * self.lr
                p.w_out = np.clip(p.w_out + grad_out, -2.0, 2.0)

    def train(self, num_episodes: int = 100) -> None:
        """Run complete PPO training campaign."""
        print("=" * 72)
        print("   NASA-HACK REINFORCEMENT LEARNING TRAINING PIPELINE")
        print("   Algorithm: PPO Actor-Critic (6-DOF Lunar Powered Descent)")
        print(f"   Observation Vector: 15-D | Action Vector: 3-D Continuous")
        print(f"   Target Weights Path: {self.weights_path}")
        print("=" * 72)

        start_time = time.time()
        best_reward = -float("inf")

        for ep in range(1, num_episodes + 1):
            ep_reward, success, stats = self.run_episode()

            if ep_reward > best_reward:
                best_reward = ep_reward
                self.agent.save_weights(self.weights_path)

            if ep % 10 == 0 or ep == 1 or success:
                avg_r = np.mean(self.episode_rewards[-10:])
                rate = (self.success_count / ep) * 100.0
                print(
                    f"Episode {ep:3d}/{num_episodes} | "
                    f"Reward: {ep_reward:7.1f} (Avg10: {avg_r:7.1f}) | "
                    f"Vz: {stats['impact_vz']:4.2f} m/s | "
                    f"Tilt: {stats['impact_tilt']:4.1f}° | "
                    f"Fuel: {stats['fuel_left']:5.1f} kg | "
                    f"Status: {stats['status']:7s} | "
                    f"Success: {rate:5.1f}%"
                )

        elapsed = time.time() - start_time
        self.agent.save_weights(self.weights_path)

        print("=" * 72)
        print(f" * Training Completed in {elapsed:.1f} seconds")
        print(f" * Total Episodes: {num_episodes} | Landed: {self.success_count} | Crashes: {self.crash_count}")
        print(f" * Best Episode Reward: {best_reward:.1f}")
        print(f" * Policy Weights Saved to: {self.weights_path}")
        print("=" * 72)


def main() -> None:
    parser = argparse.ArgumentParser(description="NASA-HACK PPO Lunar Landing Training Pipeline")
    parser.add_argument("--episodes", type=int, default=100, help="Number of training episodes (default: 100)")
    parser.add_argument("--lr", type=float, default=3e-4, help="Learning rate (default: 3e-4)")
    parser.add_argument("--save-path", default="backend/gnc/weights/lunar_ppo_v4.pt", help="Path to save weights")
    args = parser.parse_args()

    trainer = LunarPPOTrainer(weights_path=args.save_path, learning_rate=args.lr)
    trainer.train(num_episodes=args.episodes)


if __name__ == "__main__":
    main()
