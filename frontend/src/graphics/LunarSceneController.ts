import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { SkyboxEnvironment } from './SkyboxEnvironment';
import { LunarLighting } from './LunarLighting';
import { TerrainMesh } from './TerrainMesh';
import { LanderModel } from './LanderModel';
import { DustAgitationEmitter } from './DustAgitationEmitter';
import { TelemetryPacket } from '../types/telemetry';
import { VisualizerConfig } from '../types/visualizer';

export class LunarSceneController {
  private container: HTMLElement;
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  public controls: OrbitControls;

  // Scene Subsystems
  public skybox: SkyboxEnvironment;
  public lighting: LunarLighting;
  public terrain: TerrainMesh;
  public lander: LanderModel;
  public dustEmitter: DustAgitationEmitter;
  private skyTexture: THREE.Texture | null = null;

  // Trajectory Ribbon in 3D
  private trajectoryLine: THREE.Line;
  private trajectoryGeo: THREE.BufferGeometry;
  private trajectoryPoints: THREE.Vector3[] = [];
  private maxTrajectoryPoints = 600;

  // Animation & Lifecycle
  private animFrameId: number | null = null;
  private clock: THREE.Clock;
  private config: VisualizerConfig;
  private lastTelemetry: TelemetryPacket | null = null;

  constructor(container: HTMLElement, initialConfig?: Partial<VisualizerConfig>) {
    this.container = container;
    this.clock = new THREE.Clock();

    this.config = {
      cameraMode: 'ORBIT',
      showTerrainWireframe: false,
      showSlopeHazards: false,
      showTrajectoryLine: true,
      showDustParticles: true,
      showPlume: true,
      vehicleModel: 'SATURN_V',
      lightingMode: 'DAY',
      ...initialConfig
    };

    // 1. Scene Void & Sky
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x7da4d9); // Daytime atmospheric blue sky matching Photo 1:1

    // Load daytime pure sky EXR texture
    const exrLoader = new EXRLoader();
    const exrUrl = (typeof window !== 'undefined' && window.location && window.location.href)
      ? new URL('/assets/textures/puresky.exr', window.location.href).href
      : '/assets/textures/puresky.exr';
    exrLoader.load(
      exrUrl,
      (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        this.skyTexture = texture;
        if (this.config.lightingMode === 'DAY') {
          this.scene.background = texture;
        }
      },
      undefined,
      () => {}
    );

    // 2. Camera - framed to view Saturn V and Launch Pad majestically (matching Photo 1:1)
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(55, width / Math.max(height, 1), 0.1, 25000);
    this.camera.position.set(10, 8, 55);

    // 3. WebGL Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.container.appendChild(this.renderer.domElement);

    // 4. Orbit Controls (for ORBIT camera mode)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.01;
    this.controls.minDistance = 1.5;
    this.controls.maxDistance = 5000;
    this.controls.target.set(0, 18, 0);
    this.controls.update();

    // 5. Initialize Subsystems
    this.skybox = new SkyboxEnvironment(12000, 9000);
    this.scene.add(this.skybox.starsPoints);

    this.lighting = new LunarLighting();
    this.scene.add(this.lighting.group);

    this.terrain = new TerrainMesh(2000, 200);
    this.scene.add(this.terrain.group);
    this.terrain.loadDemFromApi().catch(() => {});

    this.lander = new LanderModel();
    this.scene.add(this.lander.group);

    this.dustEmitter = new DustAgitationEmitter(1500);
    this.scene.add(this.dustEmitter.points);

