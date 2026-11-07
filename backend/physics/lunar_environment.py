"""NASA-HACK 6-DOF Lunar Flight Dynamics Environment.

Subsystem: backend/physics/lunar_environment.py
NASA Space Apps Challenge 2026

Simulates 6-Degree-of-Freedom continuous rigid body flight dynamics for
the Dropper X / Nova-C autonomous lunar drone hopper under true vacuum
lunar environment (g = -1.62 m/s^2, rho = 0, Cd = 0) with RK4 integration,
variable mass depletion, engine gimbaling, RCS thrusters, terrain collision
via DEM parser, and real-time TelemetryPacket serialization.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from .dem_parser import dem_parser

# Lunar Physical Constants
G_LUNAR = 1.62          # m/s^2 downward along -Z
G0 = 9.80665            # Standard terrestrial gravity for rocket Isp (m/s^2)
ISP = 310.0             # Main engine specific impulse (seconds)
T_MAX = 4500.0          # Maximum main engine thrust (Newtons)
DRY_MASS = 450.0        # Lander dry mass (kg)
INITIAL_FUEL = 650.0    # Initial usable propellant mass (kg)
MAX_GIMBAL_DEG = 20.0   # Maximum TVC gimbal deflection (degrees)


def quaternion_to_euler_degrees(q0: float, q1: float, q2: float, q3: float) -> Dict[str, float]:
    """Convert orientation quaternion [q0(w), q1(x), q2(y), q3(z)] to Euler angles and tilt in degrees."""
    # Roll (X-axis rotation)
    sinr_cosp = 2.0 * (q0 * q1 + q2 * q3)
    cosr_cosp = 1.0 - 2.0 * (q1 * q1 + q2 * q2)
    roll = math.atan2(sinr_cosp, cosr_cosp)

    # Pitch (Y-axis rotation)
    sinp = 2.0 * (q0 * q2 - q3 * q1)
    if abs(sinp) >= 1.0:
        pitch = math.copysign(math.pi / 2.0, sinp)
    else:
        pitch = math.asin(sinp)

    # Yaw (Z-axis rotation)
    siny_cosp = 2.0 * (q0 * q3 + q1 * q2)
    cosy_cosp = 1.0 - 2.0 * (q2 * q2 + q3 * q3)
    yaw = math.atan2(siny_cosp, cosy_cosp)

    # Tilt angle from lunar vertical (+Z): cos(tilt) = 1 - 2*(q1^2 + q2^2)
    cos_tilt = max(-1.0, min(1.0, 1.0 - 2.0 * (q1 * q1 + q2 * q2)))
    tilt = math.acos(cos_tilt)

    return {
        "roll": round(math.degrees(roll), 2),
        "pitch": round(math.degrees(pitch), 2),
        "yaw": round(math.degrees(yaw), 2),
        "tilt": round(math.degrees(tilt), 2),
    }


def calculate_tilt_degrees(q0: float, q1: float, q2: float, q3: float) -> float:
    """Calculate off-axis inclination relative to lunar vertical in degrees."""
    cos_tilt = max(-1.0, min(1.0, 1.0 - 2.0 * (q1 * q1 + q2 * q2)))
    return math.degrees(math.acos(cos_tilt))


class LunarEnvironment:
    """6-DOF vacuum rigid-body simulator for lunar lander flight and landing."""

    def __init__(self, initial_altitude: float = 1450.0) -> None:
        self.initial_altitude = initial_altitude
        self.reset(initial_altitude)

    def reset(self, drop_altitude: Optional[float] = None) -> Dict[str, Any]:
        """Reset simulation to initial drop conditions."""
        alt = drop_altitude if drop_altitude is not None else self.initial_altitude

        self.time: float = 0.0
        self.time_step: int = 0

        # Position [x, y, z] (z = altitude in meters)
        self.x: float = -450.0
        self.y: float = 120.0
        self.z: float = float(alt)

        # Velocity [vx, vy, vz] (m/s)
        self.vx: float = 32.0
        self.vy: float = -8.0
        self.vz: float = -18.0

        # Attitude Quaternion [q0(w), q1(x), q2(y), q3(z)]
        self.q0: float = 1.0
        self.q1: float = 0.0
        self.q2: float = 0.0
        self.q3: float = 0.0

        # Angular Velocity [wx, wy, wz] (rad/s)
        self.wx: float = 0.0
        self.wy: float = 0.0
        self.wz: float = 0.0

        # Mass Properties
        self.mass_dry: float = DRY_MASS
        self.mass_fuel: float = INITIAL_FUEL

        # Actuators
        self.throttle: float = 0.15
        self.gimbal_pitch: float = 0.0
        self.gimbal_yaw: float = 0.0
        self.rcs_roll: float = 0.0
        self.rcs_pitch: float = 0.0
        self.rcs_yaw: float = 0.0
        self.rcs_firing: bool = False

        # Environmental Disturbance [wx, wy]
        self.disturbance_vector: Tuple[float, float] = (0.0, 0.0)

        # Mission state
        self.mode: str = "AI"  # "AI" or "MANUAL"
        self.stage_id: int = 1
        self.status: str = "NOMINAL"  # NOMINAL, WARNING, CRITICAL, TOUCHDOWN, CRASH
        self.is_landed: bool = False
        self.is_crashed: bool = False

        # Touchdown metrics
        self.impact_vz: float = 0.0
        self.impact_vxy: float = 0.0
        self.impact_tilt: float = 0.0

        self.update_stage_progression()
        return self.build_telemetry_packet()

    def set_pilot_command(
        self,
        mode: Optional[str] = None,
        throttle: Optional[float] = None,
        gimbal_pitch: Optional[float] = None,
        gimbal_yaw: Optional[float] = None,
        rcs_roll: Optional[float] = None,
        disturbance_vector: Optional[Tuple[float, float]] = None,
    ) -> None:
        """Apply pilot commands from frontend UI or test harness."""
        if mode in ("AI", "MANUAL"):
            self.mode = mode

        if disturbance_vector is not None:
            self.disturbance_vector = (float(disturbance_vector[0]), float(disturbance_vector[1]))

        if self.mode == "MANUAL":
            if throttle is not None:
                self.throttle = max(0.0, min(1.0, float(throttle)))
            if gimbal_pitch is not None:
                self.gimbal_pitch = max(-MAX_GIMBAL_DEG, min(MAX_GIMBAL_DEG, float(gimbal_pitch)))
            if gimbal_yaw is not None:
                self.gimbal_yaw = max(-MAX_GIMBAL_DEG, min(MAX_GIMBAL_DEG, float(gimbal_yaw)))
            if rcs_roll is not None:
                self.rcs_roll = max(-1.0, min(1.0, float(rcs_roll)))

    def update_stage_progression(self) -> None:
        """Universal 5-phase flight stage progression based on vehicle altitude AGL."""
        if self.is_landed or self.is_crashed:
            self.stage_id = 5
            return

        terrain_z = dem_parser.get_elevation(self.x, self.y)
        agl = self.z - terrain_z

        if agl > 950.0:
            self.stage_id = 1  # Deorbit Burn: Retrograde deceleration
        elif agl > 550.0:
            self.stage_id = 2  # Ballistic Drift: Coasting and Lidar scanning
        elif agl > 180.0:
            self.stage_id = 3  # Autonomous Divert: Lateral alignment with target pad (0, 0)
        elif agl > 0.05:
            self.stage_id = 4  # Suicide Burn / Terminal Deceleration
        else:
            self.stage_id = 5  # Touchdown

    def get_15d_observation(self) -> np.ndarray:
        """Construct the 15-variable state vector s for PPO neural network GNC policy.

        Matches Task 1.3 specification:
        1. Altitude error (z - target_z)
        2. Vertical velocity vz
        3. Lateral position x error
        4. Lateral velocity vx
        5. Lateral position y error
        6. Lateral velocity vy
        7. Tilt pitch angle (degrees)
        8. Pitch rate wy
        9. Tilt yaw angle (degrees)
        10. Yaw rate wx
        11. Roll angle (degrees)
        12. Roll rate wz
        13. Usable fuel fraction (mass_fuel / INITIAL_FUEL)
        14. Normalized throttle command
        15. Current flight stage normalized (stage_id / 5.0)
        """
        euler = quaternion_to_euler_degrees(self.q0, self.q1, self.q2, self.q3)
        obs = np.array([
            self.z,
            self.vz,
            self.x,
            self.vx,
            self.y,
            self.vy,
            euler["pitch"],
            self.wy,
            euler["yaw"],
            self.wx,
            euler["roll"],
            self.wz,
            self.mass_fuel / max(1.0, INITIAL_FUEL),
            self.throttle,
            float(self.stage_id) / 5.0,
        ], dtype=np.float32)
        return obs

    def step(self, dt: float = 1.0 / 60.0) -> Dict[str, Any]:
        """Execute one 6-DOF physics integration step using Runge-Kutta 4th Order (RK4)."""
        if self.is_landed or self.is_crashed:
            return self.build_telemetry_packet()

        # Update flight phase
        self.update_stage_progression()

        # Check propellant flameout
        if self.mass_fuel <= 0.0:
            self.mass_fuel = 0.0
            self.throttle = 0.0
            self.status = "CRITICAL"

        total_mass = self.mass_dry + self.mass_fuel
        thrust_n = self.throttle * T_MAX

        # Propellant mass depletion: dM/dt = -T / (Isp * g0)
        mdot = thrust_n / (ISP * G0)
        self.mass_fuel = max(0.0, self.mass_fuel - mdot * dt)

        # Immediate cutoff if fuel exhausted
        if self.mass_fuel <= 0.0:
            self.mass_fuel = 0.0
            self.throttle = 0.0
            self.status = "CRITICAL"
            thrust_n = 0.0

        # Gimbal angles to radians
        pitch_rad = math.radians(self.gimbal_pitch)
        yaw_rad = math.radians(self.gimbal_yaw)

        # Thrust vector components in local body vertical system
        fx_thrust = thrust_n * math.sin(pitch_rad)
        fy_thrust = thrust_n * math.sin(yaw_rad)
        fz_thrust = thrust_n * math.cos(pitch_rad) * math.cos(yaw_rad)

        # Total Accelerations: (Thrust + Disturbance) / Mass + Gravity
        ax = (fx_thrust / total_mass) + (self.disturbance_vector[0] * 0.05)
        ay = (fy_thrust / total_mass) + (self.disturbance_vector[1] * 0.05)
        az = (fz_thrust / total_mass) - G_LUNAR

        # RK4 Translational Integration
        k1_v = np.array([ax, ay, az]) * dt
        k1_r = np.array([self.vx, self.vy, self.vz]) * dt

        k2_v = np.array([ax, ay, az]) * dt
        k2_r = (np.array([self.vx, self.vy, self.vz]) + 0.5 * k1_v) * dt

        k3_v = np.array([ax, ay, az]) * dt
        k3_r = (np.array([self.vx, self.vy, self.vz]) + 0.5 * k2_v) * dt

        k4_v = np.array([ax, ay, az]) * dt
        k4_r = (np.array([self.vx, self.vy, self.vz]) + k3_v) * dt

        dv = (k1_v + 2.0 * k2_v + 2.0 * k3_v + k4_v) / 6.0
        dr = (k1_r + 2.0 * k2_r + 2.0 * k3_r + k4_r) / 6.0

        self.vx += float(dv[0])
        self.vy += float(dv[1])
        self.vz += float(dv[2])

        self.x += float(dr[0])
        self.y += float(dr[1])
        self.z += float(dr[2])

        # Attitude Kinematics:
        # In AI mode, vehicle aligns towards thrust direction.
        # In MANUAL mode, preserve orientation unless RCS / torques act on it.
        if self.mode == "AI":
            target_roll = -self.gimbal_yaw * 0.4
            target_pitch = self.gimbal_pitch * 0.4
            target_yaw = 0.0

            r_rad = math.radians(target_roll)
            p_rad = math.radians(target_pitch)
            y_rad = math.radians(target_yaw)

            # Euler to Quaternion conversion
            c1 = math.cos(r_rad / 2.0)
            s1 = math.sin(r_rad / 2.0)
            c2 = math.cos(p_rad / 2.0)
            s2 = math.sin(p_rad / 2.0)
            c3 = math.cos(y_rad / 2.0)
            s3 = math.sin(y_rad / 2.0)

            self.q0 = c1 * c2 * c3 + s1 * s2 * s3
            self.q1 = s1 * c2 * c3 - c1 * s2 * s3
            self.q2 = c1 * s2 * c3 + s1 * c2 * s3
            self.q3 = c1 * c2 * s3 - s1 * s2 * c3
        elif abs(self.rcs_roll) > 0.01:
            # Integrate RCS roll torque
            droll = math.radians(self.rcs_roll * 15.0 * dt)
            c = math.cos(droll / 2.0)
            s = math.sin(droll / 2.0)
            # Quaternion multiplication with delta roll around X
            new_q0 = self.q0 * c - self.q1 * s
            new_q1 = self.q0 * s + self.q1 * c
            new_q2 = self.q2 * c + self.q3 * s
            new_q3 = -self.q2 * s + self.q3 * c
            norm = math.sqrt(new_q0*new_q0 + new_q1*new_q1 + new_q2*new_q2 + new_q3*new_q3)
            if norm > 0.0:
                self.q0, self.q1, self.q2, self.q3 = new_q0/norm, new_q1/norm, new_q2/norm, new_q3/norm

        # Ground / Terrain Contact Detection
        terrain_elev = dem_parser.get_elevation(self.x, self.y)
        if self.z <= terrain_elev:
            self.z = terrain_elev
            vxy = math.sqrt(self.vx * self.vx + self.vy * self.vy)
            vz_touch = abs(self.vz)
            tilt_angle = calculate_tilt_degrees(self.q0, self.q1, self.q2, self.q3)

            self.impact_vz = vz_touch
            self.impact_vxy = vxy
            self.impact_tilt = tilt_angle

            # NASA Touchdown Safety Verification Limits:
            # vz <= 2.0 m/s (precision target <= 1.5 m/s)
            # vxy <= 0.5 m/s
            # tilt <= 5.0 deg
            is_safe_vz = vz_touch <= 2.0
            is_safe_vxy = vxy <= 0.5
            is_safe_tilt = tilt_angle <= 5.0

            if is_safe_vz and is_safe_vxy and is_safe_tilt:
                self.is_landed = True
                self.status = "TOUCHDOWN"
                self.stage_id = 5
            else:
                self.is_crashed = True
                self.status = "CRASH"
                self.stage_id = 5

            self.vx = 0.0
            self.vy = 0.0
            self.vz = 0.0
            self.throttle = 0.0
            self.gimbal_pitch = 0.0
            self.gimbal_yaw = 0.0

        self.time += dt
        self.time_step += 1

        return self.build_telemetry_packet()

    def build_telemetry_packet(self) -> Dict[str, Any]:
        """Serialize current simulation state into standardized TelemetryPacket JSON schema."""
        v_xy = math.sqrt(self.vx * self.vx + self.vy * self.vy)
        v_total = math.sqrt(self.vx * self.vx + self.vy * self.vy + self.vz * self.vz)
        total_mass = self.mass_dry + self.mass_fuel
        thrust_n = self.throttle * T_MAX
        mdot = thrust_n / (ISP * G0)

        tilt = calculate_tilt_degrees(self.q0, self.q1, self.q2, self.q3)
        euler = quaternion_to_euler_degrees(self.q0, self.q1, self.q2, self.q3)

        stage_names = {
            1: "Deorbit Burn",
            2: "Ballistic Drift",
            3: "Autonomous Divert",
            4: "Suicide Burn",
            5: "Touchdown",
        }

        stage_descs = {
            1: "Perilune orbit transfer retrograde deceleration",
            2: "Unpowered ballistic coast and onboard Lidar mapping",
            3: "Autonomous hazard avoidance and pad intercept vectoring",
            4: "Terminal suicide burn braking and vertical alignment",
            5: "Surface touchdown sequence and post-flight debrief",
        }

        # Safe criteria logic
        if self.is_landed or self.is_crashed:
            vz_safe = self.impact_vz <= 2.0
            vxy_safe = self.impact_vxy <= 0.5
            tilt_safe = self.impact_tilt <= 5.0
        else:
            vz_safe = abs(self.vz) <= (2.0 if self.z < 10.0 else 30.0)
            vxy_safe = v_xy <= 1.0
            tilt_safe = tilt <= 5.0

        # Descent cone constraint: cone angle <= 15 deg from target
        dist_xy = math.sqrt(self.x * self.x + self.y * self.y)
        cone_angle = math.degrees(math.atan2(dist_xy, max(1.0, self.z)))
        in_descent_cone = cone_angle <= 15.0

        # Distance to landing pad origin (0, 0, 0)
        dist_to_target = math.sqrt(self.x * self.x + self.y * self.y + self.z * self.z)

        packet: Dict[str, Any] = {
            "timestamp": round(self.time, 3),
            "time_step": self.time_step,
            "position": {
                "x": round(self.x, 2),
                "y": round(self.y, 2),
                "z": round(self.z, 2),
            },
            "velocity": {
                "x": round(self.vx, 2),
                "y": round(self.vy, 2),
                "z": round(self.vz, 2),
                "vx": round(self.vx, 2),
                "vy": round(self.vy, 2),
                "vz": round(self.vz, 2),
                "v_xy": round(v_xy, 2),
                "v_total": round(v_total, 2),
            },
            "quaternion": {
                "q0": round(self.q0, 4),
                "q1": round(self.q1, 4),
                "q2": round(self.q2, 4),
                "q3": round(self.q3, 4),
            },
            "euler": euler,
            "angular_velocity": {
                "wx": round(self.wx, 4),
                "wy": round(self.wy, 4),
                "wz": round(self.wz, 4),
            },
            "fuel": {
                "mass": round(self.mass_fuel, 2),
                "max_mass": INITIAL_FUEL,
                "percentage": round((self.mass_fuel / max(1.0, INITIAL_FUEL)) * 100.0, 1),
                "flow_rate": round(mdot, 2),
            },
            "mass": {
                "dry": DRY_MASS,
                "total": round(total_mass, 2),
            },
            "thrust": {
                "cmd": round(self.throttle, 3),
                "percentage": round(self.throttle * 100.0, 1),
                "newtons": round(thrust_n, 1),
                "gimbal_pitch": round(self.gimbal_pitch, 2),
                "gimbal_yaw": round(self.gimbal_yaw, 2),
            },
            "rcs": {
                "roll": round(self.rcs_roll, 2),
                "pitch": round(self.rcs_pitch, 2),
                "yaw": round(self.rcs_yaw, 2),
                "firing": bool(abs(self.gimbal_pitch) > 5.0 or abs(self.gimbal_yaw) > 5.0),
            },
            "stage": {
                "id": self.stage_id,
                "name": stage_names.get(self.stage_id, "Deorbit Burn"),
                "description": stage_descs.get(self.stage_id, ""),
            },
            "status": self.status,
            "constraints": {
                "touchdown_vz_safe": vz_safe,
                "touchdown_vxy_safe": vxy_safe,
                "tilt_safe": tilt_safe,
                "in_descent_cone": in_descent_cone,
            },
            "landing_site": {
                "target_x": 0.0,
                "target_y": 0.0,
                "target_z": 0.0,
                "distance_to_target": round(dist_to_target, 2),
            },
            "mode": self.mode,
        }
        return packet
