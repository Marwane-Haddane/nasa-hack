import * as THREE from 'three';

export class LunarLighting {
  public group: THREE.Group;
  public sunLight: THREE.DirectionalLight;
  public ambientLight: THREE.AmbientLight;
  public earthshineLight: THREE.DirectionalLight;

  constructor() {
    this.group = new THREE.Group();

    // 1. Direct South Pole Solar Irradiance
    // Solar constant: 1361 W/m². In Three.js, directional light with physical units or balanced intensity
    this.sunLight = new THREE.DirectionalLight(0xffffff, 3.8);

    // Lunar South Pole Grazing Sun Elevation: ~2.0 degrees (0.0349 rad)
    const elevationDeg = 2.4;
    const elevationRad = THREE.MathUtils.degToRad(elevationDeg);
    const azimuthRad = THREE.MathUtils.degToRad(45.0); // 45 deg azimuth

    const sunDistance = 2000.0;
    const sunX = sunDistance * Math.cos(elevationRad) * Math.cos(azimuthRad);
    const sunY = sunDistance * Math.sin(elevationRad); // Low Y elevation
    const sunZ = sunDistance * Math.cos(elevationRad) * Math.sin(azimuthRad);

    this.sunLight.position.set(sunX, sunY, sunZ);
    this.sunLight.castShadow = true;

    // High precision soft shadow maps
    this.sunLight.shadow.mapSize.width = 4096;
    this.sunLight.shadow.mapSize.height = 4096;
    this.sunLight.shadow.camera.near = 50.0;
    this.sunLight.shadow.camera.far = 4000.0;

    const shadowFrustumSize = 350.0;
    this.sunLight.shadow.camera.left = -shadowFrustumSize;
    this.sunLight.shadow.camera.right = shadowFrustumSize;
    this.sunLight.shadow.camera.top = shadowFrustumSize;
    this.sunLight.shadow.camera.bottom = -shadowFrustumSize;
    this.sunLight.shadow.bias = -0.0003;
    this.sunLight.shadow.normalBias = 0.02;

    this.group.add(this.sunLight);

    // 2. Faint Earthshine (Earth is high in the lunar sky reflecting cold blue oceans/clouds)
    this.earthshineLight = new THREE.DirectionalLight(0x93c5fd, 0.18);
    this.earthshineLight.position.set(-800, 1200, -600);
    this.earthshineLight.castShadow = false;
    this.group.add(this.earthshineLight);

    // 3. Regolith Ambient Bounce (Geometric albedo ~0.12, dark regolith keeping shadows pitch-black)
    this.ambientLight = new THREE.AmbientLight(0x1e293b, 0.12);
    this.group.add(this.ambientLight);

    // Default to DAY mode for warm realistic lighting matching Photo 2
    this.setMode('DAY');
  }

  public setMode(mode: 'DAY' | 'NIGHT' | 'LUNAR'): void {
    if (mode === 'DAY') {
      this.sunLight.color.setHex(0xffffff);
      this.sunLight.intensity = 1.1;
      this.sunLight.position.set(100, 180, 120);
      this.sunLight.castShadow = false; // Bright realistic daytime illumination matching Photo 1:1
      this.ambientLight.color.setHex(0xffffff);
      this.ambientLight.intensity = 0.85;
      this.earthshineLight.intensity = 0.0;
    } else if (mode === 'NIGHT') {
      this.sunLight.color.setHex(0x1e293b);
      this.sunLight.intensity = 0.2;
      this.ambientLight.color.setHex(0x0f172a);
      this.ambientLight.intensity = 0.15;
      this.earthshineLight.intensity = 0.05;
    } else {
      // LUNAR South Pole
      this.sunLight.color.setHex(0xffffff);
      this.sunLight.intensity = 3.8;
      this.sunLight.position.set(1400, 100, 1400);
      this.ambientLight.color.setHex(0x1e293b);
      this.ambientLight.intensity = 0.15;
      this.earthshineLight.intensity = 0.2;
    }
  }

  public updateTarget(targetPosition: THREE.Vector3): void {
    // Keep the sun's target aligned with the lander or landing pad
    this.sunLight.target.position.copy(targetPosition);
    this.sunLight.target.updateMatrixWorld();
  }

  public dispose(): void {
    this.sunLight.dispose();
    this.earthshineLight.dispose();
  }
}
