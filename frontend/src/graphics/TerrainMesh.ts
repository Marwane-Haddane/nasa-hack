import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

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
    vec3 N = normalize(vNormal);
    vec3 L = normalize(uSunDirection);

    float slopeCos = clamp(dot(N, vec3(0.0, 1.0, 0.0)), 0.0, 1.0);
    float slopeAngleDeg = acos(slopeCos) * 57.2957795;

    float diff = max(dot(N, L), 0.0);
    float lighting = 0.08 + 0.92 * diff;

    vec3 regolithBase = vec3(0.18, 0.20, 0.22);
    float noiseVar = sin(vWorldPosition.x * 0.05) * cos(vWorldPosition.z * 0.05) * 0.03;
    regolithBase += vec3(noiseVar);

    vec3 finalColor = regolithBase;

    if (uShowSlopeHazard) {
      vec3 safeColor = vec3(0.06, 0.72, 0.51);
      vec3 cautionColor = vec3(0.96, 0.62, 0.07);
      vec3 hazardColor = vec3(0.94, 0.27, 0.27);

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

      finalColor = mix(regolithBase * lighting, hazardOverlay * lighting, 0.65);
    } else {
      finalColor *= lighting;
    }

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

export class TerrainMesh {
  public group: THREE.Group;
  public terrainMesh: THREE.Mesh;
  public landingPadMesh: THREE.Group;
  public launchComplexGroup: THREE.Group;

  private material: THREE.ShaderMaterial;
  private geometry: THREE.PlaneGeometry;
  private groundMesh: THREE.Mesh | null = null;
  private iteBuildingGroup: THREE.Group | null = null;
  private mountainsGroup: THREE.Group | null = null;

  constructor(size = 2000, segments = 200) {
    this.group = new THREE.Group();

    // 1. Shackleton Lunar Crater Rim Geometry (for lunar mode)
    this.geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    this.geometry.rotateX(-Math.PI / 2);

    const posAttr = this.geometry.attributes.position;
    const vertexCount = posAttr.count;
    const craterRadius = 600.0;
    const rimWidth = 140.0;
    const maxRimHeight = 120.0;

    for (let i = 0; i < vertexCount; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);
      const dist = Math.sqrt(x * x + z * z);
      let elev = 0;

      if (dist < 40.0) {
        elev = 0.0;
      } else if (dist < craterRadius) {
        const t = (dist - 40.0) / (craterRadius - 40.0);
        elev = -35.0 * Math.sin(t * (Math.PI / 2));
      } else if (dist <= craterRadius + rimWidth) {
        const t = (dist - craterRadius) / rimWidth;
        elev = maxRimHeight * Math.sin(t * Math.PI);
      } else {
        const falloff = Math.exp(-(dist - (craterRadius + rimWidth)) / 300.0);
        elev = maxRimHeight * 0.15 * falloff;
      }

      const microNoise = Math.sin(x * 0.035) * Math.cos(z * 0.035) * 4.2;
      elev += microNoise;
      if (dist < 40.0) elev = 0.0;
      posAttr.setY(i, elev);
    }

    this.geometry.computeVertexNormals();

    this.material = new THREE.ShaderMaterial({
      vertexShader: terrainVertexShader,
      fragmentShader: terrainFragmentShader,
      uniforms: {
        uShowSlopeHazard: { value: false },
        uSunDirection: { value: new THREE.Vector3(0.65, 0.45, 0.61).normalize() },
      },
      wireframe: false,
    });

    this.terrainMesh = new THREE.Mesh(this.geometry, this.material);
    this.terrainMesh.receiveShadow = true;
    this.group.add(this.terrainMesh);

    // 2. Lunar Landing Pad Target
    this.landingPadMesh = new THREE.Group();
    this.createLandingPad();
    this.group.add(this.landingPadMesh);

    // 3. Earth Launch Complex Group (Matching Photo 1:1)
    this.launchComplexGroup = new THREE.Group();
    this.launchComplexGroup.position.set(0, -18.8, 0);
    this.group.add(this.launchComplexGroup);

    this.setupLaunchComplexGround();
    this.setupIteBuilding();
    this.setupMountains();

    // Default to DAY mode: Launch complex visible, lunar terrain hidden
    this.setEnvironmentMode('DAY');
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

  private setupLaunchComplexGround(): void {
    const textureLoader = new THREE.TextureLoader();
    const groundTexture = textureLoader.load(this.resolveUrl('/assets/textures/ground.jpg'));
    groundTexture.wrapS = THREE.RepeatWrapping;
    groundTexture.wrapT = THREE.RepeatWrapping;
    groundTexture.repeat.set(30, 30);

    const groundGeo = new THREE.CylinderGeometry(2500, 2500, 1.0, 64);
    const groundMat = new THREE.MeshStandardMaterial({
      map: groundTexture,
      roughness: 0.9,
      metalness: 0.1,
    });

    this.groundMesh = new THREE.Mesh(groundGeo, groundMat);
    this.groundMesh.position.set(0, 0, 0);
    this.groundMesh.receiveShadow = true;
    this.launchComplexGroup.add(this.groundMesh);
  }

