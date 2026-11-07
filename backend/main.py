"""NASA-HACK FastAPI 60 Hz Telemetry Streaming WebSocket Bridge.

Subsystem: backend/main.py
NASA Space Apps Challenge 2026 - Member 3

Features:
- High-frequency 60 Hz asynchronous telemetry broadcast over WebSockets at:
    - /ws
    - /ws/telemetry
- Accepts pilot commands from frontend (MANUAL vs AI toggle, throttle, gimbal, wind)
- NASA Moon Trek DEM terrain ingestion and elevation query REST API (/api/terrain, /api/dem)
- Single-command execution support (python server.py)
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator, Dict, List, Optional, Set

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from backend.gnc.evaluate import gnc_engine
from backend.physics.dem_parser import dem_parser
from backend.physics.lunar_environment import LunarEnvironment

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("nasa_bridge")


class PilotCommandModel(BaseModel):
    """Pydantic model for pilot commands received via WebSocket or HTTP REST."""

    mode: Optional[str] = Field(None, description="'AI' or 'MANUAL'")
    throttle: Optional[float] = Field(None, ge=0.0, le=1.0, description="Normalized throttle [0.0 to 1.0]")
    gimbal_pitch: Optional[float] = Field(None, ge=-20.0, le=20.0, description="Pitch gimbal angle in degrees")
    gimbal_yaw: Optional[float] = Field(None, ge=-20.0, le=20.0, description="Yaw gimbal angle in degrees")
    rcs_roll: Optional[float] = Field(None, ge=-1.0, le=1.0, description="RCS roll control impulse")
    disturbance_vector: Optional[List[float]] = Field(None, description="Wind/drift disturbance [wx, wy]")
    command: Optional[str] = Field(None, description="Special commands (e.g. 'reset')")
    drop_altitude: Optional[float] = Field(None, ge=10.0, le=5000.0, description="Altitude for reset in meters")


class ResetModel(BaseModel):
    """Pydantic model for reset endpoints."""

    drop_altitude: Optional[float] = Field(1450.0, ge=10.0, le=5000.0, description="Drop altitude in meters")


class SimulationManager:
    """Manages 6-DOF physics state, GNC loop, and 60 Hz WebSocket broadcast distribution."""

    def __init__(self) -> None:
        self.env = LunarEnvironment()
        self.active_connections: Set[WebSocket] = set()
        self.lock = asyncio.Lock()
        self.target_fps: float = 60.0
        self.dt: float = 1.0 / self.target_fps
        self.running: bool = False
        self.task: Optional[asyncio.Task] = None
        self.latest_telemetry: Dict[str, Any] = self.env.build_telemetry_packet()

    async def start(self) -> None:
        """Start the 60 Hz broadcast loop."""
        self.running = True
        self.task = asyncio.create_task(self._broadcast_loop())
        logger.info(f"SimulationManager started at {self.target_fps} Hz broadcast rate.")

    async def stop(self) -> None:
        """Stop the broadcast loop."""
        self.running = False
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
        logger.info("SimulationManager stopped.")

    async def connect(self, websocket: WebSocket) -> None:
        """Register a new WebSocket client."""
        await websocket.accept()
        async with self.lock:
            # Auto-reset if lander already completed flight before new client arrived
            if self.env.is_landed or self.env.is_crashed:
                self.latest_telemetry = self.env.reset()
            self.active_connections.add(websocket)
            payload = json.dumps(self.latest_telemetry)
        logger.info(f"WebSocket client connected. Total active clients: {len(self.active_connections)}")
        # Send initial packet immediately upon connection
        try:
            await websocket.send_text(payload)
        except Exception:
            pass

    async def disconnect(self, websocket: WebSocket) -> None:
        """Deregister a WebSocket client."""
        async with self.lock:
            self.active_connections.discard(websocket)
        logger.info(f"WebSocket client disconnected. Total active clients: {len(self.active_connections)}")

    async def apply_command(self, cmd: Dict[str, Any]) -> None:
        """Apply pilot command to simulation state."""
        try:
            async with self.lock:
                if cmd.get("command") == "reset":
                    try:
                        alt = float(cmd.get("drop_altitude", 1450.0))
                    except (ValueError, TypeError):
                        alt = 1450.0
                    self.latest_telemetry = self.env.reset(drop_altitude=alt)
                    logger.info(f"Simulation reset to altitude {alt} m.")
                    return

                mode = cmd.get("mode")
                throttle = cmd.get("throttle")
                gimbal_pitch = cmd.get("gimbal_pitch")
                gimbal_yaw = cmd.get("gimbal_yaw")
                rcs_roll = cmd.get("rcs_roll")
                dist = cmd.get("disturbance_vector")
                dist_tuple = None
                if dist and isinstance(dist, (list, tuple)) and len(dist) >= 2:
                    try:
                        dist_tuple = (float(dist[0]), float(dist[1]))
                    except (ValueError, TypeError):
                        dist_tuple = None

                self.env.set_pilot_command(
                    mode=mode,
                    throttle=throttle,
                    gimbal_pitch=gimbal_pitch,
                    gimbal_yaw=gimbal_yaw,
                    rcs_roll=rcs_roll,
                    disturbance_vector=dist_tuple,
                )
        except Exception as e:
            logger.warning(f"Error applying pilot command {cmd}: {e}")

    async def _broadcast_loop(self) -> None:
        """High-precision 60 Hz physics step and WebSocket JSON broadcast loop."""
        interval = 1.0 / self.target_fps
        while self.running:
            start_time = time.perf_counter()

            async with self.lock:
                clients = list(self.active_connections)

            # Step physics and broadcast when clients are actively observing
            if clients:
                async with self.lock:
                    self.latest_telemetry = gnc_engine.step_environment(self.env, self.dt)
                    payload_str = json.dumps(self.latest_telemetry)

                # Broadcast concurrently to all connected clients
                results = await asyncio.gather(
                    *[client.send_text(payload_str) for client in clients],
                    return_exceptions=True,
                )

                disconnected = [
                    client for client, res in zip(clients, results)
                    if isinstance(res, Exception)
                ]
                if disconnected:
                    async with self.lock:
                        for client in disconnected:
                            self.active_connections.discard(client)

            # Maintain accurate 60 Hz timing
            elapsed = time.perf_counter() - start_time
            sleep_time = max(0.001, interval - elapsed)
            await asyncio.sleep(sleep_time)


sim_manager = SimulationManager()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Lifespan context manager starting and stopping the 60 Hz streaming engine."""
    await sim_manager.start()
    yield
    await sim_manager.stop()


