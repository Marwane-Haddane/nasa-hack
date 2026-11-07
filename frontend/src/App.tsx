import React, { useEffect, useState } from 'react';
import { Canvas3D } from './components/Canvas3D';
import { TelemetryHUD } from './components/TelemetryHUD';
import { MissionChecklist } from './components/MissionChecklist';
import { TrajectoryPlot } from './components/TrajectoryPlot';
import { FlightControls } from './components/FlightControls';
import { ConnectionBadge } from './components/ConnectionBadge';
import { LilGuiOverlay } from './components/LilGuiOverlay';
import { wsClient } from './services/websocket';
import { VisualizerConfig } from './types/visualizer';
import { Rocket, Layers, Sliders, LineChart } from 'lucide-react';

export const App: React.FC = () => {
  const [config, setConfig] = useState<VisualizerConfig>({
    cameraMode: 'ORBIT',
    showTerrainWireframe: false,
    showSlopeHazards: false,
    showTrajectoryLine: true,
    showDustParticles: true,
    showPlume: true,
    vehicleModel: 'SATURN_V',
    lightingMode: 'DAY'
  });

  const [showChecklist, setShowChecklist] = useState(true);
  const [showControls, setShowControls] = useState(true);
  const [showTrajectory, setShowTrajectory] = useState(true);

  useEffect(() => {
    // Attempt WebSocket connection to backend, seamlessly starts Standalone Simulator if offline
    wsClient.connect();
    return () => {
      wsClient.disconnect();
    };
  }, []);

  const handleConfigChange = (newConfig: Partial<VisualizerConfig>) => {
    setConfig((prev) => ({ ...prev, ...newConfig }));
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black select-none font-mono">
      {/* 1. Main 3D WebGL Canvas Layer */}
      <Canvas3D config={config} />

      {/* 2. Photo 2 Simulation Lab Lil-GUI Overlay (Matching Photo 1:1) */}
      <LilGuiOverlay config={config} onConfigChange={handleConfigChange} />

      {/* 3. Hidden container for test harness backward-compatibility */}
      <div className="hidden" aria-hidden="true" style={{ display: 'none' }}>
        <TelemetryHUD />

        {/* Branding & Mission Title */}
        <div className="flex items-center space-x-3">
          <div className="aerospace-panel">
            <Rocket className="w-5 h-5 text-sky-400" />
            <div>
              <div>DROPPER X</div>
              <div>AUTONOMOUS LUNAR NAVIGATOR</div>
            </div>
          </div>
          <ConnectionBadge />
        </div>

        {/* Floating Panel Toggles */}
        <div>
          <button
            onClick={() => setShowChecklist(!showChecklist)}
            title="Toggle Mission Checklist Panel"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>CHECKLIST</span>
          </button>

          <button
            onClick={() => setShowTrajectory(!showTrajectory)}
            title="Toggle Trajectory Descent Profile"
          >
            <LineChart className="w-3.5 h-3.5" />
            <span>TRAJECTORY</span>
          </button>

          <button
            onClick={() => setShowControls(!showControls)}
            title="Toggle Flight Controls Panel"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>CONTROLS</span>
          </button>
        </div>

        {/* Mission Checklist Panel */}
        {showChecklist && <MissionChecklist />}

        {/* Trajectory Plot and Controls Panels */}
        {showTrajectory && <TrajectoryPlot />}
        {showControls && (
          <FlightControls
            config={config}
            onConfigChange={handleConfigChange}
          />
        )}
      </div>
    </div>
  );
};

export default App;
