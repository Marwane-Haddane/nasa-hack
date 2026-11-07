import React, { useEffect, useState } from 'react';
import { Radio, Cpu, RefreshCw } from 'lucide-react';
import { telemetryStore } from '../services/telemetryStore';
import { wsClient } from '../services/websocket';

export const ConnectionBadge: React.FC = () => {
  const [status, setStatus] = useState(telemetryStore.getConnectionStatus());

  useEffect(() => {
    return telemetryStore.subscribeConnection((connected, mode) => {
      setStatus({ connected, mode });
    });
  }, []);

  const handleResetSimulation = () => {
    wsClient.reset(1450.0);
  };

  return (
    <div className="flex items-center space-x-2 text-xs font-mono">
      {status.mode === 'WEBSOCKET' ? (
        <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-emerald-950/70 border border-emerald-500/40 text-emerald-400">
          <Radio className="w-3.5 h-3.5 animate-pulse text-emerald-400" />
          <span className="font-semibold tracking-wider">WS 60Hz: CONNECTED</span>
        </div>
      ) : (
        <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-sky-950/70 border border-sky-500/40 text-sky-300">
          <Cpu className="w-3.5 h-3.5 text-sky-400" />
          <span className="font-semibold tracking-wider">STANDALONE RK4 SIMULATOR</span>
        </div>
      )}

      <button
        onClick={handleResetSimulation}
        className="flex items-center space-x-1 px-2 py-1 rounded bg-slate-900/80 hover:bg-slate-800 border border-slate-700/50 text-slate-300 hover:text-white transition-colors"
        title="Reset Flight Dynamics Simulation"
      >
        <RefreshCw className="w-3 h-3" />
        <span>RESET SIM</span>
      </button>
    </div>
  );
};