  private setupIteBuilding(): void {
    this.iteBuildingGroup = new THREE.Group();
    this.launchComplexGroup.add(this.iteBuildingGroup);

    const textureLoader = new THREE.TextureLoader();
    const iteFrontTex = textureLoader.load(this.resolveUrl('/assets/textures/ite/ite_front.jpg'));
    const iteLeftTex = textureLoader.load(this.resolveUrl('/assets/textures/ite/ite_left.jpg'));
    const iteTitleTex = textureLoader.load(this.resolveUrl('/assets/textures/ite/ite_title.png'));
    const iteUpTex = textureLoader.load(this.resolveUrl('/assets/textures/ite/ite_up.jpg'));

    const wallHeight = 100;
    const wallThickness = 10;
    const wallLength = 500;

    const wallPositions = [
      { x: -400, y: wallHeight / 2, z: 300 },
      { x: -400, y: wallHeight / 2, z: -200 },
      { x: -150, y: wallHeight / 2, z: 50 },
      { x: -650, y: wallHeight / 2, z: 50 },
    ];

    const wallRotations = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: Math.PI / 2, z: 0 },
      { x: 0, y: Math.PI / 2, z: 0 },
    ];

    const wallTextures = [
      iteLeftTex,
      iteLeftTex,
      iteFrontTex,
      iteLeftTex,
    ];

    wallPositions.forEach((pos, index) => {
      const geometry = new THREE.BoxGeometry(wallLength, wallHeight, wallThickness);
      const material = new THREE.MeshStandardMaterial({
        map: wallTextures[index],
        roughness: 0.6,
        metalness: 0.1,
      });

      const wall = new THREE.Mesh(geometry, material);
      wall.position.set(pos.x, pos.y, pos.z);
      wall.rotation.set(wallRotations[index].x, wallRotations[index].y, wallRotations[index].z);
      wall.receiveShadow = true;
      wall.castShadow = true;
      this.iteBuildingGroup?.add(wall);
    });

    // Inscription wall monument ("جامعة دمشق كلية الهندسة المعلوماتية")
    const titleGeo = new THREE.BoxGeometry(75, 100, 5);
    const titleMat = new THREE.MeshStandardMaterial({
      map: iteTitleTex,
      roughness: 0.5,
      metalness: 0.1,
      transparent: true,
      opacity: 1.0,
    });
    const titleWall = new THREE.Mesh(titleGeo, titleMat);
    titleWall.position.set(-110, 50, -125);
    titleWall.receiveShadow = true;
    titleWall.castShadow = true;
    this.iteBuildingGroup.add(titleWall);

    // Roof
    const roofGeo = new THREE.BoxGeometry(500, 10, 500);
    const roofMat = new THREE.MeshStandardMaterial({
      map: iteUpTex,
      roughness: 0.7,
      metalness: 0.1,
    });
    const roofMesh = new THREE.Mesh(roofGeo, roofMat);
    roofMesh.position.set(-400, 95, 50);
    roofMesh.receiveShadow = true;
    roofMesh.castShadow = true;
    this.iteBuildingGroup.add(roofMesh);
  }

  private setupMountains(): void {
    this.mountainsGroup = new THREE.Group();
    this.launchComplexGroup.add(this.mountainsGroup);

    const loader = new GLTFLoader();
    loader.load(
      this.resolveUrl('/assets/models/untitled2.glb'),
      (gltf) => {
        const mountain1 = gltf.scene;
        mountain1.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.receiveShadow = true;
          }
        });

        // desert2 position from reference repo: (+1231.5, -369.2, -2198.7)
        mountain1.position.set(1231.5, -369.2, -2198.7);
        mountain1.rotation.set(0, 1.56, 0);
        mountain1.scale.set(30, 30, 30);
        this.mountainsGroup?.add(mountain1);

        // desert1 position from reference repo: (-1360.2, -369.2, +2451.2)
        const mountain2 = mountain1.clone();
        mountain2.position.set(-1360.2, -369.2, 2451.2);
        mountain2.rotation.set(0, -1.56, 0);
        mountain2.scale.set(30, 30, 30);
        this.mountainsGroup?.add(mountain2);
      },
      undefined,
      () => {
        // Fallback silently if unavailable
      }
    );
  }

  public setEnvironmentMode(mode: 'DAY' | 'NIGHT' | 'LUNAR'): void {
    if (mode === 'LUNAR') {
      this.launchComplexGroup.visible = false;
      this.terrainMesh.visible = true;
      this.landingPadMesh.visible = true;
    } else {
      this.launchComplexGroup.visible = true;
      this.terrainMesh.visible = false;
      this.landingPadMesh.visible = false;
    }
  }

  private createLandingPad(): void {
    const ringRadii = [10, 25, 50];
    const ringColors = [0x10b981, 0x38bdf8, 0xf59e0b];

    ringRadii.forEach((radius, idx) => {
      const ringGeo = new THREE.RingGeometry(radius - 0.35, radius + 0.35, 64);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color: ringColors[idx],
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.position.y = 0.08;
      this.landingPadMesh.add(ringMesh);
    });

    const lineMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.8 });
    const crossGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-55, 0.1, 0),
      new THREE.Vector3(55, 0.1, 0),
      new THREE.Vector3(0, 0.1, -55),
      new THREE.Vector3(0, 0.1, 55),
    ]);
    const crosshairs = new THREE.LineSegments(crossGeo, lineMat);
    this.landingPadMesh.add(crosshairs);

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
      const defaultHost =
        typeof window !== 'undefined' && window.location && window.location.hostname
          ? window.location.hostname
          : 'localhost';
      const url = apiUrl || `http://${defaultHost}:8000/api/terrain?size=2000&segments=200`;
      const res = await fetch(url);
      if (!res.ok) return false;
      const data = await res.json();
      this.applyDemData(data);
      return true;
    } catch {
      return false;
    }
  }

  public dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.landingPadMesh.children.forEach((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
        else child.material.dispose();
      }
    });
  }
}
