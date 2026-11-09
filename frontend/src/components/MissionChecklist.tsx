import React, { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Clock, ShieldCheck } from 'lucide-react';
import { telemetryStore } from '../services/telemetryStore';
import { TelemetryPacket, MissionPhaseId } from '../types/telemetry';

interface StageConfig {
  id: MissionPhaseId;
  name: string;
  subtext: string;
}

const STAGES: StageConfig[] = [
  { id: 1, name: 'Phase 1: Deorbit Burn', subtext: 'Perilune transfer retrograde deceleration' },
  { id: 2, name: 'Phase 2: Ballistic Drift', subtext: 'Unpowered coast & Lidar rim topography' },
  { id: 3, name: 'Phase 3: Autonomous Divert', subtext: 'PPO AI lateral divert from >15° slope hazards' },
  { id: 4, name: 'Phase 4: Suicide Burn', subtext: 'Terminal braking curve & pitch-over to vertical' },
  { id: 5, name: 'Phase 5: Touchdown & Debrief', subtext: 'Engine cutoff & post-flight constraint check' }
];

export const MissionChecklist: React.FC = () => {
  const [telemetry, setTelemetry] = useState<TelemetryPacket | null>(telemetryStore.getTelemetry());

  useEffect(() => {
    let lastRender = -1000;
    let lastStageId = -1;
    let lastStatus = '';
    return telemetryStore.subscribeTelemetry((pkt) => {
      const now = performance.now();
      if (now - lastRender >= 50 || pkt.stage.id !== lastStageId || pkt.status !== lastStatus) {
        lastRender = now;
        lastStageId = pkt.stage.id;
        lastStatus = pkt.status;
        setTelemetry(pkt);
      }
    });
  }, []);

  const currentStageId = telemetry ? telemetry.stage.id : 1;
  const isCrashed = telemetry?.status === 'CRASH';
  const isLanded = telemetry?.status === 'TOUCHDOWN';

  return (
    <div className="aerospace-panel rounded-lg p-3 text-xs font-mono text-slate-300 w-80">
      <div className="flex items-center justify-between border-b border-sky-500/20 pb-2 mb-2.5">
        <div className="flex items-center space-x-1.5 text-sky-400 font-bold tracking-wide">
          <ShieldCheck className="w-4 h-4 text-sky-400" />
          <span>MISSION FLIGHT CHECKLIST</span>
        </div>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300">
          STAGE {currentStageId}/5
        </span>
      </div>

      {/* 5 Sequential Flight Stages */}
      <div className="space-y-2 mb-3">
        {STAGES.map((stage) => {
          const isActive = currentStageId === stage.id && !isLanded && !isCrashed;
          const isCompleted = currentStageId > stage.id || (isLanded && stage.id === 5);
          const isFailed = (currentStageId === stage.id && isCrashed) || (stage.id === 5 && isCrashed);

          let borderClass = 'border-slate-800/80 bg-slate-900/40';
          let statusBadge = (
            <span className="flex items-center space-x-1 text-slate-400 text-[10px]">
              <Clock className="w-3 h-3 text-slate-400" />
              <span>PENDING</span>
            </span>
          );

          if (isCompleted) {
            borderClass = 'border-emerald-500/40 bg-emerald-950/20 text-emerald-300';
            statusBadge = (
              <span className="flex items-center space-x-1 text-emerald-400 text-[10px] font-bold">
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                <span>COMPLETED</span>
              </span>
            );
          } else if (isFailed) {
            borderClass = 'border-red-500/50 bg-red-950/30 text-red-300';
            statusBadge = (
              <span className="flex items-center space-x-1 text-red-400 text-[10px] font-bold animate-pulse">
                <XCircle className="w-3 h-3 text-red-400" />
                <span>ABORT/CRASH</span>
              </span>
            );
          } else if (isActive) {
            borderClass = 'border-sky-500/60 bg-sky-950/30 text-sky-200 aerospace-panel-glow';
            statusBadge = (
              <span className="flex items-center space-x-1 text-sky-400 text-[10px] font-bold animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-ping mr-0.5" />
                <span>ACTIVE</span>
              </span>
            );
          }

          return (
            <div
              key={stage.id}
              className={`p-2 rounded border transition-all ${borderClass}`}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="font-semibold">{stage.name}</span>
                {statusBadge}
              </div>
              <p className="text-[10px] text-slate-400 leading-tight">
                {stage.subtext}
              </p>
            </div>
          );
        })}
      </div>

      {/* Real-time Flight Constraint Monitors */}
      <div className="border-t border-sky-500/20 pt-2">
        <div className="text-[10px] font-semibold text-slate-400 mb-1.5">
          TOUCHDOWN CONSTRAINT GUARDS:
        </div>
        <div className="grid grid-cols-2 gap-1.5 text-[10px]">
          {/* Vz Constraint */}
          <div className="flex items-center justify-between p-1 rounded bg-slate-900/60 border border-slate-800">
            <span className="text-slate-400">Vz ≤ 1.5 m/s:</span>
            {telemetry?.constraints.touchdown_vz_safe ? (
              <span className="text-emerald-400 font-bold">PASS</span>
            ) : (
              <span className="text-amber-400 font-bold">WARN</span>
            )}
          </div>

          {/* Vxy Constraint */}
          <div className="flex items-center justify-between p-1 rounded bg-slate-900/60 border border-slate-800">
            <span className="text-slate-400">Vxy ≤ 0.5 m/s:</span>
            {telemetry?.constraints.touchdown_vxy_safe ? (
              <span className="text-emerald-400 font-bold">PASS</span>
            ) : (
              <span className="text-amber-400 font-bold">WARN</span>
            )}
          </div>

          {/* Tilt Constraint */}
          <div className="flex items-center justify-between p-1 rounded bg-slate-900/60 border border-slate-800">
            <span className="text-slate-400">Tilt ≤ 5.0°:</span>
            {telemetry?.constraints.tilt_safe ? (
              <span className="text-emerald-400 font-bold">PASS</span>
            ) : (
              <span className="text-red-400 font-bold">ALERT</span>
            )}
          </div>

          {/* Descent Cone */}
          <div className="flex items-center justify-between p-1 rounded bg-slate-900/60 border border-slate-800">
            <span className="text-slate-400">Cone ≤ 15.0°:</span>
            {telemetry?.constraints.in_descent_cone ? (
              <span className="text-emerald-400 font-bold">PASS</span>
            ) : (
              <span className="text-red-400 font-bold">ALERT</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
