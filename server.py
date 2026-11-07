"""NASA-HACK Unified Server Entrypoint.

Usage:
    python server.py [--host 0.0.0.0] [--port 8000] [--no-reload]

Provides single-command backend startup for NASA Space Apps 2026.
Broadcasts 60 Hz real-time telemetry over WebSockets at /ws and /ws/telemetry.
"""

import argparse
import sys
import uvicorn

def main() -> None:
    parser = argparse.ArgumentParser(description="NASA-HACK Autonomous Lunar Landing Server")
    parser.add_argument("--host", default="0.0.0.0", help="Binding host (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8000, help="Port to listen on (default: 8000)")
    parser.add_argument("--no-reload", action="store_true", help="Disable auto-reload in development")
    args = parser.parse_args()

    print("=" * 70)
    print("   NASA SPACE APPS CHALLENGE 2026 — NASA-HACK")
    print("   Autonomous Lunar Landing Navigator & 3D Mission Simulator")
    print("=" * 70)
    print(f" * FastAPI Server listening on: http://{args.host}:{args.port}")
    print(f" * Interactive Swagger Docs:    http://localhost:{args.port}/docs")
    print(f" * 60 Hz Telemetry WebSocket:   ws://localhost:{args.port}/ws")
    print(f" * Alternate WebSocket Stream:  ws://localhost:{args.port}/ws/telemetry")
    print(f" * Lunar DEM Terrain API:       http://localhost:{args.port}/api/terrain")
    print(f" * Healthcheck & Telemetry:     http://localhost:{args.port}/health")
    print("=" * 70)

    uvicorn.run(
        "backend.main:app",
        host=args.host,
        port=args.port,
        reload=not args.no_reload,
    )

if __name__ == "__main__":
    main()
