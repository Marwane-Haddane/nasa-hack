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

    // 1. Right GUI: Pilot Input & Vehicle Parameters (Matching Photo 2)
    const guiRight = new GUI({
      title: '👨‍🚀 Pilot Input',
      container: rightGuiContainerRef.current,
      width: 320,
      autoPlace: false
    });

    const rocketSettings = {
      vehicleModel: config.vehicleModel === 'DROPPER_X' ? 'Lunar Lander (Nova-C)' : 'Saturn V (Apollo)',
      fuelType: 'RP-1/LOX',
      initialFuelMass: 2640000,
      dryMass: 330000,
      crossSectionalArea: 10.1,
      dragCoefficient: 0.3,
      liftCoefficient: 0.05,
      nozzleCount: 5,
      exitArea: 1.8,
      throatArea: 0.25
    };

    const envSettings = {
      airDensity: 1.225,
      seaLevelPressure: 101325,
      seaLevelTemp: 288.15,
      gravity: 9.80665,
      tempLapseRate: 0.0065,
      gasConstant: 287.05,
      simulationSpeed: 1.0,
      mode: 'day',
      atmosphereLayer: 'Troposphere',
      cameraMode: config.cameraMode.toLowerCase()
    };

    // Rocket Values Folder
    const rocketFolder = guiRight.addFolder('🚀 Rocket Values');
    rocketFolder.add(rocketSettings, 'vehicleModel', ['Saturn V (Apollo)', 'Lunar Lander (Nova-C)']).name('Vehicle Model').onChange((val: string) => {
      const isDropper = val.includes('Lunar Lander');
      onConfigChange({ vehicleModel: isDropper ? 'DROPPER_X' : 'SATURN_V' });
    });
    rocketFolder.add(rocketSettings, 'fuelType', ['RP-1/LOX', 'LH2/LOX', 'Aerozine 50/NTO']).name('Fuel Type');
    rocketFolder.add(rocketSettings, 'initialFuelMass', 0, 5000000, 100).name('Initial Fuel Mass');
    rocketFolder.add(rocketSettings, 'dryMass', 0, 1000000, 100).name('Rocket Dry Mass');
    rocketFolder.add(rocketSettings, 'crossSectionalArea', 0, 100, 0.1).name('Cross Sectional Area');
    rocketFolder.add(rocketSettings, 'dragCoefficient', 0, 5, 0.1).name('Drag Coefficient');
    rocketFolder.add(rocketSettings, 'liftCoefficient', 0, 5, 0.01).name('Lift Coefficient');
    rocketFolder.add(rocketSettings, 'nozzleCount', 1, 10, 1).name('Nozzle Count');
    rocketFolder.add(rocketSettings, 'exitArea', 0, 100, 0.1).name('Exit Area');
    rocketFolder.add(rocketSettings, 'throatArea', 0, 10, 0.1).name('Throat Area');
    rocketFolder.open();

    // Environment Values Folder
    const envFolder = guiRight.addFolder('🌍 Environment Values');
    envFolder.add(envSettings, 'airDensity', 0, 10, 0.001).name('Air Density');
    envFolder.add(envSettings, 'seaLevelPressure', 0, 200000, 100).name('Sea-Level Pressure');
    envFolder.add(envSettings, 'seaLevelTemp', 0, 4000, 0.1).name('Sea-Level Temp');
    envFolder.add(envSettings, 'gravity', 0, 20, 0.01).name('Gravity');
    envFolder.add(envSettings, 'tempLapseRate', 0, 1, 0.0001).name('Temp Lapse Rate');
    envFolder.add(envSettings, 'gasConstant', 0, 1000, 0.01).name('Gas Constant');
    envFolder.add(envSettings, 'simulationSpeed', 0.1, 5.0, 0.1).name('Simulation Speed');
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
      reset: () => {
        wsClient.reset(1450.0);
      }
    };

    const launchController = guiRight.add(actionControls, 'launch').name('🚀 Launch');
    guiRight.add(actionControls, 'stop').name('⏸ Stop');
    guiRight.add(actionControls, 'reset').name('↺ Reset');

    // Style the Launch button with vibrant pink/coral as in Photo 2
    if (launchController.domElement) {
      launchController.domElement.style.background = '#e11d48';
      launchController.domElement.style.color = '#ffffff';
      launchController.domElement.style.fontWeight = 'bold';
    }

    guiRight.add(envSettings, 'mode', ['day', 'night', 'lunar south pole']).name('mode').onChange((val: string) => {
      let mode: EnvironmentLightingMode = 'DAY';
      if (val === 'night') mode = 'NIGHT';
      else if (val.includes('lunar')) mode = 'LUNAR';
      onConfigChange({ lightingMode: mode });
    });

    const layerController = guiRight.add(envSettings, 'atmosphereLayer').name('Atmosphere Layer').listen();
    if (layerController.domElement) {
      const input = layerController.domElement.querySelector('input');
      if (input) {
        input.style.color = '#10b981';
        input.style.fontWeight = 'bold';
      }
    }

    guiRight.add(envSettings, 'cameraMode', ['orbit', 'chase', 'cockpit', 'landing_pad']).name('Camera Mode').onChange((val: string) => {
      onConfigChange({ cameraMode: val.toUpperCase() as CameraMode });
    });

    guiRight.add({ shortcut: 'Press V' }, 'shortcut').name('⌨ Change camera mode').disable();

    // 2. Left GUI: Flight Data (Matching Photo 2)
    const guiLeft = new GUI({
      title: '📡 Flight Data',
      container: leftGuiContainerRef.current,
      width: 320,
      autoPlace: false
    });

    const flightData = {
      rocketHeight: '0.90 m',
      time: '0.00',
      pos_x: 0, pos_y: 0, pos_z: 0,
      vel_x: 0, vel_y: 0, vel_z: 0,
      acc_x: 0, acc_y: 0, acc_z: 0,
      ang_x: 0, ang_y: 0, ang_z: 0,
      angvel_x: 0, angvel_y: 0, angvel_z: 0,
      angacc_x: 0, angacc_y: 0, angacc_z: 0,
      angle_of_attack: '0.00°',
      totalForce: '29166288.66 N',
      weightForce: '29166288.66 N',
      dragForce: '+ 0.00 N',
      liftForce: '+ 0.00 N',
      thrustForce: '+ 0.00 N',
      fuelText: 'Fuel: 2640000.0 / 2640000.0 kg (100%)'
    };

    guiLeft.add(flightData, 'rocketHeight').name('Rocket Height').listen();
    guiLeft.add(flightData, 'time').name('Time').listen();

    // Position Folder
    const posFolder = guiLeft.addFolder('Position');
    posFolder.close();
    posFolder.add(flightData, 'pos_x').name('X (m)').listen();
    posFolder.add(flightData, 'pos_y').name('Y (m)').listen();
    posFolder.add(flightData, 'pos_z').name('Z (m)').listen();

    // Velocity Folder
    const velFolder = guiLeft.addFolder('Velocity');
    velFolder.close();
    velFolder.add(flightData, 'vel_x').name('Vx (m/s)').listen();
    velFolder.add(flightData, 'vel_y').name('Vy (m/s)').listen();
    velFolder.add(flightData, 'vel_z').name('Vz (m/s)').listen();

    // Acceleration Folder
    const accFolder = guiLeft.addFolder('Acceleration');
    accFolder.close();
    accFolder.add(flightData, 'acc_x').name('Ax (m/s²)').listen();
    accFolder.add(flightData, 'acc_y').name('Ay (m/s²)').listen();
    accFolder.add(flightData, 'acc_z').name('Az (m/s²)').listen();

    // Angular Folder
    const angFolder = guiLeft.addFolder('angular');
    angFolder.close();
    angFolder.add(flightData, 'ang_x').name('Roll (rad)').listen();
    angFolder.add(flightData, 'ang_y').name('Pitch (rad)').listen();
    angFolder.add(flightData, 'ang_z').name('Yaw (rad)').listen();

    // Angular Velocity Folder
    const angVelFolder = guiLeft.addFolder('angularVelocity');
    angVelFolder.close();
    angVelFolder.add(flightData, 'angvel_x').name('wx (rad/s)').listen();
    angVelFolder.add(flightData, 'angvel_y').name('wy (rad/s)').listen();
    angVelFolder.add(flightData, 'angvel_z').name('wz (rad/s)').listen();

    // Angular Acceleration Folder
    const angAccFolder = guiLeft.addFolder('angularAcceleration');
    angAccFolder.close();
    angAccFolder.add(flightData, 'angacc_x').name('ax (rad/s²)').listen();
    angAccFolder.add(flightData, 'angacc_y').name('ay (rad/s²)').listen();
    angAccFolder.add(flightData, 'angacc_z').name('az (rad/s²)').listen();

    guiLeft.add(flightData, 'angle_of_attack').name('angle_of_attack').listen();

    // Forces Folders
    const totalForceFolder = guiLeft.addFolder('Total Force');
    totalForceFolder.close();
    totalForceFolder.add(flightData, 'totalForce').name('Magnitude').listen();

    const weightForceFolder = guiLeft.addFolder('Weight Force');
    weightForceFolder.close();
    weightForceFolder.add(flightData, 'weightForce').name('Magnitude').listen();

    const dragForceFolder = guiLeft.addFolder('Drag Force');
    dragForceFolder.close();
    dragForceFolder.add(flightData, 'dragForce').name('Magnitude').listen();

    const liftForceFolder = guiLeft.addFolder('Lift Force');
    liftForceFolder.close();
    liftForceFolder.add(flightData, 'liftForce').name('Magnitude').listen();

    const thrustForceFolder = guiLeft.addFolder('Thrust Force');
    thrustForceFolder.close();
    thrustForceFolder.add(flightData, 'thrustForce').name('Magnitude').listen();

    // Fuel Level with Visual Progress Bar (Exactly like Photo 2)
    const fuelFolder = guiLeft.addFolder('Fuel Level');
    fuelFolder.open();

    const fuelContainer = document.createElement('div');
    fuelContainer.style.display = 'flex';
    fuelContainer.style.flexDirection = 'column';
    fuelContainer.style.alignItems = 'stretch';
    fuelContainer.style.padding = '6px 4px';

    const progressBar = document.createElement('div');
    progressBar.style.height = '20px';
    progressBar.style.border = '1px solid rgba(255, 255, 255, 0.2)';
    progressBar.style.borderRadius = '4px';
    progressBar.style.overflow = 'hidden';
    progressBar.style.background = 'rgba(0, 0, 0, 0.4)';
    progressBar.style.position = 'relative';

    const progressFill = document.createElement('div');
    progressFill.style.height = '100%';
    progressFill.style.width = '100%';
    progressFill.style.background = '#4caf50';
    progressFill.style.transition = 'width 0.2s ease-out, background 0.3s';
    progressBar.appendChild(progressFill);

    const fuelLabel = document.createElement('div');
    fuelLabel.style.position = 'absolute';
    fuelLabel.style.top = '0';
    fuelLabel.style.left = '0';
    fuelLabel.style.width = '100%';
    fuelLabel.style.height = '100%';
    fuelLabel.style.display = 'flex';
    fuelLabel.style.alignItems = 'center';
    fuelLabel.style.justifyContent = 'center';
    fuelLabel.style.fontSize = '11px';
    fuelLabel.style.fontWeight = 'bold';
    fuelLabel.style.color = '#ffffff';
    fuelLabel.style.textShadow = '0 1px 2px rgba(0,0,0,0.8)';
    fuelLabel.textContent = 'Fuel: 650.0 / 650.0 kg (100%)';
    progressBar.appendChild(fuelLabel);

    fuelContainer.appendChild(progressBar);

    const childrenContainer = fuelFolder.domElement.querySelector('.children');
    if (childrenContainer) {
      childrenContainer.appendChild(fuelContainer);
    } else {
      fuelFolder.domElement.appendChild(fuelContainer);
    }

    // Subscribe to Telemetry Stream to live-update all fields
    const unsubscribe = telemetryStore.subscribeTelemetry((packet: TelemetryPacket) => {
      flightData.rocketHeight = `${packet.position.z.toFixed(2)} m`;
      flightData.time = `${packet.timestamp.toFixed(2)}`;

      flightData.pos_x = Number(packet.position.x.toFixed(2));
      flightData.pos_y = Number(packet.position.y.toFixed(2));
      flightData.pos_z = Number(packet.position.z.toFixed(2));

      flightData.vel_x = Number(packet.velocity.x.toFixed(2));
      flightData.vel_y = Number(packet.velocity.y.toFixed(2));
      flightData.vel_z = Number(packet.velocity.z.toFixed(2));

      flightData.ang_x = Number(packet.euler.roll.toFixed(2));
      flightData.ang_y = Number(packet.euler.pitch.toFixed(2));
      flightData.ang_z = Number(packet.euler.yaw.toFixed(2));

      flightData.angvel_x = Number(packet.angular_velocity.wx.toFixed(3));
      flightData.angvel_y = Number(packet.angular_velocity.wy.toFixed(3));
      flightData.angvel_z = Number(packet.angular_velocity.wz.toFixed(3));

      flightData.angle_of_attack = `${packet.euler.tilt.toFixed(2)}°`;

      const thrustN = packet.thrust.newtons;
      const weightN = packet.mass.total * (config.lightingMode === 'LUNAR' ? 1.62 : 9.81);
      flightData.thrustForce = `${thrustN.toFixed(2)} N`;
      flightData.weightForce = `${weightN.toFixed(2)} N`;
      flightData.totalForce = `${Math.abs(thrustN - weightN).toFixed(2)} N`;

      // Update Fuel Bar
      const pct = Math.max(0, Math.min(100, packet.fuel.percentage));
      progressFill.style.width = `${pct}%`;
      if (pct > 50) progressFill.style.background = '#4caf50';
      else if (pct > 20) progressFill.style.background = '#ffb300';
      else progressFill.style.background = '#f44336';
      fuelLabel.textContent = `Fuel: ${packet.fuel.mass.toFixed(1)} / ${packet.fuel.max_mass.toFixed(1)} kg (${pct.toFixed(0)}%)`;

      // Update Atmosphere Layer text
      const alt = packet.position.z;
      if (config.lightingMode === 'LUNAR') {
        envSettings.atmosphereLayer = 'Lunar Vacuum';
      } else {
        if (alt < 12000) envSettings.atmosphereLayer = 'Troposphere';
        else if (alt < 50000) envSettings.atmosphereLayer = 'Stratosphere';
        else if (alt < 85000) envSettings.atmosphereLayer = 'Mesosphere';
        else envSettings.atmosphereLayer = 'Thermosphere';
      }
    });

    return () => {
      unsubscribe();
      guiLeft.destroy();
      guiRight.destroy();
    };
  }, []);

  return (
    <>
      {/* Left GUI Container for Flight Data */}
      <div
        ref={leftGuiContainerRef}
        className="lil-gui-left-container pointer-events-auto"
        style={{
          position: 'absolute',
          top: '12px',
          left: '12px',
          zIndex: 50,
          maxHeight: 'calc(100vh - 24px)',
          overflowY: 'auto'
        }}
      />

      {/* Right GUI Container for Pilot Input */}
      <div
        ref={rightGuiContainerRef}
        className="lil-gui-right-container pointer-events-auto"
        style={{
          position: 'absolute',
          top: '12px',
          right: '12px',
          zIndex: 50,
          maxHeight: 'calc(100vh - 24px)',
          overflowY: 'auto'
        }}
      />
    </>
  );
};
