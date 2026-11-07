import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VacuumPlume } from './VacuumPlumeShader';
import { VehicleModelType } from '../types/visualizer';

export class LanderModel {
  public group: THREE.Group;
  public nozzlePivot: THREE.Group;
  public plume: VacuumPlume;
  public isGltfLoaded = false;

  // Subsystem vehicle groups
  public dropperGroup: THREE.Group;
  public saturnGroup: THREE.Group;
  public launcherPadGroup: THREE.Group;

  public currentModelType: VehicleModelType = 'SATURN_V';

  private gltfDropperRoot: THREE.Object3D | null = null;
  private gltfNozzlePivot: THREE.Object3D | null = null;
  private proceduralDropperRoot: THREE.Group;

  private saturnMesh: THREE.Object3D | null = null;
  private padMesh: THREE.Object3D | null = null;

  constructor() {
    this.group = new THREE.Group();

    // 1. Dropper Group
    this.dropperGroup = new THREE.Group();
    this.group.add(this.dropperGroup);

    // 2. Saturn V Group & Launch Pad Group
    this.saturnGroup = new THREE.Group();
    this.launcherPadGroup = new THREE.Group();
    this.group.add(this.saturnGroup);
    this.group.add(this.launcherPadGroup);

    // Gimbal pivot group for nozzle articulation
    this.nozzlePivot = new THREE.Group();
    this.nozzlePivot.position.set(0, 0.25, 0);

    // Initialize Vacuum Plume Shader
    this.plume = new VacuumPlume();
    this.plume.mesh.position.set(0, -0.07, 0);
    this.nozzlePivot.add(this.plume.mesh);

    // Build procedural fallback first so something is immediately visible
    this.proceduralDropperRoot = this.buildProceduralDropper();
    this.dropperGroup.add(this.proceduralDropperRoot);

    // Asynchronously load all 3D GLB assets
    this.loadDropperAsset('/assets/models/dropper_x.glb');
    this.loadSaturnVAsset('/assets/models/saturn_V_syria.glb');
    this.loadLauncherPadAsset('/assets/models/rocket_laucher_pad.glb');

    // Default to SATURN_V to match Photo 2
    this.setVehicleModel('SATURN_V');
  }

  public setVehicleModel(type: VehicleModelType): void {
    this.currentModelType = type;
    if (type === 'SATURN_V') {
      this.saturnGroup.visible = true;
      this.launcherPadGroup.visible = true;
      this.dropperGroup.visible = false;
    } else {
      this.saturnGroup.visible = false;
      this.launcherPadGroup.visible = false;
      this.dropperGroup.visible = true;
    }
  }

  private resolveUrl(url: string): string {
    if (typeof window !== 'undefined' && window.location && window.location.href) {
      try {
        return new URL(url, window.location.href).href;
      } catch {
        // fallback
      }
    }
    return url;
  }

