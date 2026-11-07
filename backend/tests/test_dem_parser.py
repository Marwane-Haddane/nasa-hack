"""Unit & Integration tests for NASA Moon Trek DEM ingestion & elevation parser.

Subsystem: backend/tests/test_dem_parser.py
NASA Space Apps Challenge 2026 - Task 3.3 Verification
"""

import math
import os
import tempfile
import numpy as np
import pytest

from backend.physics.dem_parser import DemParser, dem_parser


class TestDemParser:
    def test_dem_parser_initialization(self) -> None:
        """Verify DEM parser loads valid Shackleton Crater digital elevation model."""
        assert dem_parser is not None
        assert dem_parser.resolution > 50
        assert dem_parser.grid_size == 2000.0
        assert dem_parser.min_elevation < -50.0  # Deep crater bowl
        assert dem_parser.max_elevation > 50.0   # Elevated rim crest

    def test_precision_landing_pad_flattening(self) -> None:
        """Verify the designated landing pad at (0, 0) is level and within safe bounds."""
        origin_elev = dem_parser.get_elevation(0.0, 0.0)
        origin_slope = dem_parser.get_slope_degrees(0.0, 0.0)
        origin_hazard = dem_parser.evaluate_hazard(0.0, 0.0)

        assert abs(origin_elev) < 5.0
        assert origin_slope < 2.0  # Safe for landing (< 5.0 deg)
        assert origin_hazard["status"] == "SAFE"
        assert origin_hazard["safe"] is True
        assert origin_hazard["color"] == "#10b981"

    def test_crater_basin_and_rim_elevations(self) -> None:
        """Verify distinct crater morphological features (basin depth vs rim height)."""
        # Inside crater basin (r = 200m)
        basin_elev = dem_parser.get_elevation(200.0, 0.0)
        # Rim crest (r = 670m)
        rim_elev = dem_parser.get_elevation(670.0, 0.0)

        assert basin_elev < 0.0, "Crater basin must have negative relative elevation"
        assert rim_elev > 50.0, "Crater rim crest must have positive elevation"
        assert rim_elev > basin_elev + 100.0, "Crater wall relief must exceed 100 meters"

    def test_surface_normal_properties(self) -> None:
        """Verify surface normals are unit vectors pointing upward (nz > 0)."""
        test_coords = [(0.0, 0.0), (150.0, -100.0), (600.0, 200.0), (-300.0, 400.0)]
        for x, y in test_coords:
            n = dem_parser.get_normal(x, y)
            assert isinstance(n, np.ndarray)
            assert len(n) == 3
            # Unit vector magnitude check
            norm = np.linalg.norm(n)
            assert abs(norm - 1.0) < 1e-4
            # Must point towards positive vertical (+Z)
            assert n[2] > 0.0

    def test_hazard_classification_thresholds(self) -> None:
        """Verify NASA 3-tier slope hazard thresholds: Safe <= 5°, Caution 5°-15°, Hazard > 15°."""
        # Flat pad site
        safe_eval = dem_parser.evaluate_hazard(0.0, 0.0)
        assert safe_eval["slope_degrees"] <= 5.0
        assert safe_eval["status"] == "SAFE"
        assert safe_eval["color"] == "#10b981"
        assert safe_eval["safe"] is True

        # Steep crater wall site (around r = 620m)
        wall_eval = dem_parser.evaluate_hazard(620.0, 0.0)
        assert wall_eval["status"] in ("CAUTION", "HAZARD")
        if wall_eval["slope_degrees"] > 15.0:
            assert wall_eval["status"] == "HAZARD"
            assert wall_eval["color"] == "#ef4444"
            assert wall_eval["safe"] is False

    def test_threejs_mesh_data_export(self) -> None:
        """Verify export of Three.js PlaneGeometry terrain mesh buffers."""
        export = dem_parser.export_threejs_mesh_data(size=1000.0, segments=20)
        meta = export["metadata"]
        vertices = export["vertices"]
        slopes = export["slopes"]
        hazards = export["hazards"]

        assert meta["size"] == 1000.0
        assert meta["segments"] == 20
        # (segments + 1)^2 vertices, each with [x, y, z] -> (21 * 21) * 3 = 1323
        expected_vertices = 21 * 21 * 3
        assert len(vertices) == expected_vertices
        assert len(slopes) == 21 * 21
        assert len(hazards) == 21 * 21
        assert all(h in (0, 1, 2) for h in hazards)

    def test_geotiff_roundtrip_write_and_load(self) -> None:
        """Verify saving and re-loading GeoTIFF format file."""
        with tempfile.NamedTemporaryFile(suffix=".tif", delete=False) as tmp:
            tmp_path = tmp.name

        try:
            # Save GeoTIFF
            dem_parser.save_geotiff(tmp_path)
            assert os.path.exists(tmp_path)
            assert os.path.getsize(tmp_path) > 1000

            # Load GeoTIFF into a new DemParser
            loaded_parser = DemParser(filepath=tmp_path)
            assert loaded_parser.resolution == dem_parser.resolution
            # Sample point elevation match
            h_orig = dem_parser.get_elevation(50.0, -30.0)
            h_loaded = loaded_parser.get_elevation(50.0, -30.0)
            assert abs(h_orig - h_loaded) < 0.1
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

    def test_mesh_data_caching_performance(self) -> None:
        """Verify export_threejs_mesh_data caches results for instant sub-millisecond repeated queries."""
        import time
        # Prime cache
        _ = dem_parser.export_threejs_mesh_data(size=1200.0, segments=25)

        # Timed subsequent call from cache
        t0 = time.perf_counter()
        cached = dem_parser.export_threejs_mesh_data(size=1200.0, segments=25)
        elapsed = time.perf_counter() - t0

        assert elapsed < 0.01  # Must return from cache in < 10 ms
        assert cached["metadata"]["size"] == 1200.0
        assert (1200.0, 25) in dem_parser._mesh_cache
