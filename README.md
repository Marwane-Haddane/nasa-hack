# NASA Space Apps Challenge 2026 — NASA-HACK

## Autonomous Lunar Landing Dynamics, WebSocket Bridge & 3D Mission Simulator (Dropper X / Nova-C)

Welcome to the **NASA-HACK** repository for the **NASA Space Apps Challenge 2026** (*Track: Lunar Landing Site Navigator / Space Mission Design Game*).

This monorepo integrates high-fidelity lunar 6-DOF vacuum flight dynamics, AI-driven guidance, navigation, and control (PPO GNC), a 60 Hz real-time asynchronous FastAPI WebSocket telemetry bridge, NASA Moon Trek DEM terrain ingestion for Shackleton Crater, and a browser-native Three.js WebGL visualizer with an aerospace HUD overlay for the **Dropper X** lunar hopper mission to the Lunar South Pole.

---

## Monorepo Architecture & Directory Hierarchy

```
nasa-hack/
├── docker-compose.yml                          # Monorepo container orchestration (backend + frontend)
├── server.py                                   # Single-command unified server entrypoint
├── package.json                                # Monorepo execution & testing scripts
├── pytest.ini                                  # Backend pytest configuration
├── backend/                                    # Member 1 & 3: FastAPI, 6-DOF Physics, PPO GNC
│   ├── Dockerfile                              # Backend container image (Python 3.12-slim)
│   ├── requirements.txt                        # FastAPI, Uvicorn, WebSockets, NumPy, SciPy, PyTest
│   ├── main.py                                 # FastAPI 60 Hz WebSocket streaming server
│   ├── physics/
│   │   ├── __init__.py
│   │   ├── lunar_environment.py                # 6-DOF vacuum equations of motion (RK4 @ 60 Hz)
│   │   └── dem_parser.py                       # NASA Moon Trek GeoTIFF DEM parser & hazard evaluator
│   ├── gnc/
│   │   ├── __init__.py
│   │   ├── ppo_agent.py                        # 15-state PPO neural network policy architecture
│   │   ├── evaluate.py                         # Closed-loop autonomous guidance & manual dispatch
│   │   └── weights/
│   │       └── lunar_ppo_v4.pt                 # Pre-trained neural network flight weights
│   └── tests/                                  # Automated backend pytest test harness
│       ├── test_dem_parser.py                  # DEM GeoTIFF ingestion & slope hazard tests
│       ├── test_lunar_environment.py           # 6-DOF vacuum RK4 physics & touchdown tests
│       ├── test_gnc_evaluate.py                # PPO neural inference & guidance tests
│       ├── test_websocket_bridge.py            # FastAPI WebSocket 60 Hz streaming tests
│       └── test_integration_monorepo.py        # Docker, CI/CD, and server entrypoint tests
├── frontend/                                   # Member 2: WebGL 3D Lunar Visualizer & Telemetry HUD
│   ├── Dockerfile                              # Frontend container image (Node 20-alpine)
│   ├── package.json                            # React 18, Three.js, Lucide, Tailwind, Vite
│   ├── vite.config.ts
│   ├── public/
│   │   └── assets/models/dropper_x.glb         # High-resolution GLTF model of Dropper X lander
│   └── src/
│       ├── components/                         # PFD HUD, flight checklist, 2D trajectory charts
│       ├── graphics/                           # Three.js scene, lighting, terrain, shaders, dust
│       ├── services/                           # WebSocket client (ws://localhost:8000/ws) & fallback
│       ├── tests/                              # Comprehensive Vitest test harness (69 tests)
│       └── types/                              # TelemetryPacket & PilotCommand TypeScript schemas
├── assets/                                     # Mission Assets Register
│   ├── models/
│   │   └── dropper_x.glb                       # High-poly GLTF Lunar Lander model
│   └── dem/
│       └── shackleton_south_pole.tif           # NASA Moon Trek DEM GeoTIFF heightmap
├── .github/
│   └── workflows/
│       └── ci.yml                              # Automated GitHub Actions monorepo CI/CD pipeline
└── NASA Space Apps 2026 — Project Specification & Architecture (NASA-HACK).pdf
```

---

## Subsystem Details

### 1. Monorepo Docker Orchestration & CI/CD Pipeline (Task 3.1)
- **`docker-compose.yml`**: Unified multi-container orchestration deploying `backend` (FastAPI / WebSocket on port `8000`) and `frontend` (Vite / React on port `5173`) with healthchecks and volume bindings.
- **GitHub Actions Workflow (`.github/workflows/ci.yml`)**: Continuous integration testing matrix validating both:
  - `backend-ci`: Python 3.12 environment, runs all pytest unit & integration tests.
  - `frontend-ci`: Node 20 environment, runs all Vitest tests and production bundle build.

