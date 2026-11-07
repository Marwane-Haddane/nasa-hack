"""Unit & Integration tests for 6-DOF Lunar vacuum rigid body flight dynamics.

Subsystem: backend/tests/test_lunar_environment.py
NASA Space Apps Challenge 2026 - Task 3.4 Verification
"""

import math
import pytest

from backend.physics.lunar_environment import (
    DRY_MASS,
    G_LUNAR,
    G0,
    INITIAL_FUEL,
    ISP,
    T_MAX,
    LunarEnvironment,
    calculate_tilt_degrees,
    quaternion_to_euler_degrees,
)


class TestLunarEnvironment:
    def test_initial_state_configuration(self) -> None:
        """Verify initial conditions align with Dropper X / Nova-C lunar hopper specifications."""
        env = LunarEnvironment(initial_altitude=1450.0)
        pkt = env.reset()

        assert pkt["position"]["z"] == 1450.0
        assert pkt["fuel"]["mass"] == 650.0
        assert pkt["fuel"]["max_mass"] == 650.0
        assert pkt["fuel"]["percentage"] == 100.0
        assert pkt["mass"]["dry"] == 450.0
        assert pkt["mass"]["total"] == 1100.0
        assert pkt["status"] == "NOMINAL"
        assert pkt["stage"]["id"] == 1
        assert pkt["stage"]["name"] == "Deorbit Burn"
        assert pkt["mode"] == "AI"

    def test_vacuum_lunar_gravity_freefall(self) -> None:
        """Verify acceleration under unpowered freefall is strictly lunar gravity (-1.62 m/s^2)."""
        env = LunarEnvironment(initial_altitude=1450.0)
        env.reset()
        env.throttle = 0.0
        env.mode = "MANUAL"
        env.set_pilot_command(mode="MANUAL", throttle=0.0)

        dt = 0.1
        v0_z = env.vz
        v0_x = env.vx

        env.step(dt)

        # In vacuum: vz(t) = v0 - g*dt, vx(t) = v0_x (zero aerodynamic drag)
        expected_vz = v0_z - G_LUNAR * dt
        assert abs(env.vz - expected_vz) < 1e-3, f"Expected {expected_vz}, got {env.vz}"
        assert abs(env.vx - v0_x) < 1e-4, "Horizontal velocity must remain constant in vacuum with zero thrust"

    def test_propellant_depletion_and_flameout(self) -> None:
        """Verify fuel mass depletion matches rocket equation (mdot = T / (Isp * g0)) and flameout cuts thrust."""
        env = LunarEnvironment(initial_altitude=1450.0)
        env.reset()
        env.mode = "MANUAL"
        env.set_pilot_command(mode="MANUAL", throttle=1.0)  # Max throttle

        dt = 1.0  # 1 second burn
        expected_mdot = T_MAX / (ISP * G0)  # 4500 / (310 * 9.80665) ~ 1.48 kg/s
        initial_fuel = env.mass_fuel

        env.step(dt)

        depleted = initial_fuel - env.mass_fuel
        assert abs(depleted - expected_mdot * dt) < 0.1

        # Force near-zero fuel to test flameout behavior
        env.mass_fuel = 0.5
        env.step(1.0)  # Burn more than 0.5 kg

        assert env.mass_fuel == 0.0
        assert env.throttle == 0.0
        assert env.status == "CRITICAL"

        # Next step must stay at zero fuel and zero throttle
        pkt = env.step(1.0)
        assert pkt["fuel"]["mass"] == 0.0
        assert pkt["thrust"]["newtons"] == 0.0

    def test_touchdown_safe_landing(self) -> None:
        """Verify soft touchdown satisfying all safety criteria (vz <= 2.0, vxy <= 0.5, tilt <= 5°)."""
        env = LunarEnvironment(initial_altitude=10.0)
        env.reset(drop_altitude=1.0)
        env.mode = "MANUAL"

        # Gentle soft-landing kinematic state
        env.x = 0.0
        env.y = 0.0
        env.z = 0.02
        env.vx = 0.1
        env.vy = 0.05
        env.vz = -0.8  # Well under 2.0 m/s
        env.q0 = 1.0
        env.q1 = 0.0
        env.q2 = 0.0
        env.q3 = 0.0

        pkt = env.step(0.1)

        assert env.is_landed is True
        assert env.is_crashed is False
        assert pkt["status"] == "TOUCHDOWN"
        assert pkt["stage"]["id"] == 5
        assert pkt["constraints"]["touchdown_vz_safe"] is True
        assert pkt["constraints"]["touchdown_vxy_safe"] is True
        assert pkt["constraints"]["tilt_safe"] is True

    def test_touchdown_crash_excessive_vertical_speed(self) -> None:
        """Verify crash when vertical descent velocity exceeds 2.0 m/s limit."""
        env = LunarEnvironment(initial_altitude=10.0)
        env.reset(drop_altitude=1.0)
        env.mode = "MANUAL"

        env.x = 0.0
        env.y = 0.0
        env.z = 0.02
        env.vx = 0.0
        env.vy = 0.0
        env.vz = -6.5  # Hard impact > 2.0 m/s

        pkt = env.step(0.1)

        assert env.is_landed is False
        assert env.is_crashed is True
        assert pkt["status"] == "CRASH"
        assert pkt["constraints"]["touchdown_vz_safe"] is False

    def test_touchdown_crash_excessive_tilt(self) -> None:
        """Verify crash when touchdown tilt exceeds 5.0 deg off-axis limit."""
        env = LunarEnvironment(initial_altitude=10.0)
        env.reset(drop_altitude=1.0)
        env.mode = "MANUAL"

        env.x = 0.0
        env.y = 0.0
        env.z = 0.02
        env.vx = 0.1
        env.vy = 0.0
        env.vz = -0.5

        # Set quaternion for ~16° tilt (pitch ~ 16 deg)
        rad = math.radians(16.0)
        env.q0 = math.cos(rad / 2.0)
        env.q1 = 0.0
        env.q2 = math.sin(rad / 2.0)
        env.q3 = 0.0

        pkt = env.step(0.1)

        assert env.is_crashed is True
        assert pkt["status"] == "CRASH"
        assert pkt["constraints"]["tilt_safe"] is False

    def test_multi_phase_flight_stages(self) -> None:
        """Verify stage progression across the 5 lunar landing mission phases."""
        env = LunarEnvironment()

        # Altitude > 950m -> Stage 1: Deorbit Burn
        env.reset(drop_altitude=1200.0)
        assert env.stage_id == 1

        # 550m < z <= 950m -> Stage 2: Ballistic Drift
        env.reset(drop_altitude=750.0)
        assert env.stage_id == 2

        # 180m < z <= 550m -> Stage 3: Autonomous Divert
        env.reset(drop_altitude=350.0)
        assert env.stage_id == 3

        # 0.05m < z <= 180m -> Stage 4: Suicide Burn
        env.reset(drop_altitude=50.0)
        assert env.stage_id == 4

        # z <= 0 at target pad (0, 0) -> Stage 5: Touchdown
        env.reset(drop_altitude=0.0)
        env.x = 0.0
        env.y = 0.0
        env.step(0.1)
        assert env.stage_id == 5

    def test_manual_vs_ai_mode_control(self) -> None:
        """Verify MANUAL mode accepts pilot commands while AI mode overrides actuators."""
        env = LunarEnvironment()
        env.reset()

        # Switch to MANUAL
        env.set_pilot_command(
            mode="MANUAL",
            throttle=0.75,
            gimbal_pitch=-8.5,
            gimbal_yaw=12.0,
            rcs_roll=0.5,
        )

        assert env.mode == "MANUAL"
        assert env.throttle == 0.75
        assert env.gimbal_pitch == -8.5
        assert env.gimbal_yaw == 12.0
        assert env.rcs_roll == 0.5

        # Switch back to AI
        env.set_pilot_command(mode="AI")
        assert env.mode == "AI"

    def test_telemetry_packet_schema_integrity(self) -> None:
        """Verify telemetry packet conforms precisely to frontend TelemetryPacket interface."""
        env = LunarEnvironment()
        pkt = env.reset()

        required_keys = [
            "timestamp", "time_step", "position", "velocity", "quaternion",
            "euler", "angular_velocity", "fuel", "mass", "thrust", "rcs",
            "stage", "status", "constraints", "landing_site", "mode"
        ]
        for key in required_keys:
            assert key in pkt, f"Missing required telemetry key: {key}"

        # Sub-dictionary checks
        assert all(k in pkt["position"] for k in ("x", "y", "z"))
        assert all(k in pkt["velocity"] for k in ("x", "y", "z", "vx", "vy", "vz", "v_xy", "v_total"))
        assert all(k in pkt["quaternion"] for k in ("q0", "q1", "q2", "q3"))
        assert all(k in pkt["euler"] for k in ("roll", "pitch", "yaw", "tilt"))
        assert all(k in pkt["fuel"] for k in ("mass", "max_mass", "percentage", "flow_rate"))
        assert all(k in pkt["constraints"] for k in ("touchdown_vz_safe", "touchdown_vxy_safe", "tilt_safe", "in_descent_cone"))

    def test_manual_gimbal_attitude_tilt(self) -> None:
        """Verify manual gimbal commands rotate attitude quaternion and update tilt angle."""
        env = LunarEnvironment()
        env.reset()
        env.set_pilot_command(mode="MANUAL", throttle=0.5, gimbal_pitch=12.0)
        env.step(0.1)

        euler = quaternion_to_euler_degrees(env.q0, env.q1, env.q2, env.q3)
        assert abs(euler["pitch"]) > 2.0  # Leaned into pitch
        assert calculate_tilt_degrees(env.q0, env.q1, env.q2, env.q3) > 2.0

    def test_pilot_command_sanitization_resilience(self) -> None:
        """Verify set_pilot_command handles non-float and out-of-range inputs gracefully."""
        env = LunarEnvironment()
        env.reset()
        env.mode = "MANUAL"

        # Should not raise any exception
        env.set_pilot_command(
            throttle="invalid_string",  # type: ignore
            gimbal_pitch=None,
            disturbance_vector=["bad", "vec"],  # type: ignore
        )
        assert env.mode == "MANUAL"
        assert env.throttle >= 0.0
