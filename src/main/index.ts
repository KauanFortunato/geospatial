import "../styles.css"; // Import the CSS file

import {
  EffectMaterial,
  EffectComposer,
  EffectPass,
  NormalPass,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
  SMAAEffect,
  LUT3DEffect,
} from "postprocessing";
import {
  HalfFloatType,
  NoToneMapping,
  Mesh,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  Matrix4,
  WebGLRenderer,
  TextureLoader,
  Plane,
  Texture,
  AmbientLight,
  BoxGeometry,
  SphereGeometry,
  CatmullRomCurve3,
  CanvasTexture,
  SpriteMaterial,
  Group,
  Sprite,
  Line,
  LineBasicMaterial,
  BufferGeometry,
  MeshStandardMaterial,
} from "three";
import { Globe } from "../globe";
import { AerialPerspectiveEffect, PrecomputedTexturesLoader, SkyMaterial } from "@takram/three-atmosphere";
import { DitheringEffect, LensFlareEffect, createHaldLookupTexture } from "@takram/three-geospatial-effects";
import { getMoonDirectionECI, getSunDirectionECI, getECIToECEFRotationMatrix } from "../utils/celestialDirections";
import { Geodetic, PointOfView, radians } from "@takram/three-geospatial";
import { CloudsEffect } from "@takram/three-clouds";
import { Team } from "../models/Team";
import { Driver } from "../models/Driver";
import { Car } from "../models/Car";

let globalScale = 1 / 1300;
let globe: Globe;
let renderer: WebGLRenderer;
let camera: PerspectiveCamera;
let scene: Scene;
let skyMaterial: SkyMaterial;
let aerialPerspective: AerialPerspectiveEffect;
let composer: EffectComposer;
let lutTexture: Texture;
let lutEffect: LUT3DEffect;
let clouds: CloudsEffect;
let trackCurve: CatmullRomCurve3 | null = null;
let trackTime = 0;
let currentFollowDriver: Driver | null = null;
const initialPositions: Vector3[] = [];
const drivers: Driver[] = [];
const labelOffset = new Vector3(0, 0, 30);

const longitude = -46.69670296197944; // degrees
const latitude = -23.701353134423925; // degrees
// Calculate the center point on the globe in ECEF coordinates
const centerECEF = new Geodetic(radians(longitude), radians(latitude), 0).toECEF().multiplyScalar(globalScale);

const cameraUp = centerECEF.clone().normalize();

const rawLLA = [
  [-23.703697100829874, -46.699994234674826, 0],
  [-23.7036216179702, -46.699941677134376, 0],
  [-23.703572683592377, -46.70002605739498, 0],
  [-23.70348206444485, -46.69998057194944, 0],
  [-23.703426988925894, -46.70006950216714, 0],
];

const cameraPositions: Vector3[] = [
  new Vector3(4008116.5561791877, -4253458.877660439, -2548691.1126270886).multiplyScalar(globalScale),
  new Vector3(4008724.1549734552, -4253127.057619564, -2548582.1141718035).multiplyScalar(globalScale),
];

for (const [lon, lat, alt] of rawLLA) {
  const geo = new Geodetic(radians(lon), radians(lat), alt);
  initialPositions.push(geo.toECEF());
}

const sunDirection = new Vector3();
const moonDirection = new Vector3();
const rotationMatrix = new Matrix4();

async function loadGPXasECEF(url: string): Promise<Vector3[]> {
  const res = await fetch(url);
  const text = await res.text();
  const parser = new DOMParser();
  const xml = parser.parseFromString(text, "application/xml");
  const trkpts = xml.querySelectorAll("trkpt");

  const points: Vector3[] = [];

  trkpts.forEach((pt) => {
    const lat = parseFloat(pt.getAttribute("lat") || "0");
    const lon = parseFloat(pt.getAttribute("lon") || "0");

    // Extrai a elevação (altitude) se existir
    const eleElem = pt.querySelector("ele");
    const alt = eleElem ? parseFloat(eleElem.textContent || "0") : 0;

    const geo = new Geodetic(radians(lon), radians(lat), alt - 4);
    points.push(geo.toECEF());
  });

  console.log("GPX Points:", points.length, points);
  return points;
}

// Tokyo time 9:00AM
const referenceDate = new Date("2024-01-01T22:00:00+09:00");