### 2. FastAPI 60 Hz WebSocket Telemetry Server (Task 3.2)
- High-frequency asynchronous event loop streaming `TelemetryPacket` JSON payloads at 60 Hz.
- Dual streaming endpoints:
  - `ws://localhost:8000/ws` (frontend visualizer client connection)
  - `ws://localhost:8000/ws/telemetry` (direct telemetry feed)
- HTTP REST API endpoints:
  - `GET /health`: Healthcheck, connection count, and lander flight mode.
  - `GET /api/status`: Instantaneous 6-DOF state snapshot.
  - `GET /api/terrain` & `GET /api/dem`: DEM elevation heightmap and slope hazard classifications.
  - `POST /api/pilot`: Pilot manual actuation command dispatch.
  - `POST /api/reset`: Simulation reset to drop altitude.

### 3. NASA Moon Trek DEM Ingestion & Elevation Parser (Task 3.3)
- Subsystem: `backend/physics/dem_parser.py`
- GeoTIFF elevation parser ingesting Shackleton Crater lunar south pole topography (center 89.9°S, 0.0°E, 2000m x 2000m local area).
- Bilinear interpolation for sub-meter terrain elevation queries $z(x, y)$.
- Central finite difference surface normal vector computation $\hat{n}$.
- NASA 3-tier slope hazard classification:
  - **Safe** ($\le 5.0^\circ$): Emerald Green (`#10b981`)
  - **Caution** ($5.0^\circ - 15.0^\circ$): Amber (`#f59e0b`)
  - **Hazard** ($> 15.0^\circ$): Crimson Red (`#ef4444`)
- Dynamic Three.js `PlaneGeometry` vertex height and slope buffer export.

### 4. 6-DOF Dynamics & PPO GNC Bridge with Manual vs AI Control (Task 3.4)
- **Vacuum Physics Engine (`backend/physics/lunar_environment.py`)**:
  - Lunar gravity $g_{\text{lunar}} = 1.62\text{ m/s}^2$ downward along $-Z$.
  - Vacuum conditions ($\rho = 0, C_d = 0$).
  - Dry mass $m_{\text{dry}} = 450\text{ kg}$, initial fuel $m_{\text{fuel}} = 650\text{ kg}$.
  - Main engine max thrust $4500\text{ N}$, specific impulse $I_{\text{sp}} = 310\text{ s}$.
  - Fuel depletion $\dot{m} = \frac{T}{I_{\text{sp}} g_0}$ with immediate flameout cutoff.
  - Runge-Kutta 4th Order (RK4) numerical integration.
- **PPO Neural Network Policy (`backend/gnc/ppo_agent.py` & `backend/gnc/evaluate.py`)**:
  - 15-variable state vector $\mathbf{s} \to$ 3-variable continuous action $\mathbf{a} = [u_{\text{throttle}}, \delta_{\text{pitch}}, \delta_{\text{yaw}}]$.
  - Zero-overhead pure NumPy policy forward runner for microsecond inference at 60 Hz.
  - Multi-phase mission guidance: Deorbit Burn $\to$ Ballistic Drift $\to$ Autonomous Divert $\to$ Suicide Burn $\to$ Touchdown.
  - Interactive "Manual Pilot vs. AI Autopilot" flight mode toggle via WebSocket.

---

## Quickstart & Single-Command Execution (Task 3.6)

### Option 1: Docker Compose (Monorepo Orchestration)
```bash
docker-compose up --build
```
Access the application:
- Frontend Visualizer: `http://localhost:5173`
- Backend API Docs: `http://localhost:8000/docs`
- 60 Hz WebSocket: `ws://localhost:8000/ws`

### Option 2: Unified Single-Command Host Execution
```bash
# Terminal 1: Launch Backend WebSocket Server
python server.py

# Terminal 2: Launch Frontend Visualizer
npm run dev:frontend
```

---

## Running the Automated Test Harness (Task 3.5)

### Run Backend Tests (PyTest)
```bash
pytest backend/tests -v
```
*Executes 44 tests verifying DEM GeoTIFF ingestion, 6-DOF vacuum physics, PPO neural guidance, and WebSocket streaming.*

### Run Frontend Tests (Vitest)
```bash
cd frontend && npm test
```
*Executes 69 tests verifying Three.js rendering, telemetry HUD, mission checklist state machine, and stress conditions.*

### Run Full Monorepo Tests
```bash
npm test
```
*Runs all 113 automated unit, stress, and integration tests across both frontend and backend.*

---

## Authors & Credits
Developed for the **NASA Space Apps Challenge 2026** by Marwane Haddane & the NASA-HACK Engineering Team.
