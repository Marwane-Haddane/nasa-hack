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

        # POST /api/reset (query parameter)
        res_reset = client.post("/api/reset?drop_altitude=1600.0")
        assert res_reset.status_code == 200
        assert res_reset.json()["status"] == "reset"
        assert sim_manager.env.z == 1600.0

        # POST /api/reset (JSON body)
        res_reset_body = client.post("/api/reset", json={"drop_altitude": 1850.0})
        assert res_reset_body.status_code == 200
        assert res_reset_body.json()["status"] == "reset"
        assert sim_manager.env.z == 1850.0

    def test_websocket_invalid_input_resilience(self) -> None:
        """Verify WebSocket server does not crash or disconnect when receiving malformed pilot inputs."""
        client = TestClient(app)
        with client.websocket_connect("/ws") as ws:
            _ = ws.receive_json()

            # Send invalid types
            ws.send_text(json.dumps({"throttle": "not-a-number", "disturbance_vector": ["x", "y"]}))
            time.sleep(0.05)

            # Send malformed string
            ws.send_text("THIS IS NOT JSON")
            time.sleep(0.05)

            # Connection must remain alive and accept subsequent valid command
            ws.send_text(json.dumps({"mode": "MANUAL", "throttle": 0.55}))
            time.sleep(0.05)
            assert sim_manager.env.mode == "MANUAL"
            assert abs(sim_manager.env.throttle - 0.55) < 0.01

    def test_websocket_auto_reset_on_new_connection_after_terminal_state(self) -> None:
        """Verify that when a client connects to an already-finished flight, it auto-resets cleanly."""
        # Simulate previous finished crash
        sim_manager.env.is_crashed = True
        sim_manager.env.status = "CRASH"
        sim_manager.env.z = 0.0

        client = TestClient(app)
        with client.websocket_connect("/ws") as ws:
            pkt = ws.receive_json()
            assert pkt["status"] == "NOMINAL"
            assert pkt["position"]["z"] > 1000.0
            assert pkt["stage"]["id"] == 1

    def test_frontend_app_serving(self) -> None:
        """Verify FastAPI serves the production 3D visualizer at / and metadata at /api."""
        client = TestClient(app)
        res_api = client.get("/api")
        assert res_api.status_code == 200
        assert "endpoints" in res_api.json()

        res_root = client.get("/")
        assert res_root.status_code == 200
        # When dist is built, serves HTML
        assert "html" in res_root.headers.get("content-type", "").lower() or "project" in res_root.text

    def test_concurrent_websocket_clients(self) -> None:
        """Verify multiple simultaneous WebSocket connections receive telemetry concurrently."""
        client = TestClient(app)
        with client.websocket_connect("/ws") as ws1:
            with client.websocket_connect("/ws/telemetry") as ws2:
                pkt1 = ws1.receive_json()
                pkt2 = ws2.receive_json()
                assert isinstance(pkt1, dict)
                assert isinstance(pkt2, dict)
                assert "timestamp" in pkt1
                assert "timestamp" in pkt2
