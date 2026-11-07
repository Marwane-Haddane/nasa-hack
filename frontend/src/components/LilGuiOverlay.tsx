import React, { useEffect, useRef } from 'react';
import GUI from 'lil-gui';
import { telemetryStore } from '../services/telemetryStore';
import { fallbackSimulator } from '../services/fallbackTelemetry';
import { wsClient } from '../services/websocket';
import { VisualizerConfig, CameraMode, EnvironmentLightingMode } from '../types/visualizer';
import { TelemetryPacket } from '../types/telemetry';

interface LilGuiOverlayProps {
  config: VisualizerConfig;
  onConfigChange: (newConfig: Partial<VisualizerConfig>) => void;
}

export const LilGuiOverlay: React.FC<LilGuiOverlayProps> = ({ config, onConfigChange }) => {
  const leftGuiContainerRef = useRef<HTMLDivElement>(null);
  const rightGuiContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!leftGuiContainerRef.current || !rightGuiContainerRef.current) return;

    if (typeof window !== 'undefined' && !window.matchMedia) {
      window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia;
    }

    // ==========================================
    // 1. Right GUI: Pilot Input (Matching Photo 1:1)
    // ==========================================
    const guiRight = new GUI({
      title: '👨‍🚀 Pilot Input',
      container: rightGuiContainerRef.current,
      width: 255,
      autoPlace: false,
    });

    const rocketSettings = {
      fuelType: 'RP-1/LOX',
      initialFuelMass: 2640000,
      dryMass: 330000,
      crossSectionalArea: 10.1,
      dragCoefficient: 0.3,
      liftCoefficient: 0.05,
      nozzleCount: 5,
      exitArea: 1.8,
      throatArea: 0.25,
    };

    const envSettings = {
      airDensity: 1.225,
      seaLevelPressure: 101325,
      seaLevelTemp: 288.15,
      gravity: 9.80665,
      tempLapseRate: 0.0065,
      gasConstant: 287.05,
      simulationSpeed: 0.1,
      mode: config.lightingMode === 'NIGHT' ? 'night' : 'day',
      atmosphereLayer: 'Troposphere',
      cameraMode: config.cameraMode ? config.cameraMode.toLowerCase() : 'orbit',
    };

    // Rocket Values Folder (Open by default)
    const rocketFolder = guiRight.addFolder('🚀 Rocket Values');
    rocketFolder.add(rocketSettings, 'fuelType', ['RP-1/LOX', 'LH2/LOX']).name('Fuel Type');
    rocketFolder.add(rocketSettings, 'initialFuelMass', 0, 5000000, 100).name('Initial Fuel Mass');
    rocketFolder.add(rocketSettings, 'dryMass', 0, 1000000, 100).name('Rocket Dry Mass');
    rocketFolder.add(rocketSettings, 'crossSectionalArea', 0, 100, 0.1).name('Cross Sectional Area');
    rocketFolder.add(rocketSettings, 'dragCoefficient', 0, 5, 0.1).name('Drag Coefficient');
    rocketFolder.add(rocketSettings, 'liftCoefficient', 0, 5, 0.01).name('Lift Coefficient');
    rocketFolder.add(rocketSettings, 'nozzleCount', 0, 10, 1).name('Nozzle Count');
    rocketFolder.add(rocketSettings, 'exitArea', 0, 100, 0.1).name('Exit Area');
    rocketFolder.add(rocketSettings, 'throatArea', 0, 10, 0.1).name('Throat Area');
    rocketFolder.open();

    // Environment Values Folder (Open by default)
    const envFolder = guiRight.addFolder('🌍 Environment Values');
    envFolder.add(envSettings, 'airDensity', 0, 10, 0.001).name('Air Density');
    envFolder.add(envSettings, 'seaLevelPressure', 0, 200000, 100).name('Sea-Level Pressure');
    envFolder.add(envSettings, 'seaLevelTemp', 0, 4000, 0.1).name('Sea-Level Temp');
    envFolder.add(envSettings, 'gravity', 0, 200, 0.01).name('Gravity');
    envFolder.add(envSettings, 'tempLapseRate', 0, 1, 0.0001).name('Temp Lapse Rate');
    envFolder.add(envSettings, 'gasConstant', 0, 1000, 0.01).name('Gas Constant');
    envFolder.add(envSettings, 'simulationSpeed', 0, 1, 0.1).name('Simulation Speed');
    envFolder.open();

    // Action Controls (Launch & Stop)
    const actionControls = {
      launch: () => {
        wsClient.reset(1450.0);
        fallbackSimulator.start((pkt) => telemetryStore.publishTelemetry(pkt));
      },
      stop: () => {
        fallbackSimulator.stop();
      },
    };

    const launchCtrl = guiRight.add(actionControls, 'launch').name('🚀 Launch');
    launchCtrl.domElement.classList.add('lil-gui-launch-btn');

    const stopCtrl = guiRight.add(actionControls, 'stop').name('⏸ Stop');
    stopCtrl.domElement.classList.add('lil-gui-stop-btn');

    guiRight
      .add(envSettings, 'mode', ['day', 'night'])
      .name('mode')
      .onChange((val: string) => {
        const mode: EnvironmentLightingMode = val === 'night' ? 'NIGHT' : 'DAY';
        onConfigChange({ lightingMode: mode });
      });

    const atmoCtrl = guiRight.add(envSettings, 'atmosphereLayer').name('Atmosphere Layer').disable();
    atmoCtrl.domElement.classList.add('lil-gui-atmosphere-layer');

    guiRight
      .add(envSettings, 'cameraMode', ['orbit', 'first', 'follow'])
      .name('Camera Mode')
      .onChange((val: string) => {
        let cam: CameraMode = 'ORBIT';
        if (val === 'first') cam = 'COCKPIT';
        else if (val === 'follow') cam = 'CHASE';
        onConfigChange({ cameraMode: cam });
      });

    guiRight.add({ shortcut: 'Press V' }, 'shortcut').name('📷 Change camera mode').disable();

    // ==========================================
    // 2. Left GUI: Flight Data (Matching Photo 1:1)
    // ==========================================
    const guiLeft = new GUI({
      title: '📡 Flight Data',
      container: leftGuiContainerRef.current,
      width: 255,
      autoPlace: false,
    });

    const flightData = {
      rocketHeight: '0.90 m',
      time: '0.00',
      angle_of_attack: '0.00',
    };

    const heightCtrl = guiLeft.add(flightData, 'rocketHeight').name('Rocket Height').listen().disable();
    const timeCtrl = guiLeft.add(flightData, 'time').name('Time').listen().disable();

    if (heightCtrl.domElement) {
      const inp = heightCtrl.domElement.querySelector('input');
      if (inp) {
        inp.style.color = '#a3e635';
        inp.style.fontWeight = 'bold';
      }
    }
    if (timeCtrl.domElement) {
      const inp = timeCtrl.domElement.querySelector('input');
      if (inp) {
        inp.style.color = '#a3e635';
        inp.style.fontWeight = 'bold';
      }
    }

    // Helper to compute vector direction arrow matching reference repo GuiController
    const getVectorMainArrow = (vec: [number, number, number], threshold = 0.01): string => {
      const [x, y, z] = vec;
      const absX = Math.abs(x);
      const absY = Math.abs(y);
      const absZ = Math.abs(z);
      if (absX < threshold && absY < threshold && absZ < threshold) return '•';
      if (absY >= absX && absY >= absZ) return y > 0 ? '↑' : '↓';
      if (absX >= absY && absX >= absZ) return x > 0 ? '→' : '←';
      return z > 0 ? 'Z↑' : 'Z↓';
    };

    interface VectorFolderRef {
      folder: GUI;
      label: string;
      unit: string;
      vector: { x: number; y: number; z: number };
      titleElement: HTMLElement | null;
      extraControllers?: { ctrl: any; label: string; value: any }[];
    }

    const vectorFolders: VectorFolderRef[] = [];

    const createVectorFolder = (
      label: string,
      unit: string,
      initialVec: [number, number, number] = [0, 0, 0],
      extraMonitors: { label: string; initial: any }[] = []
    ): VectorFolderRef => {
      const folder = guiLeft.addFolder(label);
      folder.close();

      const vector = { x: initialVec[0], y: initialVec[1], z: initialVec[2] };
      folder.add(vector, 'x').name('X').listen().disable();
      folder.add(vector, 'y').name('Y').listen().disable();
      folder.add(vector, 'z').name('Z').listen().disable();

      const extraControllers: { ctrl: any; label: string; value: any }[] = [];
      for (const extra of extraMonitors) {
        const holder = { [extra.label]: extra.initial };
        const ctrl = folder.add(holder, extra.label).listen().disable();
        extraControllers.push({ ctrl, label: extra.label, value: extra.initial });
      }

      const titleElement = folder.domElement.querySelector('.title') as HTMLElement | null;
      const ref: VectorFolderRef = {
        folder,
        label,
        unit,
        vector,
        titleElement,
        extraControllers,
      };

      const mag = Math.sqrt(initialVec[0] ** 2 + initialVec[1] ** 2 + initialVec[2] ** 2).toFixed(2);
      const arrow = getVectorMainArrow(initialVec);
      if (titleElement) {
        titleElement.innerHTML = `${label}<span style="float: right; font-weight: normal; font-size: 11px; margin-right: 4px;">${arrow}  ${mag} ${unit}</span>`;
      }

      vectorFolders.push(ref);
      return ref;
    };

    // 1. Position
    const posFolderRef = createVectorFolder('Position', 'm', [0, 1.0, 0]);

    // 2. Velocity
    const velFolderRef = createVectorFolder('Velocity', 'm·s⁻¹', [0, 0, 0]);

    // 3. Acceleration
    const accFolderRef = createVectorFolder('Acceleration', 'm·s⁻²', [0, 0, 0]);

    // 4. angular
    const angFolderRef = createVectorFolder('angular', 'rad', [0, 0, 0]);

    // 5. angularVelocity
    const angVelFolderRef = createVectorFolder('angularVelocity', 'rad·s⁻¹', [0, 0, 0]);

    // 6. angularAcceleration
    const angAccFolderRef = createVectorFolder('angularAcceleration', 'rad·s⁻²', [0, 0, 0]);

    // 7. angle_of_attack
    const aoaCtrl = guiLeft.add(flightData, 'angle_of_attack').name('angle_of_attack').listen().disable();
    if (aoaCtrl.domElement) {
      const inp = aoaCtrl.domElement.querySelector('input');
      if (inp) {
        inp.style.color = '#a3e635';
        inp.style.fontWeight = 'bold';
      }
    }

    // 8. Total Force
    const totalForceRef = createVectorFolder('Total Force', 'N', [0, -29166288.66, 0]);

    // 9. Weight Force
    const weightForceRef = createVectorFolder('Weight Force', 'N', [0, -29166288.66, 0], [
      { label: 'Gravity Acceleration', initial: '9.81 m/s²' },
      { label: 'Weight Direction', initial: '(0.00, -1.00, 0.00)' },
    ]);

    // 10. Drag Force
    const dragForceRef = createVectorFolder('Drag Force', 'N', [0, 0, 0], [
      { label: 'Drag Magnitude', initial: '0.00 N' },
      { label: 'Drag Direction', initial: '(0.00, 0.00, 0.00)' },
    ]);

    // 11. Lift Force
    const liftForceRef = createVectorFolder('Lift Force', 'N', [0, 0, 0], [
      { label: 'Lift Magnitude', initial: '0.00 N' },
      { label: 'Lift Direction', initial: '(0.00, 0.00, 0.00)' },
    ]);

    // 12. Thrust Force
    const thrustForceRef = createVectorFolder('Thrust Force', 'N', [0, 0, 0], [
      { label: 'Ambient Pressure', initial: '101325.00 Pa' },
      { label: 'Exhaust Velocity', initial: '0.00 m/s' },
      { label: 'Mass Flow Rate', initial: '0.0000 kg/s' },
      { label: 'Chamber Pressure', initial: '7000000 Pa' },
      { label: 'Chamber Temp', initial: '3500.00 K' },
    ]);

    // 13. Fuel Level with Progress Bar (Open by default, matching Photo 1:1)
    const fuelFolder = guiLeft.addFolder('Fuel Level');
    fuelFolder.open();

    const fuelContainer = document.createElement('div');
    fuelContainer.style.display = 'flex';
    fuelContainer.style.flexDirection = 'column';
    fuelContainer.style.alignItems = 'stretch';
    fuelContainer.style.padding = '4px 6px 8px 6px';

    const progressBar = document.createElement('div');
    progressBar.style.height = '18px';
    progressBar.style.border = '1px solid rgba(255, 255, 255, 0.3)';
    progressBar.style.borderRadius = '3px';
    progressBar.style.overflow = 'hidden';
    progressBar.style.background = 'rgba(0, 0, 0, 0.5)';
    progressBar.style.position = 'relative';

    const progressFill = document.createElement('div');
    progressFill.style.height = '100%';
    progressFill.style.width = '100%';
    progressFill.style.background = '#4caf50';
    progressFill.style.transition = 'width 0.2s ease-out, background 0.3s';
    progressBar.appendChild(progressFill);

    const fuelText = document.createElement('div');
    fuelText.style.textAlign = 'center';
    fuelText.style.fontSize = '11px';
    fuelText.style.fontWeight = 'bold';
    fuelText.style.color = '#ffffff';
    fuelText.style.marginTop = '4px';
    fuelText.textContent = 'Fuel: 2640000.0 / 2640000.0 kg (100%)';

    fuelContainer.appendChild(progressBar);
    fuelContainer.appendChild(fuelText);

    const fuelChildren = fuelFolder.domElement.querySelector('.children');
    if (fuelChildren) {
      fuelChildren.appendChild(fuelContainer);
    } else {
      fuelFolder.domElement.appendChild(fuelContainer);
    }

    // 14. Rocket Collapsible Folder
    const rocketStaticFolder = guiLeft.addFolder('Rocket');
    rocketStaticFolder.close();
    const rocketDisplay = {
      fuelType: 'RP-1/LOX',
      initialFuelMass: '2640000.00 kg',
      nowFuelMass: '2640000.00 kg',
      diameter: '10.10 m',
      dryMass: '330000 kg',
      totalMass: '2970000.00 kg',
      crossSectionArea: '10.1 m²',
      dragCoefficient: 0.3,
      liftCoefficient: 0.05,
      nozzleCount: 5,
      exitArea: '1.8 m²',
      throatArea: '0.25 m²',
    };
    for (const key of Object.keys(rocketDisplay)) {
      rocketStaticFolder.add(rocketDisplay, key as any).listen().disable();
    }

    // 15. Environment Collapsible Folder
    const envStaticFolder = guiLeft.addFolder('Environment');
    envStaticFolder.close();
    const envDisplay = {
      airDensity: '1.2250 kg/m³',
      seaLevelPressure: '101,325 Pa',
    };
    for (const key of Object.keys(envDisplay)) {
      envStaticFolder.add(envDisplay, key as any).listen().disable();
    }

    // Function to update vector folder magnitudes and title arrows
    const updateVectorFolder = (
      ref: VectorFolderRef,
      vec: [number, number, number],
      extras?: Record<string, string>
    ) => {
      ref.vector.x = Number(vec[0].toFixed(2));
      ref.vector.y = Number(vec[1].toFixed(2));
      ref.vector.z = Number(vec[2].toFixed(2));

      const mag = Math.sqrt(vec[0] ** 2 + vec[1] ** 2 + vec[2] ** 2).toFixed(2);
      const arrow = getVectorMainArrow(vec);
      if (ref.titleElement) {
        ref.titleElement.innerHTML = `${ref.label}<span style="float: right; font-weight: normal; font-size: 11px; margin-right: 4px;">${arrow}  ${mag} ${ref.unit}</span>`;
      }

      if (extras && ref.extraControllers) {
        for (const ec of ref.extraControllers) {
          if (extras[ec.label] !== undefined) {
            ec.ctrl.setValue(extras[ec.label]);
          }
        }
      }
    };

    // Telemetry subscriber to bind real flight physics values
    const unsubscribe = telemetryStore.subscribeTelemetry((packet: TelemetryPacket) => {
      const alt = packet.position.z >= 0 ? packet.position.z : 0.9;
      flightData.rocketHeight = `${alt.toFixed(2)} m`;
      flightData.time = `${packet.timestamp.toFixed(2)}`;
      flightData.angle_of_attack = `${packet.euler.tilt.toFixed(2)}`;

      // Update vectors
      updateVectorFolder(posFolderRef, [packet.position.x, alt, packet.position.y]);
      updateVectorFolder(velFolderRef, [packet.velocity.x, packet.velocity.vz ?? packet.velocity.z, packet.velocity.y]);
      updateVectorFolder(accFolderRef, [0, packet.velocity.vz !== undefined ? packet.velocity.vz * 0.1 : 0, 0]);
      updateVectorFolder(angFolderRef, [packet.euler.roll, packet.euler.pitch, packet.euler.yaw]);
      updateVectorFolder(angVelFolderRef, [packet.angular_velocity.wx, packet.angular_velocity.wy, packet.angular_velocity.wz]);
      updateVectorFolder(angAccFolderRef, [0, 0, 0]);

      // Forces
      const thrustN = packet.thrust.newtons;
      const weightN = packet.mass.total * 9.80665;
      updateVectorFolder(totalForceRef, [0, thrustN - weightN, 0]);
      updateVectorFolder(weightForceRef, [0, -weightN, 0], {
        'Gravity Acceleration': '9.81 m/s²',
        'Weight Direction': '(0.00, -1.00, 0.00)',
      });
      updateVectorFolder(dragForceRef, [0, 0, 0], {
        'Drag Magnitude': '0.00 N',
        'Drag Direction': '(0.00, 0.00, 0.00)',
      });
      updateVectorFolder(liftForceRef, [0, 0, 0], {
        'Lift Magnitude': '0.00 N',
        'Lift Direction': '(0.00, 0.00, 0.00)',
      });
      updateVectorFolder(thrustForceRef, [0, thrustN, 0]);

      // Fuel bar
      const pct = Math.max(0, Math.min(100, packet.fuel.percentage));
      progressFill.style.width = `${pct}%`;
      fuelText.textContent = `Fuel: ${(2640000 * (pct / 100)).toFixed(1)} / 2640000.0 kg (${pct.toFixed(0)}%)`;

      // Atmosphere Layer update
      if (alt < 12000) envSettings.atmosphereLayer = 'Troposphere';
      else if (alt < 50000) envSettings.atmosphereLayer = 'Stratosphere';
      else if (alt < 85000) envSettings.atmosphereLayer = 'Mesosphere';
      else envSettings.atmosphereLayer = 'Thermosphere';
      atmoCtrl.setValue(envSettings.atmosphereLayer);
    });

    return () => {
      unsubscribe();
      guiLeft.destroy();
      guiRight.destroy();
    };
  }, []);

  return (
    <>
      {/* Left GUI Container for pure Flight Data */}
      <div
        ref={leftGuiContainerRef}
        className="lil-gui-left-container pointer-events-auto"
        style={{
          position: 'absolute',
          top: '0px',
          left: '0px',
          zIndex: 50,
          maxHeight: '100vh',
          overflowY: 'auto',
        }}
      />

      {/* Right GUI Container for pure Pilot Input */}
      <div
        ref={rightGuiContainerRef}
        className="lil-gui-right-container pointer-events-auto"
        style={{
          position: 'absolute',
          top: '0px',
          right: '0px',
          zIndex: 50,
          maxHeight: '100vh',
          overflowY: 'auto',
        }}
      />
    </>
  );
};
