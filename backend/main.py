import asyncio
import json
import math

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

app = FastAPI(title="NASA-HACK Telemetry Bridge")

HZ = 60
DT = 1.0 / HZ
G_LUNAR = 1.62
DRY_MASS = 450.0
MAX_FUEL = 650.0
MAX_THRUST_N = 4500.0

STAGES = {
    1: ("Deorbit Burn", "Deorbit impulse toward perilune"),
    2: ("Ballistic Drift", "Unpowered coast, lidar scanning"),
    3: ("Autonomous Divert", "Hazard avoidance and divert"),
    4: ("Suicide Burn", "Terminal deceleration"),
    5: ("Touchdown", "Engine cutoff"),
}


def stage_for(altitude: float) -> int:
    if altitude > 2000:
        return 2
    if altitude > 500:
        return 3
    if altitude > 0.5:
        return 4
    return 5


class MockLander:
    """Fausse physique : sera remplacee par le moteur du Membre 1."""

    def __init__(self):
        self.reset()

    def reset(self):
        self.t = 0.0
        self.step_count = 0
        self.z = 3000.0
        self.vz = 0.0
        self.fuel = MAX_FUEL
        self.mode = "AI"
        self.landed = False
        self.landed_time = 0.0

    def set_mode(self, mode: str):
        if mode in ("AI", "MANUAL"):
            self.mode = mode

    def update(self):
        self.step_count += 1
        self.t += DT
        if self.landed:
            self.landed_time += DT
            if self.landed_time > 5.0:
                mode = self.mode
                self.reset()
                self.mode = mode
            return
        descent_speed = min(60.0, 1.0 + 0.2 * self.z)
        self.vz = -descent_speed
        self.z += self.vz * DT
        self.fuel = max(0.0, self.fuel - 0.5 * DT)
        if self.z <= 0.5:
            self.z = 0.0
            self.vz = 0.0
            self.landed = True

    def packet(self) -> dict:
        total_mass = DRY_MASS + self.fuel
        throttle = 0.0 if self.landed else 0.6
        stage_id = stage_for(self.z)
        stage_name, stage_desc = STAGES[stage_id]
        dist = abs(self.z)
        return {
            "timestamp": round(self.t, 4),
            "time_step": self.step_count,
            "position": {"x": 0.0, "y": 0.0, "z": self.z},
            "velocity": {
                "x": 0.0, "y": 0.0, "z": self.vz,
                "vx": 0.0, "vy": 0.0, "vz": self.vz,
                "v_xy": 0.0, "v_total": abs(self.vz),
            },
            "quaternion": {"q0": 1.0, "q1": 0.0, "q2": 0.0, "q3": 0.0},
            "euler": {"roll": 0.0, "pitch": 0.0, "yaw": 0.0, "tilt": 0.0},
            "angular_velocity": {"wx": 0.0, "wy": 0.0, "wz": 0.0},
            "fuel": {
                "mass": self.fuel,
                "max_mass": MAX_FUEL,
                "percentage": 100.0 * self.fuel / MAX_FUEL,
                "flow_rate": 0.0 if self.landed else 0.5,
            },
            "mass": {"dry": DRY_MASS, "total": total_mass},
            "thrust": {
                "cmd": throttle,
                "percentage": throttle * 100.0,
                "newtons": throttle * MAX_THRUST_N,
                "gimbal_pitch": 0.0,
                "gimbal_yaw": 0.0,
            },
            "rcs": {"roll": 0.0, "pitch": 0.0, "yaw": 0.0, "firing": False},
            "stage": {"id": stage_id, "name": stage_name, "description": stage_desc},
            "status": "TOUCHDOWN" if self.landed else "NOMINAL",
            "constraints": {
                "touchdown_vz_safe": abs(self.vz) <= 2.0,
                "touchdown_vxy_safe": True,
                "tilt_safe": True,
                "in_descent_cone": True,
            },
            "landing_site": {
                "target_x": 0.0, "target_y": 0.0, "target_z": 0.0,
                "distance_to_target": dist,
            },
            "mode": self.mode,
        }


@app.get("/")
def health():
    return {"status": "ok", "websocket": "ws://localhost:8000/ws"}


@app.websocket("/ws")
async def telemetry_ws(ws: WebSocket):
    await ws.accept()
    lander = MockLander()

    async def receive_commands():
        try:
            while True:
                raw = await ws.receive_text()
                cmd = json.loads(raw)
                if "mode" in cmd:
                    lander.set_mode(cmd["mode"])
        except (WebSocketDisconnect, json.JSONDecodeError):
            pass

    receiver = asyncio.create_task(receive_commands())
    try:
        while not receiver.done():
            lander.update()
            await ws.send_text(json.dumps(lander.packet()))
            await asyncio.sleep(DT)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        receiver.cancel()


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)