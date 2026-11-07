import * as THREE from 'three';

const terrainVertexShader = `
  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const terrainFragmentShader = `
  uniform bool uShowSlopeHazard;
  uniform vec3 uSunDirection;
  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying vec2 vUv;

  void main() {
    // Calculate terrain surface normal in world space
    vec3 N = normalize(vNormal);
    vec3 L = normalize(uSunDirection);

    // Slope angle relative to vertical lunar normal [0, 1, 0]
    float slopeCos = clamp(dot(N, vec3(0.0, 1.0, 0.0)), 0.0, 1.0);
    float slopeAngleDeg = acos(slopeCos) * 57.2957795; // 180 / PI

    // Simple diffuse solar Lambertian lighting + ambient
    float diff = max(dot(N, L), 0.0);
    float lighting = 0.08 + 0.92 * diff;

    // Regolith baseline lunar albedo (~0.12)
    vec3 regolithBase = vec3(0.18, 0.20, 0.22);
    // Subtle procedural crater micro-texture variation
    float noiseVar = sin(vWorldPosition.x * 0.05) * cos(vWorldPosition.z * 0.05) * 0.03;
    regolithBase += vec3(noiseVar);

    vec3 finalColor = regolithBase;

    if (uShowSlopeHazard) {
      // Color-coded slope hazards:
      // < 5.0 deg: Safe (Emerald Green)
      // 5.0 to 15.0 deg: Caution (Amber)
      // > 15.0 deg: Severe tip-over hazard (Crimson Red)
      vec3 safeColor = vec3(0.06, 0.72, 0.51);    // #10b981
      vec3 cautionColor = vec3(0.96, 0.62, 0.07); // #f59e0b
      vec3 hazardColor = vec3(0.94, 0.27, 0.27);  // #ef4444

      vec3 hazardOverlay;
      if (slopeAngleDeg <= 5.0) {
        hazardOverlay = safeColor;
      } else if (slopeAngleDeg <= 15.0) {
        float factor = (slopeAngleDeg - 5.0) / 10.0;
        hazardOverlay = mix(safeColor, cautionColor, factor);
      } else {
        float factor = clamp((slopeAngleDeg - 15.0) / 15.0, 0.0, 1.0);
        hazardOverlay = mix(cautionColor, hazardColor, factor);
      }

      // Blend hazard heatmap with terrain topography lighting
      finalColor = mix(regolithBase * lighting, hazardOverlay * lighting, 0.65);
    } else {
      finalColor *= lighting;
    }

    // Distance fog / vacuum clarity (pure black vacuum, no atmospheric haze)
    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

export class TerrainMesh {
  public group: THREE.Group;
  public terrainMesh: THREE.Mesh;
  public landingPadMesh: THREE.Group;
  private material: THREE.ShaderMaterial;
  private geometry: THREE.PlaneGeometry;

  constructor(size = 2000, segments = 200) {
    this.group = new THREE.Group();

    // 1. Shackleton Crater Rim Geometry
    this.geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    this.geometry.rotateX(-Math.PI / 2); // Rotate to lie in X-Z horizontal plane

    const posAttr = this.geometry.attributes.position;
    const vertexCount = posAttr.count;

    // Procedural elevation profile: Shackleton Crater Wall + Plateau Rim + Micro-Craters
    const craterRadius = 600.0;
    const rimWidth = 140.0;
    const maxRimHeight = 120.0;

    for (let i = 0; i < vertexCount; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);
      const dist = Math.sqrt(x * x + z * z);

      // Smooth crater bowl and rim wall
      let elev = 0.0;
      if (dist < craterRadius) {
        // Inside crater basin (deep negative elevation)
        const depthFactor = 1.0 - (dist / craterRadius);
        elev = -180.0 * Math.pow(depthFactor, 1.6);
      } else if (dist < craterRadius + rimWidth) {
        // Rim crest
        const rimT = (dist - craterRadius) / rimWidth;
        elev = maxRimHeight * Math.sin(rimT * Math.PI);
      } else {
        // Outer plateau with gentle rolling hills
        const outerDist = dist - (craterRadius + rimWidth);
        elev = Math.sin(outerDist * 0.015) * 12.0 + Math.cos(x * 0.01) * 8.0;
      }

      // Add secondary multi-octave roughness
      elev += Math.sin(x * 0.03) * Math.cos(z * 0.03) * 3.5;
      elev += Math.sin(x * 0.08 + 1.2) * Math.cos(z * 0.08 + 0.4) * 1.2;

      // Flatten the designated precision landing pad region at (0, 0)
      if (dist < 40.0) {
        elev *= Math.pow(dist / 40.0, 2.0);
      }

      posAttr.setY(i, elev);
    }

    this.geometry.computeVertexNormals();

    this.material = new THREE.ShaderMaterial({
      vertexShader: terrainVertexShader,
      fragmentShader: terrainFragmentShader,
      uniforms: {
        uShowSlopeHazard: { value: false },
        uSunDirection: { value: new THREE.Vector3(0.8, 0.4, 0.6).normalize() }
      },
      side: THREE.DoubleSide
    });

    this.terrainMesh = new THREE.Mesh(this.geometry, this.material);
    this.terrainMesh.receiveShadow = true;
    this.terrainMesh.castShadow = true;
    this.group.add(this.terrainMesh);

    // 2. Concentric Landing Pad Target Rings (Origin [0, 0, 0])
    this.landingPadMesh = new THREE.Group();
    this.createLandingPad();
    this.group.add(this.landingPadMesh);
  }

  private createLandingPad(): void {
    // Precision touchdown concentric circles at 10m, 25m, 50m
    const ringRadii = [10, 25, 50];
    const ringColors = [0x10b981, 0x38bdf8, 0xf59e0b];

    ringRadii.forEach((radius, idx) => {
      const ringGeo = new THREE.RingGeometry(radius - 0.35, radius + 0.35, 64);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color: ringColors[idx],
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.position.y = 0.08; // slightly above ground to prevent z-fighting
      this.landingPadMesh.add(ringMesh);
    });

    // Crosshair lines
    const lineMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.8 });
    const crossGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-55, 0.1, 0),
      new THREE.Vector3(55, 0.1, 0),
      new THREE.Vector3(0, 0.1, -55),
      new THREE.Vector3(0, 0.1, 55),
    ]);
    const crosshairs = new THREE.LineSegments(crossGeo, lineMat);
    this.landingPadMesh.add(crosshairs);

    // Center illuminated target beacon point
    const centerGeo = new THREE.CircleGeometry(2.0, 32);
    centerGeo.rotateX(-Math.PI / 2);
    const centerMat = new THREE.MeshBasicMaterial({ color: 0x10b981, side: THREE.DoubleSide });
    const centerDisc = new THREE.Mesh(centerGeo, centerMat);
    centerDisc.position.y = 0.1;
    this.landingPadMesh.add(centerDisc);
  }

  public setSlopeHazardVisibility(visible: boolean): void {
    this.material.uniforms.uShowSlopeHazard.value = visible;
  }

  public setWireframe(wireframe: boolean): void {
    this.material.wireframe = wireframe;
  }

  public applyDemData(data: { vertices: number[]; slopes?: number[]; hazards?: number[] }): void {
    if (!data || !data.vertices || data.vertices.length < 3) return;
    const posAttr = this.geometry.attributes.position;
    const totalVertices = posAttr.count;
    const dataVertices = data.vertices;
    const count = Math.min(totalVertices, Math.floor(dataVertices.length / 3));

    for (let i = 0; i < count; i++) {
      const elev = dataVertices[i * 3 + 2];
      posAttr.setY(i, elev);
    }

    posAttr.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  public async loadDemFromApi(apiUrl?: string): Promise<boolean> {
    try {
      if (typeof fetch !== 'function') return false;
      const defaultHost = (typeof window !== 'undefined' && window.location && window.location.hostname)
        ? window.location.hostname
        : 'localhost';
      const url = apiUrl || `http://${defaultHost}:8000/api/terrain?size=2000&segments=200`;
      const res = await fetch(url);
      if (!res.ok) return false;
      const data = await res.json();
      this.applyDemData(data);
      return true;
    } catch {
      // Fallback silently remains procedural Shackleton model
      return false;
    }
  }

  public dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.landingPadMesh.children.forEach(child => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else child.material.dispose();
      }
    });
  }
}