  private loadDropperAsset(url: string): void {
    const loader = new GLTFLoader();
    loader.load(
      this.resolveUrl(url),
      (gltf) => {
        this.gltfDropperRoot = gltf.scene;
        let foundNozzle: THREE.Object3D | null = null;
        this.gltfDropperRoot.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
          if (child.name.toLowerCase().includes('nozzle') || child.name.toLowerCase().includes('gimbal')) {
            if (!foundNozzle) foundNozzle = child;
          }
        });

        if (foundNozzle) {
          this.gltfNozzlePivot = foundNozzle;
        }

        this.dropperGroup.remove(this.proceduralDropperRoot);
        this.dropperGroup.add(this.gltfDropperRoot);

        if (this.gltfNozzlePivot) {
          this.gltfNozzlePivot.add(this.plume.mesh);
          this.plume.mesh.position.set(0, -0.06, 0);
        } else {
          this.gltfDropperRoot.add(this.nozzlePivot);
        }

        this.isGltfLoaded = true;
      },
      undefined,
      () => {
        // procedural fallback active
      }
    );
  }

  private loadSaturnVAsset(url: string): void {
    const loader = new GLTFLoader();
    loader.load(
      this.resolveUrl(url),
      (gltf) => {
        this.saturnMesh = gltf.scene;
        this.saturnMesh.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        // Position and scale Saturn V upright on launch pad (matching Photo 1:1)
        this.saturnMesh.position.set(0, 1.0, 0);
        this.saturnMesh.scale.set(4.0, 4.0, 4.0);
        this.saturnGroup.add(this.saturnMesh);
      },
      undefined,
      () => {}
    );
  }

  private loadLauncherPadAsset(url: string): void {
    const loader = new GLTFLoader();
    loader.load(
      this.resolveUrl(url),
      (gltf) => {
        this.padMesh = gltf.scene;
        this.padMesh.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        // Position pad with black gantry tower at (-13.9, -10.4, 0) and scale 3.5 (matching Photo 1:1)
        this.padMesh.position.set(-13.9, -10.4, 0);
        this.padMesh.scale.set(3.5, 3.5, 3.5);
        this.launcherPadGroup.add(this.padMesh);
      },
      undefined,
      () => {}
    );
  }

  private buildProceduralDropper(): THREE.Group {
    const root = new THREE.Group();

    const goldMLI = new THREE.MeshStandardMaterial({
      color: 0xd49b28,
      metalness: 0.85,
      roughness: 0.32
    });
    const frameMetal = new THREE.MeshStandardMaterial({
      color: 0x475569,
      metalness: 0.8,
      roughness: 0.35
    });
    const darkComposite = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      metalness: 0.5,
      roughness: 0.3
    });
    const solarBlue = new THREE.MeshStandardMaterial({
      color: 0x1d4ed8,
      metalness: 0.75,
      roughness: 0.2
    });
    const nozzleGraphite = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.7,
      roughness: 0.4
    });
    const moroccoRed = new THREE.MeshStandardMaterial({
      color: 0xc9182b,
      roughness: 0.6
    });

    // 1. Hexagonal Frame Rims
    for (const y of [0.28, 0.55]) {
      const hexGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.015, 6);
      const hexMesh = new THREE.Mesh(hexGeo, frameMetal);
      hexMesh.position.y = y;
      hexMesh.castShadow = true;
      root.add(hexMesh);
    }

    // 2. Corner Longerons & MLI Gold Panels
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3;
      const x = 0.168 * Math.cos(angle);
      const z = 0.168 * Math.sin(angle);

      const rodGeo = new THREE.CylinderGeometry(0.007, 0.007, 0.27, 8);
      const rodMesh = new THREE.Mesh(rodGeo, frameMetal);
      rodMesh.position.set(x, 0.415, z);
      rodMesh.castShadow = true;
      root.add(rodMesh);

      const midAngle = angle + Math.PI / 6;
      const mx = 0.152 * Math.cos(midAngle);
      const mz = 0.152 * Math.sin(midAngle);
      const panelGeo = new THREE.BoxGeometry(0.16, 0.25, 0.006);
      const panelMesh = new THREE.Mesh(panelGeo, goldMLI);
      panelMesh.position.set(mx, 0.415, mz);
      panelMesh.rotation.y = -midAngle + Math.PI / 2;
      panelMesh.castShadow = true;
      root.add(panelMesh);
    }

    // 3. Identification Panel
    const idPanelGeo = new THREE.BoxGeometry(0.14, 0.16, 0.008);
    const idPanel = new THREE.Mesh(idPanelGeo, darkComposite);
    idPanel.position.set(0, 0.415, -0.158);
    root.add(idPanel);

    const flagGeo = new THREE.BoxGeometry(0.06, 0.04, 0.002);
    const flagMesh = new THREE.Mesh(flagGeo, moroccoRed);
    flagMesh.position.set(0, 0.385, -0.163);
    root.add(flagMesh);

    // 4. Avionics Decks & Tank
    const deckGeo = new THREE.CylinderGeometry(0.145, 0.145, 0.005, 6);
    const deck1 = new THREE.Mesh(deckGeo, frameMetal);
    deck1.position.y = 0.33;
    const deck2 = new THREE.Mesh(deckGeo, frameMetal);
    deck2.position.y = 0.46;
    root.add(deck1, deck2);

    const tankGeo = new THREE.SphereGeometry(0.06, 24, 24);
    tankGeo.scale(1.0, 1.35, 1.0);
    const tankMesh = new THREE.Mesh(tankGeo, frameMetal);
    tankMesh.position.set(0, 0.39, 0.045);
    root.add(tankMesh);

    // 5. Gimbal Assembly & Engine Bell
    const gimbalBossGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.015, 16);
    const gimbalBoss = new THREE.Mesh(gimbalBossGeo, darkComposite);
    gimbalBoss.position.set(0, 0.264, 0);
    root.add(gimbalBoss);

    const chamberGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.024, 16);
    const chamber = new THREE.Mesh(chamberGeo, frameMetal);
    chamber.position.set(0, -0.01, 0);

    const nozzleGeo = new THREE.ConeGeometry(0.035, 0.05, 32, 1, true);
    nozzleGeo.rotateX(Math.PI);
    const nozzleMesh = new THREE.Mesh(nozzleGeo, nozzleGraphite);
    nozzleMesh.position.set(0, -0.04, 0);
    nozzleMesh.castShadow = true;

    this.nozzlePivot.add(chamber);
    this.nozzlePivot.add(nozzleMesh);
    root.add(this.nozzlePivot);

    // 6. Four Landing Legs
    for (let i = 0; i < 4; i++) {
      const legAngle = Math.PI / 4 + (i * Math.PI) / 2;
      const legPivot = new THREE.Group();
      legPivot.position.set(0.142 * Math.cos(legAngle), 0.33, 0.142 * Math.sin(legAngle));
      legPivot.rotation.y = -legAngle;

      const strutGeo = new THREE.CylinderGeometry(0.009, 0.009, 0.22, 12);
      const strut = new THREE.Mesh(strutGeo, darkComposite);
      strut.position.set(0.08, -0.10, 0);
      strut.rotation.z = -0.65;
      strut.castShadow = true;
      legPivot.add(strut);

      const pistonGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.16, 12);
      const piston = new THREE.Mesh(pistonGeo, frameMetal);
      piston.position.set(0.19, -0.25, 0);
      piston.rotation.z = -0.75;
      piston.castShadow = true;
      legPivot.add(piston);

      const footpadGeo = new THREE.CylinderGeometry(0.052, 0.052, 0.01, 32);
      const footpad = new THREE.Mesh(footpadGeo, frameMetal);
      footpad.position.set(0.244, -0.32, 0);
      footpad.castShadow = true;
      legPivot.add(footpad);

      root.add(legPivot);
    }

    // 7. Deployable Solar Panels
    for (const side of [-1, 1]) {
      const solarGroup = new THREE.Group();
      solarGroup.position.set(side * 0.176, 0.54, 0);

      const panelSubstrateGeo = new THREE.BoxGeometry(0.22, 0.006, 0.155);
      const substrate = new THREE.Mesh(panelSubstrateGeo, darkComposite);
      substrate.position.set(side * 0.11, 0, 0);
      solarGroup.add(substrate);

      const cellGeo = new THREE.BoxGeometry(0.20, 0.002, 0.14);
      const cell = new THREE.Mesh(cellGeo, solarBlue);
      cell.position.set(side * 0.11, 0.004, 0);
      solarGroup.add(cell);

      root.add(solarGroup);
    }

    // 8. Sensors
    const lidarGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.04, 16);
    const lidar = new THREE.Mesh(lidarGeo, darkComposite);
    lidar.position.set(0, 0.59, 0);
    root.add(lidar);

    const cameraGeo = new THREE.BoxGeometry(0.035, 0.03, 0.03);
    const camLeft = new THREE.Mesh(cameraGeo, frameMetal);
    camLeft.position.set(-0.04, 0.50, -0.165);
    const camRight = new THREE.Mesh(cameraGeo, frameMetal);
    camRight.position.set(0.04, 0.50, -0.165);
    root.add(camLeft, camRight);

    return root;
  }

  public updateTelemetry(
    x: number,
    y: number,
    z: number,
    q0: number,
    q1: number,
    q2: number,
    q3: number,
    gimbalPitchDeg: number,
    gimbalYawDeg: number,
    thrustCmd: number,
    simTime: number
  ): void {
    if (this.currentModelType === 'SATURN_V') {
      // In Saturn V mode: position rocket on the pad, rising with altitude z
      this.saturnGroup.position.set(x, z, -y);
      this.saturnGroup.quaternion.set(q1, q2, q3, q0);
      // Keep launcher pad fixed at origin on the ground
      this.launcherPadGroup.position.set(0, 0, 0);
    } else {
      // In Dropper X mode:
      this.dropperGroup.position.set(x, z + 0.32, -y);
      this.dropperGroup.quaternion.set(q1, q2, q3, q0);
    }

    // Dynamic 2-Axis Engine Nozzle Gimbaling
    const pitchClamped = THREE.MathUtils.clamp(gimbalPitchDeg, -20.0, 20.0);
    const yawClamped = THREE.MathUtils.clamp(gimbalYawDeg, -20.0, 20.0);
    const pitchRad = THREE.MathUtils.degToRad(pitchClamped);
    const yawRad = THREE.MathUtils.degToRad(yawClamped);

    if (this.gltfNozzlePivot) {
      this.gltfNozzlePivot.rotation.set(pitchRad, 0, yawRad);
    } else {
      this.nozzlePivot.rotation.set(pitchRad, 0, yawRad);
    }

    // Update Vacuum Plume Particle Shader
    this.plume.update(simTime, thrustCmd);
  }

  public dispose(): void {
    this.plume.dispose();
  }
}
