/**
 * NASA-HACK Lunar Lander Telemetry Specification
 * Fully aligns with Task 1 (AI, GNC & Lunar Flight Dynamics) & Task 3 (WebSocket Bridge)
 */

export type MissionPhaseId = 1 | 2 | 3 | 4 | 5;

export type MissionPhaseName =
  | 'Deorbit Burn'
  | 'Ballistic Drift'
  | 'Autonomous Divert'
  | 'Suicide Burn'
  | 'Touchdown';

export type FlightStatus =
  | 'NOMINAL'
  | 'WARNING'
  | 'CRITICAL'
  | 'TOUCHDOWN'
  | 'CRASH';

export type FlightControlMode = 'AI' | 'MANUAL';

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface VelocityVector extends Vector3D {
  vx: number;
  vy: number;
  vz: number;
  v_xy: number;
  v_total: number;
}

export interface QuaternionOrientation {
  q0: number; // w (scalar)
  q1: number; // x
  q2: number; // y
  q3: number; // z
}

export interface EulerOrientation {
  roll: number;  // degrees
  pitch: number; // degrees
  yaw: number;   // degrees
  tilt: number;  // off-axis inclination relative to lunar vertical in degrees
}

export interface AngularVelocity {
  wx: number; // rad/s
  wy: number; // rad/s
  wz: number; // rad/s
}

export interface FuelState {
  mass: number;       // kg
  max_mass: number;   // 650.0 kg
  percentage: number; // 0.0 - 100.0%
  flow_rate: number;  // kg/s
}

export interface MassProperties {
  dry: number;   // 450.0 kg
  total: number; // dry + fuel mass in kg
}

export interface ThrustState {
  cmd: number;          // normalized throttle command [0.0 - 1.0]
  percentage: number;   // [0.0 - 100.0%]
  newtons: number;      // Instantaneous thrust force (0.0 to 4500.0 N)
  gimbal_pitch: number; // degrees [-20.0 to +20.0]
  gimbal_yaw: number;   // degrees [-20.0 to +20.0]
}

export interface RCSState {
  roll: number;
  pitch: number;
  yaw: number;
  firing: boolean;
}

export interface FlightStage {
  id: MissionPhaseId;
  name: MissionPhaseName;
  description: string;
}

export interface TouchdownConstraints {
  touchdown_vz_safe: boolean;   // vz <= 2.0 m/s (precision target <= 1.5 m/s)
  touchdown_vxy_safe: boolean;  // vxy <= 0.5 m/s
  tilt_safe: boolean;           // tilt <= 5.0 deg
  in_descent_cone: boolean;     // cone angle <= 15.0 deg
}

export interface LandingSite {
  target_x: number;
  target_y: number;
  target_z: number;
  distance_to_target: number;
}

/**
 * Standardized 60 Hz Telemetry Packet transmitted over WebSocket
 */
export interface TelemetryPacket {
  timestamp: number;          // Mission elapsed time (seconds)
  time_step: number;          // Physics integration counter
  position: Vector3D;
  velocity: VelocityVector;
  quaternion: QuaternionOrientation;
  euler: EulerOrientation;
  angular_velocity: AngularVelocity;
  fuel: FuelState;
  mass: MassProperties;
  thrust: ThrustState;
  rcs: RCSState;
  stage: FlightStage;
  status: FlightStatus;
  constraints: TouchdownConstraints;
  landing_site: LandingSite;
  mode: FlightControlMode;
}

/**
 * Pilot command sent from client to backend / local simulator
 */
export interface PilotCommand {
  mode?: FlightControlMode;
  throttle?: number;          // 0.0 to 1.0
  gimbal_pitch?: number;      // -20 to +20 degrees
  gimbal_yaw?: number;        // -20 to +20 degrees
  rcs_roll?: number;          // -1.0 to 1.0
  disturbance_vector?: [number, number]; // Wind/drift injection in m/s [Wx, Wy]
  command?: string;           // Special commands (e.g. 'reset')
  drop_altitude?: number;     // Drop altitude for reset in meters
}

/**
 * Historical telemetry point for 2D descent path plotting
 */
export interface TrajectoryPoint {
  time: number;
  x: number;
  y: number;
  altitude: number;
  vz: number;
  tilt: number;
}
