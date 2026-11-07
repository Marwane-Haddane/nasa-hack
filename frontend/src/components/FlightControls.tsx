import React, { useState } from 'react';
import { Sliders, Camera, Wind, Eye } from 'lucide-react';
import { wsClient } from '../services/websocket';
import { CameraMode, VisualizerConfig } from '../types/visualizer';
import { FlightControlMode } from '../types/telemetry';

interface FlightControlsProps {
  config: VisualizerConfig;
  onConfigChange: (newConfig: Partial<VisualizerConfig>) => void;
}

export const FlightControls: React.FC<FlightControlsProps> = ({ config, onConfigChange }) => {
  const [controlMode, setControlMode] = useState<FlightControlMode>('AI');
  const [manualThrottle, setManualThrottle] = useState(0.4);
  const [manualPitch, setManualPitch] = useState(0.0);
  const [manualYaw, setManualYaw] = useState(0.0);
  const [disturbance, setDisturbance] = useState(0.0);

  const handleModeToggle = (mode: FlightControlMode) => {
    setControlMode(mode);
    if (mode === 'MANUAL') {
      wsClient.sendCommand({
        mode,
        throttle: manualThrottle,
        gimbal_pitch: manualPitch,
        gimbal_yaw: manualYaw,
        disturbance_vector: [disturbance, disturbance * 0.4]
      });
    } else {
      wsClient.sendCommand({ mode });
    }
  };

  const handleThrottleChange = (val: number) => {
    setManualThrottle(val);
    wsClient.sendCommand({ throttle: val });
  };

  const handleGimbalPitchChange = (val: number) => {
    setManualPitch(val);
    wsClient.sendCommand({ gimbal_pitch: val });
  };

  const handleGimbalYawChange = (val: number) => {
    setManualYaw(val);
    wsClient.sendCommand({ gimbal_yaw: val });
  };

  const handleDisturbanceChange = (val: number) => {
    setDisturbance(val);
    wsClient.sendCommand({ disturbance_vector: [val, val * 0.4] });
  };

  const cameraOptions: { mode: CameraMode; label: string }[] = [
    { mode: 'CHASE', label: 'CHASE' },
    { mode: 'COCKPIT', label: 'COCKPIT' },
    { mode: 'ORBIT', label: 'ORBIT' },
    { mode: 'LANDING_PAD', label: 'PAD' }
  ];

  return (
    <div className="aerospace-panel rounded-lg p-3 text-xs font-mono text-slate-300 w-80 space-y-3">
      <div className="flex items-center justify-between border-b border-sky-500/20 pb-1.5">
        <div className="flex items-center space-x-1.5 text-sky-400 font-bold">
          <Sliders className="w-3.5 h-3.5" />
          <span>FLIGHT & VISUAL CONTROLS</span>
        </div>
      </div>

      {/* Manual Pilot vs AI Autopilot Toggle */}
      <div>
        <div className="flex justify-between items-center text-[11px] mb-1 text-slate-300">
          <span>FLIGHT AUTHORITY:</span>
          <span className={controlMode === 'AI' ? 'text-sky-400 font-bold' : 'text-amber-400 font-bold'}>
            {controlMode === 'AI' ? 'AI AUTONOMOUS' : 'MANUAL PILOT'}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={() => handleModeToggle('AI')}
            className={`py-1.5 rounded font-bold text-center transition-all ${
              controlMode === 'AI'
                ? 'bg-sky-500/30 border border-sky-400 text-sky-200'
                : 'bg-slate-900 border border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            AI AUTOPILOT
          </button>
          <button
            onClick={() => handleModeToggle('MANUAL')}
            className={`py-1.5 rounded font-bold text-center transition-all ${
              controlMode === 'MANUAL'
                ? 'bg-amber-500/30 border border-amber-400 text-amber-200'
                : 'bg-slate-900 border border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            MANUAL PILOT
          </button>
        </div>
      </div>

      {/* Manual Controls Sliders (when manual active) */}
      {controlMode === 'MANUAL' && (
        <div className="space-y-2 bg-slate-950/60 p-2 rounded border border-amber-500/30">
          <div>
            <div className="flex justify-between text-[10px] text-slate-400 mb-0.5">
              <span>MANUAL THROTTLE:</span>
              <span className="text-amber-300 font-semibold">{Math.round(manualThrottle * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={manualThrottle}
              onChange={(e) => handleThrottleChange(parseFloat(e.target.value))}
              className="w-full accent-amber-400 h-1 bg-slate-800 rounded appearance-none cursor-pointer"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="flex justify-between text-[10px] text-slate-400 mb-0.5">
                <span>PITCH:</span>
                <span className="text-amber-300">{manualPitch.toFixed(1)}°</span>
              </div>
              <input
                type="range"
                min="-20"
                max="20"
                step="1"
                value={manualPitch}
                onChange={(e) => handleGimbalPitchChange(parseFloat(e.target.value))}
                className="w-full accent-amber-400 h-1 bg-slate-800 rounded appearance-none cursor-pointer"
              />
            </div>
            <div>
              <div className="flex justify-between text-[10px] text-slate-400 mb-0.5">
                <span>YAW:</span>
                <span className="text-amber-300">{manualYaw.toFixed(1)}°</span>
              </div>
              <input
                type="range"
                min="-20"
                max="20"
                step="1"
                value={manualYaw}
                onChange={(e) => handleGimbalYawChange(parseFloat(e.target.value))}
                className="w-full accent-amber-400 h-1 bg-slate-800 rounded appearance-none cursor-pointer"
              />
            </div>
          </div>
        </div>
      )}

      {/* Camera Mode Selector */}
      <div>
        <div className="flex items-center space-x-1 text-[11px] text-slate-300 mb-1">
          <Camera className="w-3 h-3 text-sky-400" />
          <span>CAMERA PERSPECTIVE:</span>
        </div>
        <div className="grid grid-cols-4 gap-1">
          {cameraOptions.map(({ mode, label }) => (
            <button
              key={mode}
              onClick={() => onConfigChange({ cameraMode: mode })}
              className={`py-1 text-[10px] font-semibold rounded text-center transition-all ${
                config.cameraMode === mode
                  ? 'bg-sky-500/30 border border-sky-400 text-sky-200'
                  : 'bg-slate-900 border border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Disturbance Vector Injection Slider */}
      <div>
        <div className="flex items-center justify-between text-[11px] text-slate-300 mb-1">
          <div className="flex items-center space-x-1">
            <Wind className="w-3 h-3 text-sky-400" />
            <span>DISTURBANCE INJECTION:</span>
          </div>
          <span className="text-sky-300 font-semibold">{disturbance.toFixed(1)} m/s</span>
        </div>
        <input
          type="range"
          min="0"
          max="12"
          step="0.5"
          value={disturbance}
          onChange={(e) => handleDisturbanceChange(parseFloat(e.target.value))}
          className="w-full accent-sky-400 h-1 bg-slate-800 rounded appearance-none cursor-pointer"
        />
      </div>

      {/* Visualizer Layer Toggles */}
      <div className="border-t border-sky-500/20 pt-2 space-y-1.5">
        <div className="flex items-center space-x-1 text-[10px] text-slate-400">
          <Eye className="w-3 h-3 text-sky-400" />
          <span>VISUAL LAYERS:</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5 text-[10px]">
          <label className="flex items-center space-x-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={config.showSlopeHazards}
              onChange={(e) => onConfigChange({ showSlopeHazards: e.target.checked })}
              className="accent-emerald-500 rounded"
            />
            <span>Slope Hazard Coloring</span>
          </label>
          <label className="flex items-center space-x-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={config.showPlume}
              onChange={(e) => onConfigChange({ showPlume: e.target.checked })}
              className="accent-sky-500 rounded"
            />
            <span>Vacuum Plume Shader</span>
          </label>
          <label className="flex items-center space-x-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={config.showDustParticles}
              onChange={(e) => onConfigChange({ showDustParticles: e.target.checked })}
              className="accent-amber-500 rounded"
            />
            <span>Regolith Dust Agitation</span>
          </label>
          <label className="flex items-center space-x-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={config.showTerrainWireframe}
              onChange={(e) => onConfigChange({ showTerrainWireframe: e.target.checked })}
              className="accent-sky-500 rounded"
            />
            <span>Terrain Wireframe</span>
          </label>
        </div>
      </div>
    </div>
  );
};