function init(): void {
  // scene
  scene = new Scene();

  // renderer
  renderer = new WebGLRenderer({
    powerPreference: "high-performance",
    antialias: true,
    stencil: true,
    depth: true,
    logarithmicDepthBuffer: true,
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = NoToneMapping;
  renderer.toneMappingExposure = 0.5;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  const container = document.getElementById("container");
  if (container) {
    container.appendChild(renderer.domElement);
  }

  // Ligh
  const ambientLight = new AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  // Create drivers and teams
  createDriversAndTeams();
  const followContainer = document.getElementById("follow-buttons");
  drivers.forEach((driver) => {
    const btn = document.createElement("button");
    btn.textContent = `Seguir ${driver.acronym.toUpperCase()}`;
    btn.addEventListener("click", () => {
      if (currentFollowDriver === driver) {
        currentFollowDriver = null;
        btn.textContent = `Seguir ${driver.acronym.toUpperCase()}`;
      } else {
        currentFollowDriver = driver;
        // Opcional: resetar os outros botões
        document.querySelectorAll("#follow-buttons button").forEach((b) => {
          b.textContent = `Seguir ${b.textContent?.split(" ")[1]}`;
        });
        btn.textContent = "Parar de Seguir";
      }
    });
    followContainer?.appendChild(btn);
  });

  // Ensure the camera's up vector is set correctly (usually Y-up for camera space)
  // The .decompose method should handle this via the quaternion,
  // but explicitly setting it can prevent issues if the camera was previously manipulated.

  // Update projection matrix if aspect ratio changed
  // camera
  const aspect = window.innerWidth / window.innerHeight;
  camera = new PerspectiveCamera(75, aspect, 0.001, 100);

  camera.position.copy(cameraPositions[1]); // Use the first camera position from the array
  camera.up.copy(cameraUp);
  camera.lookAt(centerECEF);

  camera.aspect = aspect;
  camera.updateProjectionMatrix();

  const center = new Geodetic(radians(longitude), radians(latitude), 0).toECEF().multiplyScalar(globalScale);
  const radiusMeters = 650; // metade do tamanho do quadrado

  // Criar vetores locais: Leste, Norte, Cima (ENU)
  const up = center.clone().normalize(); // direção radial (Z)
  const east = new Vector3(0, 0, 1).cross(up).normalize(); // Eixo Leste
  const north = up.clone().cross(east).normalize(); // Eixo Norte

  // Calcular pontos da borda do quadrado
  const eastOffset = east.clone().multiplyScalar(radiusMeters * globalScale);
  const westOffset = east.clone().multiplyScalar(-radiusMeters * globalScale);
  const northOffset = north.clone().multiplyScalar(radiusMeters * globalScale);
  const southOffset = north.clone().multiplyScalar(-radiusMeters * globalScale);

  // Pontos dos 4 limites
  const eastPoint = center.clone().add(eastOffset);
  const westPoint = center.clone().add(westOffset);
  const northPoint = center.clone().add(northOffset);
  const southPoint = center.clone().add(southOffset);

  // Normais dos planos (apontam para dentro do quadrado)
  const eastNormal = east.clone().negate();
  const westNormal = east.clone();
  const northNormal = north.clone().negate();
  const southNormal = north.clone();

  // Criar os planos com base nas normais e pontos
  const clippingPlanes = [
    new Plane(eastNormal, -eastNormal.dot(eastPoint)),
    new Plane(westNormal, -westNormal.dot(westPoint)),
    new Plane(northNormal, -northNormal.dot(northPoint)),
    new Plane(southNormal, -southNormal.dot(southPoint)),
  ];

  // Ativar no renderer
  renderer.clippingPlanes = clippingPlanes;
  renderer.localClippingEnabled = true;

  // Create the sky
  skyMaterial = new SkyMaterial();
  const sky = new Mesh(new PlaneGeometry(2, 2), skyMaterial);
  sky.frustumCulled = false;
  // scene.add(sky);

  globe = new Globe(scene, camera, renderer, /* disableControls= */ true);
  // globe.tiles.group.scale.set(0.5, 0.5, 0.5);
  scene.add(globe.tiles.group);
  scene.scale.multiplyScalar(globalScale);

  // Demonstrates forward lighting here. For deferred lighting, set
  // sunIrradiance and skyIrradiance to true, remove SkyLightProbe and
  // SunDirectionalLight, and provide a normal buffer to
  // AerialPerspectiveEffect.
  aerialPerspective = new AerialPerspectiveEffect(camera, {
    correctGeometricError: false,
    correctAltitude: false,
    inscatter: false,
    photometric: false,
    skyIrradiance: false,
    sunIrradiance: false,
    transmittance: false,
    irradianceScale: 2 / Math.PI,
    sky: false,
    sun: false,
    moon: false,
  });

  clouds = new CloudsEffect(camera);
  clouds.coverage = 0.3;
  clouds.localWeatherVelocity.set(0.001, 0);
  clouds.shadow.farScale = 0.25;
  clouds.shadow.maxFar = 1e5;
  clouds.shadow.cascadeCount = 2;
  clouds.shadow.mapSize.set(512, 512);
  clouds.shadow.splitMode = "practical";
  clouds.shadow.splitLambda = 0.71;

  // Load precomputed textures.
  const basePath = import.meta.env.BASE_URL || "/";
  new PrecomputedTexturesLoader().setTypeFromRenderer(renderer).load(basePath + "assets/atmosphere", onPrecomputedTexturesLoad);

  // --------------------------------
  //  Color Grading is not working
  // --------------------------------
  // Load the LUT texture for color grading
  const textureLoader = new TextureLoader();
  // You can change the LUT file path to any of your available LUTs
  const lutPath = basePath + "assets/clut/Fuji/Fuji 160C 1 -.png";
  textureLoader.load(lutPath, (texture) => {
    lutTexture = createHaldLookupTexture(texture);
    lutEffect = new LUT3DEffect(lutTexture);
    if (composer) {
      // composer.addPass(new EffectPass(camera, lutEffect));
    }
  });

  // Use floating-point render buffer, as radiance/luminance is stored here.
  composer = new EffectComposer(renderer, {
    frameBufferType: HalfFloatType,
    multisampling: 8,
  });

  const normalPass = new NormalPass(scene, camera);
  aerialPerspective.normalBuffer = normalPass.texture;

  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(normalPass);
  composer.addPass(new EffectPass(camera, aerialPerspective));
  composer.addPass(new EffectPass(camera, new LensFlareEffect()));
  composer.addPass(new EffectPass(camera, new ToneMappingEffect({ mode: ToneMappingMode.AGX })));
  composer.addPass(new EffectPass(camera, new SMAAEffect()));
  composer.addPass(new EffectPass(camera, new DitheringEffect()));

  window.addEventListener("resize", onWindowResize);

  const gpxUrl = new URL("./Autodromo_de_Interlagos__Sao_Paulo_SP__Brasil.gpx", import.meta.url).href;
  loadGPXasECEF(gpxUrl).then((points) => {
    if (points.length > 1) {
      console.log("GPX Points loaded:", points.length);
      trackCurve = new CatmullRomCurve3(points, false); // false = circuito aberto
    } else {
      console.warn("Nenhum ponto GPX carregado");
    }

    console.log("N points:", points.length);
    for (let i = 0; i < points.length; i++) {
      const sphereGeometry = new SphereGeometry(2);
      const sphereMaterial = new MeshStandardMaterial({ color: 0xff0000 });
      const sphere = new Mesh(sphereGeometry, sphereMaterial);
      sphere.position.copy(points[i]);
      scene.add(sphere);
    }
  });

  // Camera controls
  document.getElementById("camera-position-1")?.addEventListener("click", () => {
    animateCameraTo(cameraPositions[0], cameraUp, centerECEF, 1500);
  });

  document.getElementById("camera-position-2")?.addEventListener("click", () => {
    animateCameraTo(cameraPositions[1], cameraUp, centerECEF, 1500);
  });
}

function render(): void {
  const date = referenceDate;
  getECIToECEFRotationMatrix(date, rotationMatrix);
  getSunDirectionECI(date, sunDirection).applyMatrix4(rotationMatrix);
  getMoonDirectionECI(date, moonDirection).applyMatrix4(rotationMatrix);

  skyMaterial.sunDirection.copy(sunDirection);
  skyMaterial.moonDirection.copy(moonDirection);

  aerialPerspective.sunDirection.copy(sunDirection);
  aerialPerspective.moonDirection.copy(moonDirection);

  globe.update();
  // console.log("Camera position:", camera.position.toArray());

  // Update effect materials with current camera settings
  if (composer) {
    composer.passes.forEach((pass) => {
      if (pass.fullscreenMaterial instanceof EffectMaterial) {
        pass.fullscreenMaterial.adoptCameraSettings(camera);
      }
    });

    if (trackCurve && drivers.length > 0) {
      trackTime += 0.00003;
      if (trackTime > 1) trackTime = 0;

      // Add null check for trackCurve
      const spacing = 0.005;

      drivers.forEach((driver, index) => {
        const t = (trackTime - index * spacing + 1) % 1;
        const pos = trackCurve?.getPointAt(t);
        if (pos) {
          driver.positionOnTrack(pos);
          driver.updateLabel(camera, labelOffset);
        }
      });
    }

    if (currentFollowDriver && trackCurve) {
      const pos = currentFollowDriver.car.mesh.position.clone().multiplyScalar(globalScale);
      const tangent = trackCurve.getTangentAt(trackTime);
      const up = pos.clone().normalize();
      const cameraOffset = tangent.clone().multiplyScalar(-30).add(up.clone().multiplyScalar(15)).multiplyScalar(globalScale);
      const cameraPos = pos.clone().add(cameraOffset);
      camera.position.copy(cameraPos);
      camera.up.copy(up);
      camera.lookAt(pos.clone().add(tangent.clone().multiplyScalar(10)));
    }

    composer.render();
  }
}

function onPrecomputedTexturesLoad(textures: any): void {
  Object.assign(skyMaterial, textures);
  Object.assign(aerialPerspective, textures);
  Object.assign(clouds, textures);

  renderer.setAnimationLoop(render);
}

function onWindowResize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function createDriverLabel(text: string, color: string): Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "white";
  ctx.font = "bold 50px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new CanvasTexture(canvas);
  const material = new SpriteMaterial({
    map: texture,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    toneMapped: false,
  });
  const sprite = new Sprite(material);
  sprite.scale.set(40, 10, 1);
  sprite.renderOrder = 999;
  return sprite;
}

function animateCameraTo(targetPos: Vector3, targetUp: Vector3, targetLookAt: Vector3, duration = 2000) {
  const startPos = camera.position.clone();
  const startUp = camera.up.clone();
  const startQuat = camera.quaternion.clone();

  // Criar uma câmera temporária para calcular a rotação final
  const tempCam = camera.clone();
  tempCam.position.copy(targetPos);
  tempCam.up.copy(targetUp);
  tempCam.lookAt(targetLookAt);
  tempCam.updateMatrixWorld();
  const targetQuat = tempCam.quaternion.clone();

  const startTime = performance.now();

  function update() {
    const elapsed = performance.now() - startTime;
    const t = Math.min(elapsed / duration, 1);

    // Interpolar posição e up
    camera.position.lerpVectors(startPos, targetPos, t);
    camera.up.lerpVectors(startUp, targetUp, t);
    camera.quaternion.slerpQuaternions(startQuat, targetQuat, t);

    camera.updateMatrixWorld();

    if (t < 1) {
      requestAnimationFrame(update);
    }
  }

  requestAnimationFrame(update);
}

function createDriversAndTeams() {
  // Create drivers and teams
  let redBull = new Team("Red Bull Racing", "#1E41FF");
  let mercedes = new Team("Mercedes-AMG Petronas", "#00D2BE");
  let ferrari = new Team("Scuderia Ferrari", "#DC0000");
  let mclaren = new Team("McLaren F1 Team", "#FF8700");

  let verstappen = new Driver("Max Verstappen", "ver", 1, "Netherlands", 1, 0, new Car(1, "RB19", redBull));
  let oscar = new Driver("Oscar Piastri", "pia", 81, "Australia", 7, 0, new Car(81, "MCL60", mclaren));
  let hamilton = new Driver("Lewis Hamilton", "ham", 44, "United Kingdom", 3, 0, new Car(44, "W14", ferrari));
  let kimi = new Driver("Kimi Räikkönen", "rak", 7, "Finland", 4, 0, new Car(7, "C42", mercedes));

  // Set initial positions for the drivers
  verstappen.positionOnTrack(initialPositions[0]);
  kimi.positionOnTrack(initialPositions[1]);
  oscar.positionOnTrack(initialPositions[2]);
  hamilton.positionOnTrack(initialPositions[3]);

  // Add drivers to the scene
  drivers.push(verstappen, oscar, hamilton, kimi);

  drivers.forEach((driver) => {
    driver.label = createDriverLabel(driver.acronym.toUpperCase(), driver.car.team.color);
    scene.add(driver.label);

    const lineMaterial = new LineBasicMaterial({ color: 0xffffff });
    const lineGeometry = new BufferGeometry().setFromPoints([driver.car.mesh.position, driver.car.mesh.position.clone()]);
    driver.line = new Line(lineGeometry, lineMaterial);
    scene.add(driver.line);
  });

  drivers.forEach((driver) => {
    scene.add(driver.car.mesh);
  });

  renderScoreboard(drivers);
}

function renderScoreboard(drivers: Driver[]): void {
  const body = document.getElementById("scoreboard-body");
  if (!body) return;

  body.innerHTML = "";

  drivers.forEach((driver) => {
    const row = document.createElement("div");
    row.className = "driver-row";
    row.style.borderLeftColor = driver.car.team.color;

    row.innerHTML = `
      <p class="position">${driver.position}</p>
      <p class="acronym">-${driver.acronym.toLocaleUpperCase()}</p>
      <p class="interval">${driver.interval}</p>
      <div class="tire" style="background-color: ${driver.car.team.color};"></div>
    `;

    body.appendChild(row);
  });
}

window.addEventListener("load", init);
