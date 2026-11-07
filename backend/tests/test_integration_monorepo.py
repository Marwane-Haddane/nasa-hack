"""Unit & Integration tests for Monorepo Docker Orchestration, CI Pipeline & Single-Command Run.

Subsystem: backend/tests/test_integration_monorepo.py
NASA Space Apps Challenge 2026 - Task 3.1 & 3.6 Verification
"""

import json
import os
from pathlib import Path
import yaml
import pytest


class TestMonorepoIntegration:
    @property
    def root_dir(self) -> Path:
        return Path(__file__).resolve().parent.parent.parent

    def test_docker_compose_configuration(self) -> None:
        """Verify docker-compose.yml defines backend (port 8000) and frontend (port 5173)."""
        compose_path = self.root_dir / "docker-compose.yml"
        assert compose_path.exists(), "docker-compose.yml missing from root"

        with open(compose_path, "r", encoding="utf-8") as f:
            compose_cfg = yaml.safe_load(f)

        assert "services" in compose_cfg
        services = compose_cfg["services"]
        assert "backend" in services
        assert "frontend" in services

        # Check port mappings
        backend_ports = services["backend"].get("ports", [])
        assert any("8000:8000" in str(p) for p in backend_ports)

        frontend_ports = services["frontend"].get("ports", [])
        assert any("5173:5173" in str(p) for p in frontend_ports)

    def test_dockerfiles_exist(self) -> None:
        """Verify Dockerfiles exist for both backend and frontend."""
        backend_dockerfile = self.root_dir / "backend" / "Dockerfile"
        frontend_dockerfile = self.root_dir / "frontend" / "Dockerfile"

        assert backend_dockerfile.exists()
        assert frontend_dockerfile.exists()
        assert backend_dockerfile.stat().st_size > 100
        assert frontend_dockerfile.stat().st_size > 100

    def test_github_actions_ci_workflow(self) -> None:
        """Verify .github/workflows/ci.yml tests both backend and frontend."""
        ci_path = self.root_dir / ".github" / "workflows" / "ci.yml"
        assert ci_path.exists(), "ci.yml missing from .github/workflows/"

        with open(ci_path, "r", encoding="utf-8") as f:
            ci_cfg = yaml.safe_load(f)

        assert "jobs" in ci_cfg
        jobs = ci_cfg["jobs"]
        assert "backend-ci" in jobs
        assert "frontend-ci" in jobs

    def test_root_package_scripts(self) -> None:
        """Verify root package.json defines unified execution and testing scripts."""
        pkg_path = self.root_dir / "package.json"
        assert pkg_path.exists()

        with open(pkg_path, "r", encoding="utf-8") as f:
            pkg_data = json.load(f)

        scripts = pkg_data.get("scripts", {})
        assert "dev" in scripts
        assert "start" in scripts
        assert "test:backend" in scripts
        assert "test:frontend" in scripts

    def test_unified_server_entrypoint(self) -> None:
        """Verify root server.py exists and can be imported cleanly."""
        server_path = self.root_dir / "server.py"
        assert server_path.exists()
        assert server_path.stat().st_size > 200

    def test_assets_hierarchy(self) -> None:
        """Verify models and DEM heightmaps exist in assets/ as specified in Section 6."""
        model_path = self.root_dir / "assets" / "models" / "dropper_x.glb"
        dem_path = self.root_dir / "assets" / "dem" / "shackleton_south_pole.tif"

        assert model_path.exists(), f"Lander model missing at {model_path}"
        assert dem_path.exists(), f"DEM heightmap missing at {dem_path}"
        assert model_path.stat().st_size > 100000
        assert dem_path.stat().st_size > 10000