app = FastAPI(
    title="NASA-HACK Autonomous Lunar Landing Navigator & Telemetry Bridge",
    description="60 Hz WebSocket bridge streaming 6-DOF vacuum flight dynamics & DEM terrain models.",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS configuration for browser frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def handle_websocket_stream(websocket: WebSocket) -> None:
    """Universal WebSocket connection handler for telemetry streaming and command reception."""
    await sim_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                cmd_dict = json.loads(data)
                await sim_manager.apply_command(cmd_dict)
            except json.JSONDecodeError:
                logger.warning(f"Received malformed JSON on WebSocket: {data}")
    except WebSocketDisconnect:
        await sim_manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        await sim_manager.disconnect(websocket)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """Default WebSocket endpoint matching frontend/src/services/websocket.ts."""
    await handle_websocket_stream(websocket)


@app.websocket("/ws/telemetry")
async def websocket_telemetry_endpoint(websocket: WebSocket) -> None:
    """Explicit telemetry streaming WebSocket endpoint from project specification."""
    await handle_websocket_stream(websocket)


def get_metadata() -> Dict[str, Any]:
    """Root metadata payload."""
    return {
        "project": "NASA Space Apps Challenge 2026 (NASA-HACK)",
        "track": "Lunar Landing Site Navigator / Space Mission Design Game",
        "subsystem": "Systems Integration & WebSocket Bridge (Member 3)",
        "broadcast_frequency_hz": 60,
        "endpoints": {
            "websocket": ["/ws", "/ws/telemetry"],
            "health": "/health",
            "telemetry_status": "/api/status",
            "terrain_dem": "/api/terrain",
            "pilot_control": "/api/pilot",
            "reset": "/api/reset",
        },
    }


@app.get("/health")
def get_health() -> Dict[str, Any]:
    """Healthcheck endpoint verifying server and physics bridge status."""
    return {
        "status": "nominal",
        "bridge": "online",
        "broadcast_rate_hz": 60,
        "active_clients": len(sim_manager.active_connections),
        "lander_status": sim_manager.latest_telemetry.get("status", "NOMINAL"),
        "flight_mode": sim_manager.latest_telemetry.get("mode", "AI"),
    }


@app.get("/api/status")
def get_telemetry_status() -> Dict[str, Any]:
    """Retrieve instantaneous 6-DOF telemetry packet snapshot."""
    return sim_manager.latest_telemetry


@app.get("/api/terrain")
@app.get("/api/dem")
def get_terrain_dem(size: float = 2000.0, segments: int = 100) -> Dict[str, Any]:
    """Retrieve NASA Moon Trek DEM elevation heightmap and slope hazard map for Shackleton Crater."""
    return dem_parser.export_threejs_mesh_data(size=size, segments=segments)


@app.post("/api/pilot")
async def post_pilot_command(cmd: PilotCommandModel) -> Dict[str, Any]:
    """Apply pilot commands via REST HTTP POST."""
    await sim_manager.apply_command(cmd.model_dump(exclude_none=True))
    return {
        "status": "accepted",
        "current_mode": sim_manager.env.mode,
        "actuators": {
            "throttle": sim_manager.env.throttle,
            "gimbal_pitch": sim_manager.env.gimbal_pitch,
            "gimbal_yaw": sim_manager.env.gimbal_yaw,
            "rcs_roll": sim_manager.env.rcs_roll,
        },
    }


@app.post("/api/reset")
async def post_reset(
    drop_altitude: Optional[float] = None,
    body: Optional[ResetModel] = None,
) -> Dict[str, Any]:
    """Reset simulation to initial drop conditions."""
    alt = 1450.0
    if drop_altitude is not None:
        alt = drop_altitude
    elif body and body.drop_altitude is not None:
        alt = body.drop_altitude
    await sim_manager.apply_command({"command": "reset", "drop_altitude": alt})
    return {"status": "reset", "initial_altitude": alt}


# Mount built production frontend if present (for single-command execution)
FRONTEND_DIST = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "dist"
)
if os.path.exists(FRONTEND_DIST):
    import os.path
    from fastapi.staticfiles import StaticFiles

    @app.get("/api")
    @app.get("/api/info")
    def get_api_info() -> Dict[str, Any]:
        """API metadata endpoint."""
        return get_metadata()

    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
else:
    @app.get("/")
    @app.get("/api")
    @app.get("/api/info")
    def get_root() -> Dict[str, Any]:
        """Root metadata endpoint."""
        return get_metadata()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
