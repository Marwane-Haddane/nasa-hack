import React, { useEffect, useState } from 'react';
import {
  Crosshair,
  Compass,
  AlertCircle,
  Activity,
  Layers,
  Fuel
} from 'lucide-react';
import { telemetryStore } from '../services/telemetryStore';
import { TelemetryPacket } from '../types/telemetry';

export const TelemetryHUD: React.FC = () => {
  const [telemetry, setTelemetry] = useState<TelemetryPacket | null>(telemetryStore.getTelemetry());

  useEffect(() => {
    let lastRender = -1000;
    let lastStatus = '';
    return telemetryStore.subscribeTelemetry((pkt) => {
      const now = performance.now();
      if (now - lastRender >= 30 || pkt.status !== lastStatus) {
        lastRender = now;
        lastStatus = pkt.status;
        setTelemetry(pkt);
      }
    });
  }, []);

  if (!telemetry) {
    return (
      <div className="absolute top-4 left-1/2 -translate-x-1/2 aerospace-panel px-4 py-2 rounded-full text-xs text-sky-400 font-mono animate-pulse">
        ACQUIRING TELEMETRY STREAM...
      </div>
    );
  }

  const {
    timestamp,
    position,
    velocity,
    fuel,
    thrust,
    euler,
    stage,
    status
  } = telemetry;

  // Format Mission Elapsed Time (MET)
  const formatMET = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 100);
    return `T+${String(mins).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
  };

  // Vertical velocity safety styling
  const absVz = Math.abs(velocity.vz);
  let vzColor = 'text-emerald-400';
  let vzBadge = 'SAFE';
  if (absVz > 3.0) {
    vzColor = 'text-red-400 animate-pulse';
    vzBadge = 'CRITICAL';
  } else if (absVz > 1.5) {
    vzColor = 'text-amber-400';
    vzBadge = 'CAUTION';
  }

  // Horizontal velocity safety
  const vxyColor = velocity.v_xy <= 0.5 ? 'text-emerald-400' : 'text-amber-400';

  // Tilt angle safety
  const tiltColor = euler.tilt <= 5.0 ? 'text-emerald-400' : 'text-red-400';

  // Overall status banner styling
  const statusColors: Record<string, string> = {
    NOMINAL: 'border-emerald-500/50 bg-emerald-950/40 text-emerald-400',
    WARNING: 'border-amber-500/50 bg-amber-950/40 text-amber-400 animate-pulse',
    CRITICAL: 'border-red-500/70 bg-red-950/60 text-red-400 animate-pulse',
    TOUCHDOWN: 'border-emerald-400 bg-emerald-900/60 text-emerald-300 font-bold',
    CRASH: 'border-red-600 bg-red-950 text-red-200 font-bold animate-pulse'
  };

  return (
    <div className="pointer-events-none select-none font-mono text-slate-100">
      {/* 1. TOP HEADER BANNER: MET & Flight Status */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center space-x-3 pointer-events-auto">
        <div className="aerospace-panel px-3.5 py-1.5 rounded-lg flex items-center space-x-2 text-xs">
          <Activity className="w-4 h-4 text-sky-400" />
          <span className="text-slate-400">MET:</span>
          <span className="text-sky-300 font-bold text-sm tracking-wider">
            {formatMET(timestamp)}
          </span>
        </div>

        <div className="aerospace-panel px-3.5 py-1.5 rounded-lg flex items-center space-x-2 text-xs">
          <Layers className="w-4 h-4 text-sky-400" />
          <span className="text-slate-400">PHASE:</span>
          <span className="text-sky-200 font-bold">{stage.name.toUpperCase()}</span>
        </div>

        <div
          data-testid="hud-flight-status-badge"
          className={`px-3.5 py-1.5 rounded-lg border flex items-center space-x-1.5 text-xs font-bold tracking-wider ${
            statusColors[status] || statusColors.NOMINAL
          }`}
        >
          <span className="w-2 h-2 rounded-full bg-current" />
          <span>STATUS: {status}</span>
        </div>
      </div>

      {/* 2. LEFT FLIGHT INSTRUMENTS: Moving Altitude Tape */}
      <div className="absolute left-4 top-20 aerospace-panel rounded-lg p-3 text-xs w-48 pointer-events-auto">
        <div className="flex items-center justify-between text-slate-400 border-b border-sky-500/20 pb-1 mb-2">
          <span className="font-semibold text-sky-400">RADAR ALTITUDE</span>
          <span className="text-[10px]">AGL (m)</span>
        </div>

        <div className="text-2xl font-bold tracking-tight text-white mb-2 text-center bg-black/40 py-1.5 rounded border border-sky-500/30">
          <span data-testid="hud-altitude-readout">{position.z.toFixed(1)}</span> <span className="text-xs text-slate-400 font-normal">m</span>
        </div>

        {/* Dynamic Altitude Progress Bar (0 - 1500m) */}
        <div className="w-full bg-slate-900 rounded-full h-2 mb-2 overflow-hidden border border-slate-700">
          <div
            className="bg-sky-400 h-full transition-all duration-100"
            style={{ width: `${Math.min(100, (position.z / 1500) * 100)}%` }}
          />
        </div>

        {/* Ground Proximity Hazard warning */}
        {position.z < 50.0 && position.z > 0 && (
          <div className="bg-amber-950/60 border border-amber-500/40 text-amber-300 px-2 py-0.5 rounded text-[10px] flex items-center justify-center space-x-1 animate-pulse">
            <AlertCircle className="w-3 h-3 text-amber-400" />
            <span>TERRAIN PROXIMITY</span>
          </div>
        )}
      </div>

      {/* 3. RIGHT FLIGHT INSTRUMENTS: Descent Velocities Tape */}
      <div className="absolute right-4 top-20 aerospace-panel rounded-lg p-3 text-xs w-52 pointer-events-auto">
        <div className="flex items-center justify-between text-slate-400 border-b border-sky-500/20 pb-1 mb-2">
          <span className="font-semibold text-sky-400">VELOCITY VECTORS</span>
          <span className="text-[10px]">m/s</span>
        </div>

        {/* Vertical Velocity */}
        <div className="mb-2.5">
          <div className="flex justify-between items-center text-[11px] mb-0.5">
            <span className="text-slate-400">VERTICAL (Vz):</span>
            <span className={`text-[10px] font-bold px-1 rounded bg-black/40 ${vzColor}`}>
              {vzBadge}
            </span>
          </div>
          <div className="text-xl font-bold text-center bg-black/40 py-1 rounded border border-sky-500/30">
            <span data-testid="hud-vz-readout" className={vzColor}>{velocity.vz.toFixed(2)}</span>{' '}
            <span className="text-xs text-slate-400 font-normal">m/s</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5 text-right">
            Limit: ≤ 1.5 m/s
          </div>
        </div>

        {/* Horizontal Speed Magnitude */}
        <div>
          <div className="flex justify-between items-center text-[11px] mb-0.5">
            <span className="text-slate-400">HORIZONTAL (Vxy):</span>
            <span className={`text-[10px] font-bold ${vxyColor}`}>
              {velocity.v_xy <= 0.5 ? 'PASS' : 'WARN'}
            </span>
          </div>
          <div className="text-lg font-bold text-center bg-black/40 py-1 rounded border border-slate-700">
            <span data-testid="hud-vxy-readout" className={vxyColor}>{velocity.v_xy.toFixed(2)}</span>{' '}
            <span className="text-xs text-slate-400 font-normal">m/s</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5 text-right">
            Limit: ≤ 0.5 m/s
          </div>
        </div>
      </div>

      {/* 4. CENTER RETICLE: Artificial Horizon & Tilt Angle Ladder */}
      <div className="absolute top-20 left-1/2 -translate-x-1/2 aerospace-panel rounded-lg p-2.5 text-xs text-center w-56 pointer-events-auto">
        <div className="text-[10px] text-sky-400 font-semibold border-b border-sky-500/20 pb-1 mb-1.5 flex items-center justify-center space-x-1">
          <Compass className="w-3.5 h-3.5" />
          <span>ATTITUDE & TILT</span>
        </div>

        {/* Artificial Horizon Pitch & Roll Indicator */}
        <div className="relative w-32 h-20 mx-auto bg-slate-950/80 rounded border border-sky-500/30 overflow-hidden flex items-center justify-center mb-1.5">
          {/* Horizon Line rotating with roll */}
          <div
            className="absolute w-28 h-0.5 bg-sky-400 transition-transform duration-75"
            style={{
              transform: `translateY(${euler.pitch * 0.8}px) rotate(${-euler.roll}deg)`
            }}
          />
          {/* Pitch Ladder Marks */}
          <div className="absolute text-[8px] text-sky-500/60 -top-1 pointer-events-none">+10°</div>
          <div className="absolute text-[8px] text-sky-500/60 -bottom-1 pointer-events-none">-10°</div>
          {/* Center reticle cross */}
          <div className="w-3 h-3 border-2 border-amber-400 rounded-full" />
        </div>

        <div className="flex justify-around text-[11px]">
          <div>
            <div className="text-[9px] text-slate-400">PITCH</div>
            <div className="font-bold text-slate-200">{euler.pitch.toFixed(1)}°</div>
          </div>
          <div>
            <div className="text-[9px] text-slate-400">ROLL</div>
            <div className="font-bold text-slate-200">{euler.roll.toFixed(1)}°</div>
          </div>
          <div>
            <div className="text-[9px] text-slate-400">TILT</div>
            <div data-testid="hud-tilt-readout" className={`font-bold ${tiltColor}`}>
              {euler.tilt.toFixed(1)}°
            </div>
          </div>
        </div>
      </div>

      {/* 5. BOTTOM INSTRUMENT CONSOLE: Gimbal Crosshair & Propellant Gauge */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center space-x-3 pointer-events-auto">
        {/* Propellant & Mass Monitor */}
        <div className="aerospace-panel rounded-lg p-2.5 text-xs w-60">
          <div className="flex items-center justify-between text-slate-400 border-b border-sky-500/20 pb-1 mb-1.5">
            <div className="flex items-center space-x-1 text-sky-400 font-semibold">
              <Fuel className="w-3.5 h-3.5" />
              <span>PROPELLANT</span>
            </div>
            <span data-testid="hud-fuel-percent" className="text-sky-300 font-bold">
              {fuel.percentage.toFixed(1)}%
            </span>
          </div>

          <div className="w-full bg-slate-900 rounded-full h-2 mb-2 overflow-hidden border border-slate-700">
            <div
              className={`h-full transition-all duration-100 ${
                fuel.percentage < 15.0 ? 'bg-red-500 animate-pulse' : 'bg-emerald-400'
              }`}
              style={{ width: `${fuel.percentage}%` }}
            />
          </div>

          <div className="grid grid-cols-2 gap-1 text-[10px] text-slate-400">
            <div>Mass: <span className="text-slate-200 font-semibold">{fuel.mass.toFixed(1)} kg</span></div>
            <div>Flow: <span className="text-slate-200 font-semibold">{fuel.flow_rate.toFixed(1)} kg/s</span></div>
          </div>
        </div>

        {/* 2-Axis Engine Nozzle Gimbal Reticle (±20°) */}
        <div className="aerospace-panel rounded-lg p-2.5 text-xs w-60">
          <div className="flex items-center justify-between text-slate-400 border-b border-sky-500/20 pb-1 mb-1.5">
            <div className="flex items-center space-x-1 text-sky-400 font-semibold">
              <Crosshair className="w-3.5 h-3.5" />
              <span>NOZZLE GIMBAL (±20°)</span>
            </div>
            <span className="text-[10px] text-slate-400">TVC</span>
          </div>

          <div className="flex items-center space-x-3">
            {/* Gimbal 2-Axis Circular Reticle */}
            <div className="relative w-16 h-16 rounded-full border border-sky-500/40 bg-black/60 flex items-center justify-center">
              <div className="absolute w-full h-[1px] bg-sky-500/20" />
              <div className="absolute h-full w-[1px] bg-sky-500/20" />
              <div className="w-8 h-8 rounded-full border border-sky-500/20" />
              {/* Actuator Dot position */}
              <div
                className="absolute w-2.5 h-2.5 bg-amber-400 rounded-full shadow-lg transition-transform duration-75 -translate-x-1/2 -translate-y-1/2"
                style={{
                  left: `${50 + (thrust.gimbal_yaw / 20.0) * 40}%`,
                  top: `${50 - (thrust.gimbal_pitch / 20.0) * 40}%`
                }}
              />
            </div>

            <div className="text-[10px] space-y-1 text-slate-400 flex-1">
              <div>
                Pitch: <span data-testid="hud-gimbal-pitch" className="text-amber-300 font-bold">{thrust.gimbal_pitch.toFixed(1)}°</span>
              </div>
              <div>
                Yaw: <span data-testid="hud-gimbal-yaw" className="text-amber-300 font-bold">{thrust.gimbal_yaw.toFixed(1)}°</span>
              </div>
              <div>
                Thrust: <span data-testid="hud-thrust-cmd" className="text-sky-300 font-bold">{thrust.percentage.toFixed(0)}%</span>{' '}
                <span className="text-[9px]">({thrust.newtons} N)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
