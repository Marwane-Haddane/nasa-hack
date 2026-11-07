"""Unit & Integration tests for FastAPI 60 Hz WebSocket streaming bridge and REST API.

Subsystem: backend/tests/test_websocket_bridge.py
NASA Space Apps Challenge 2026 - Task 3.2 & 3.5 Verification
"""

import json
import time
import pytest
from fastapi.testclient import TestClient

from backend.main import app, sim_manager


class TestWebSocketBridge:
    @pytest.fixture(autouse=True)
    def setup_sim(self) -> None:
        """Reset simulation state before each test."""
        sim_manager.env.reset(drop_altitude=1450.0)
        sim_manager.env.mode = "AI"

    def test_healthcheck_endpoint(self) -> None:
        """Verify /health returns 200 OK and nominal bridge metadata."""
        client = TestClient(app)
        res = client.get("/health")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "nominal"
        assert data["bridge"] == "online"
        assert data["broadcast_rate_hz"] == 60
        assert "active_clients" in data

    def test_status_endpoint(self) -> None:
        """Verify /api/status returns instantaneous 6-DOF telemetry snapshot."""
        client = TestClient(app)
        res = client.get("/api/status")
        assert res.status_code == 200
        data = res.json()
        assert "position" in data
        assert "velocity" in data
        assert "fuel" in data
        assert "status" in data

    def test_terrain_dem_endpoint(self) -> None:
        """Verify /api/terrain and /api/dem return DEM mesh data and slope hazard annotations."""
        client = TestClient(app)
        for endpoint in ("/api/terrain", "/api/dem"):
            res = client.get(f"{endpoint}?size=600&segments=15")
            assert res.status_code == 200
            data = res.json()
            assert "metadata" in data
            assert data["metadata"]["source"] == "NASA Moon Trek DEM / Shackleton Crater"
            assert data["metadata"]["segments"] == 15
            assert "vertices" in data
            assert "slopes" in data
            assert "hazards" in data

    def test_websocket_default_endpoint_stream(self) -> None:
        """Verify frontend-standard /ws endpoint establishes connection and streams telemetry packets."""
        client = TestClient(app)
        with client.websocket_connect("/ws") as ws:
            pkt = ws.receive_json()
            assert isinstance(pkt, dict)
            assert "timestamp" in pkt
            assert "position" in pkt
            assert pkt["position"]["z"] > 1000.0
            assert pkt["mode"] == "AI"

    def test_websocket_explicit_telemetry_endpoint_stream(self) -> None:
        """Verify specification /ws/telemetry endpoint establishes connection and streams telemetry."""
        client = TestClient(app)
        with client.websocket_connect("/ws/telemetry") as ws:
            pkt = ws.receive_json()
            assert isinstance(pkt, dict)
            assert "timestamp" in pkt
            assert "position" in pkt
            assert pkt["stage"]["id"] in (1, 2, 3, 4, 5)

    def test_websocket_pilot_commands_roundtrip(self) -> None:
        """Verify WebSocket accepts pilot commands (MANUAL vs AI mode, throttle, gimbal)."""
        client = TestClient(app)
        with client.websocket_connect("/ws") as ws:
            # Receive initial packet
            _ = ws.receive_json()

            # Transmit pilot command switching to MANUAL with specific actuators
            cmd = {
                "mode": "MANUAL",
                "throttle": 0.88,
                "gimbal_pitch": 4.5,
                "gimbal_yaw": -3.2,
                "rcs_roll": 0.2,
                "disturbance_vector": [2.0, 1.0],
            }
            ws.send_text(json.dumps(cmd))

            # Small pause to allow server to process command
            time.sleep(0.05)

            # Verify environment state updated
            assert sim_manager.env.mode == "MANUAL"
            assert abs(sim_manager.env.throttle - 0.88) < 0.01
            assert abs(sim_manager.env.gimbal_pitch - 4.5) < 0.01
            assert abs(sim_manager.env.gimbal_yaw - (-3.2)) < 0.01
            assert sim_manager.env.disturbance_vector == (2.0, 1.0)

    def test_websocket_reset_command(self) -> None:
        """Verify sending a reset command over WebSocket re-initializes simulation altitude."""
        client = TestClient(app)
        with client.websocket_connect("/ws") as ws:
            _ = ws.receive_json()

            # Issue reset command
            ws.send_text(json.dumps({"command": "reset", "drop_altitude": 2200.0}))
            time.sleep(0.05)

            assert sim_manager.env.z == 2200.0
            assert sim_manager.env.time_step == 0

    def test_rest_api_pilot_and_reset(self) -> None:
        """Verify REST HTTP POST /api/pilot and /api/reset endpoints."""
        client = TestClient(app)

        # POST /api/pilot
        res_pilot = client.post("/api/pilot", json={"mode": "MANUAL", "throttle": 0.65, "gimbal_pitch": -2.0})
        assert res_pilot.status_code == 200
        assert res_pilot.json()["status"] == "accepted"
        assert sim_manager.env.mode == "MANUAL"
        assert abs(sim_manager.env.throttle - 0.65) < 0.01

        # POST /api/reset
        res_reset = client.post("/api/reset?drop_altitude=1600.0")
        assert res_reset.status_code == 200
        assert res_reset.json()["status"] == "reset"
        assert sim_manager.env.z == 1600.0
