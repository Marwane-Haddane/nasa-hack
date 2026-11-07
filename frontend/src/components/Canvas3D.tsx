import React, { useEffect, useRef } from 'react';
import { LunarSceneController } from '../graphics/LunarSceneController';
import { telemetryStore } from '../services/telemetryStore';
import { VisualizerConfig } from '../types/visualizer';

interface Canvas3DProps {
  config: VisualizerConfig;
  onConfigChange?: (newConfig: Partial<VisualizerConfig>) => void;
}

export const Canvas3D: React.FC<Canvas3DProps> = ({ config, onConfigChange }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<LunarSceneController | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Initialize 3D Engine
    const controller = new LunarSceneController(containerRef.current, config, onConfigChange);
    controllerRef.current = controller;

    // Subscribe directly to telemetry stream for zero-re-render 60 FPS graphics updates
    const unsubscribe = telemetryStore.subscribeTelemetry((telemetry) => {
      controller.updateTelemetry(telemetry);
    });

    return () => {
      unsubscribe();
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  // Update visualizer configuration dynamically
  useEffect(() => {
    if (controllerRef.current) {
      controllerRef.current.setConfig(config);
    }
  }, [config]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 w-full h-full bg-black overflow-hidden select-none cursor-grab active:cursor-grabbing"
      data-testid="canvas-3d-container"
    />
  );
};