    // 6. Trajectory line setup
    this.trajectoryGeo = new THREE.BufferGeometry();
    const trajectoryMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.8,
      linewidth: 2
    });
    this.trajectoryLine = new THREE.Line(this.trajectoryGeo, trajectoryMat);
    this.trajectoryLine.frustumCulled = false;
    this.scene.add(this.trajectoryLine);

    // Window Resize & Keyboard Binding (Press V to switch camera mode)
    window.addEventListener('resize', this.onWindowResize);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyV') {
        const modes: ('ORBIT' | 'CHASE' | 'COCKPIT' | 'LANDING_PAD')[] = ['ORBIT', 'CHASE', 'COCKPIT', 'LANDING_PAD'];
        const nextIdx = (modes.indexOf(this.config.cameraMode) + 1) % modes.length;
        this.setConfig({ cameraMode: modes[nextIdx] });
      }
    });

    // Initial environment
    this.setEnvironmentMode(this.config.lightingMode || 'DAY');

    // Start 60 FPS Render Loop
    this.renderLoop = this.renderLoop.bind(this);
    this.start();
  }

  public setEnvironmentMode(mode: 'DAY' | 'NIGHT' | 'LUNAR'): void {
    if (this.terrain) {
      this.terrain.setEnvironmentMode(mode);
    }
    if (mode === 'DAY') {
      if (this.skyTexture) {
        this.scene.background = this.skyTexture;
      } else {
        this.scene.background = new THREE.Color(0x7da4d9);
      }
      this.skybox.starsPoints.visible = false;
      this.lighting.setMode('DAY');
    } else if (mode === 'NIGHT') {
      this.scene.background = new THREE.Color(0x060814);
      this.skybox.starsPoints.visible = true;
      this.lighting.setMode('NIGHT');
    } else {
      this.scene.background = new THREE.Color(0x000000);
      this.skybox.starsPoints.visible = true;
      this.lighting.setMode('LUNAR');
    }
  }

  public setConfig(newConfig: Partial<VisualizerConfig>): void {
    this.config = { ...this.config, ...newConfig };
    if (this.terrain) {
      this.terrain.setSlopeHazardVisibility(this.config.showSlopeHazards);
      this.terrain.setWireframe(this.config.showTerrainWireframe);
    }
    if (this.trajectoryLine) {
      this.trajectoryLine.visible = this.config.showTrajectoryLine;
    }
    if (newConfig.vehicleModel) {
      this.lander.setVehicleModel(newConfig.vehicleModel);
    }
    if (newConfig.lightingMode) {
      this.setEnvironmentMode(newConfig.lightingMode);
    }
  }

  public updateTelemetry(telemetry: TelemetryPacket): void {
    this.lastTelemetry = telemetry;
    const { position, quaternion, thrust, timestamp } = telemetry;

    // Update Lander 3D Transformation and Gimbal
    this.lander.updateTelemetry(
      position.x,
      position.y,
      position.z,
      quaternion.q0,
      quaternion.q1,
      quaternion.q2,
      quaternion.q3,
      thrust.gimbal_pitch,
      thrust.gimbal_yaw,
      this.config.showPlume ? thrust.cmd : 0.0,
      timestamp
    );

    // Keep lighting target tracking lander
    this.lighting.updateTarget(this.lander.group.position);

    // Append to 3D trajectory line
    const currentPos = this.lander.group.position.clone();
    this.trajectoryPoints.push(currentPos);
    if (this.trajectoryPoints.length > this.maxTrajectoryPoints) {
      this.trajectoryPoints.shift();
    }

    if (this.config.showTrajectoryLine && this.trajectoryPoints.length > 1) {
      this.trajectoryGeo.setFromPoints(this.trajectoryPoints);
    }
  }

  private updateCamera(): void {
    if (!this.lastTelemetry) return;
    const landerPos = this.lander.group.position;

    switch (this.config.cameraMode) {
      case 'CHASE': {
        this.controls.enabled = false;
        // Smooth chase camera trailing 6m back and 2.5m above lander
        const offset = new THREE.Vector3(0, 3.2, 7.5);
        offset.applyQuaternion(this.lander.group.quaternion);
        const desiredPos = landerPos.clone().add(offset);
        this.camera.position.lerp(desiredPos, 0.12);
        this.camera.lookAt(landerPos.x, landerPos.y + 0.3, landerPos.z);
        break;
      }
      case 'COCKPIT': {
        this.controls.enabled = false;
        // Navigation camera on forward avionics deck looking downwards towards ground
        const cockpitPos = landerPos.clone().add(new THREE.Vector3(0, 0.45, -0.2));
        this.camera.position.copy(cockpitPos);
        const lookTarget = landerPos.clone().add(new THREE.Vector3(0, -10.0, -1.0));
        this.camera.lookAt(lookTarget);
        break;
      }
      case 'LANDING_PAD': {
        this.controls.enabled = false;
        // Ground camera positioned at edge of landing pad looking up at incoming lander
        this.camera.position.set(22, 1.2, 22);
        this.camera.lookAt(landerPos.x, landerPos.y, landerPos.z);
        break;
      }
      case 'ORBIT':
      default: {
        this.controls.enabled = true;
        const targetY = this.config.vehicleModel === 'SATURN_V' ? landerPos.y + 18.0 : landerPos.y + 0.3;
        this.controls.target.set(landerPos.x, targetY, landerPos.z);
        this.controls.update();
        break;
      }
    }
  }

  private renderLoop(): void {
    this.animFrameId = requestAnimationFrame(this.renderLoop);
    const dt = Math.min(this.clock.getDelta(), 0.1);

    // Update Dust agitation emitter
    if (this.lastTelemetry && this.config.showDustParticles) {
      this.dustEmitter.update(
        dt,
        this.lander.group.position,
        this.lastTelemetry.position.z,
        this.lastTelemetry.thrust.cmd
      );
    }

    // Camera track
    this.updateCamera();

    // Render WebGL
    try {
      this.renderer.render(this.scene, this.camera);
    } catch {
      // In headless environments without WebGL rasterizer, continue safely
    }
  }

  public start(): void {
    if (!this.animFrameId) {
      this.clock.start();
      this.renderLoop();
    }
  }

  public stop(): void {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  public onWindowResize = (): void => {
    if (!this.container) return;
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  public dispose(): void {
    this.stop();
    window.removeEventListener('resize', this.onWindowResize);

    this.skybox.dispose();
    this.lighting.dispose();
    this.terrain.dispose();
    this.lander.dispose();
    this.dustEmitter.dispose();

    this.trajectoryGeo.dispose();
    this.controls.dispose();
    this.renderer.dispose();

    if (this.container && this.renderer.domElement && this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
