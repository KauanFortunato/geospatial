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
  ACESFilmicToneMapping,
  SphereGeometry,
  CatmullRomCurve3,
  CanvasTexture,
  BufferGeometry,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
  SpriteMaterial,
  DoubleSide,
  Sprite,
  MeshStandardMaterial,
} from "three";
import { Globe } from "../globe";
import { AerialPerspectiveEffect, PrecomputedTexturesLoader, SkyMaterial } from "@takram/three-atmosphere";
import { DitheringEffect, LensFlareEffect, createHaldLookupTexture } from "@takram/three-geospatial-effects";
import { getMoonDirectionECI, getSunDirectionECI, getECIToECEFRotationMatrix } from "../utils/celestialDirections";
import { Geodetic, PointOfView, radians } from "@takram/three-geospatial";
import { CloudsEffect } from "@takram/three-clouds";

// Variáveis globais
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
let followCube = false;
let driverBall: Mesh;
let driverLabel: Sprite;
let driverLine: Line;
const labelOffset = new Vector3(0, 0, 35);

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
    const eleElem = pt.querySelector("ele");
    const alt = eleElem ? parseFloat(eleElem.textContent || "0") : 0;
    const geo = new Geodetic(radians(lon), radians(lat), alt + 50);
    points.push(geo.toECEF());
  });
  console.log("GPX Points:", points.length);
  return points;
}

function createDriverLabel(text: string): Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
  ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "white";
  ctx.font = "bold 30px Arial";
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

function createDriver(position: Vector3, name: string) {
  const geometry = new SphereGeometry(4.5, 32, 32);
  const material = new MeshStandardMaterial({ color: 0xff0000 });
  driverBall = new Mesh(geometry, material);
  driverBall.position.copy(position);
  scene.add(driverBall);
  driverBall.castShadow = false;
  driverBall.receiveShadow = false;
  driverLabel = createDriverLabel(name);
  scene.add(driverLabel);
  const lineMaterial = new LineBasicMaterial({ color: 0xffffff, side: DoubleSide });
  const lineGeometry = new BufferGeometry().setFromPoints([position, position.clone()]);
  driverLine = new Line(lineGeometry, lineMaterial);
  scene.add(driverLine);
}

function updateDriver(pos: Vector3) {
  driverBall.position.copy(pos);
  const labelPos = pos.clone().add(labelOffset);
  driverLabel.position.copy(labelPos);
  driverLabel.quaternion.copy(camera.quaternion);
  driverLine.geometry.setFromPoints([pos, labelPos]);
}

function init(): void {
  scene = new Scene();
  renderer = new WebGLRenderer({
    powerPreference: "high-performance",
    antialias: true,
    stencil: true,
    depth: true,
    logarithmicDepthBuffer: true,
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = false;
  renderer.shadowMap.type = PCFSoftShadowMap;
  const container = document.getElementById("container");
  container?.appendChild(renderer.domElement);

  const aspect = window.innerWidth / window.innerHeight;
  camera = new PerspectiveCamera(60, aspect, 50, 5e6);
  const longitude = -9.394761567056307;
  const latitude = 38.75025825516866;
  const altitude = 500;
  const centerECEF = new Geodetic(radians(longitude), radians(latitude), 0).toECEF();
  const cameraECEF = new Geodetic(radians(longitude), radians(latitude), altitude).toECEF();
  camera.position.copy(cameraECEF);
  camera.up.set(0, 0, 1);
  camera.lookAt(centerECEF);
  scene.add(new AmbientLight(0xffffff, 1));

  globe = new Globe(scene, camera, renderer, true);
  scene.add(globe.tiles.group);

  skyMaterial = new SkyMaterial();
  const sky = new Mesh(new PlaneGeometry(2, 2), skyMaterial);
  sky.frustumCulled = false;
  scene.add(sky);

  aerialPerspective = new AerialPerspectiveEffect(camera, {
    correctGeometricError: true,
    correctAltitude: true,
    inscatter: true,
    photometric: true,
    skyIrradiance: true,
    sunIrradiance: true,
    transmittance: true,
    irradianceScale: 2 / Math.PI,
    sky: true,
    sun: true,
    moon: true,
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

  const basePath = import.meta.env.BASE_URL || "/";
  new PrecomputedTexturesLoader()
    .setTypeFromRenderer(renderer)
    .load(basePath + "assets/atmosphere", onPrecomputedTexturesLoad);

  const textureLoader = new TextureLoader();
  textureLoader.load(basePath + "assets/clut/Fuji/Fuji 160C 1 -.png", (texture) => {
    lutTexture = createHaldLookupTexture(texture);
    lutEffect = new LUT3DEffect(lutTexture);
  });

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

  const gpxUrl = new URL("./estoril-peter-auto.gpx", import.meta.url).href;
  loadGPXasECEF(gpxUrl).then((points) => {
    if (points.length > 1) {
      trackCurve = new CatmullRomCurve3(points, false);
      createDriver(points[0], "VER");
    }
  });

  document.getElementById("follow-cube")?.addEventListener("click", () => {
    followCube = !followCube;
    const btn = document.getElementById("follow-cube");
    if (btn) btn.textContent = followCube ? "Parar de Seguir" : "Seguir o Cubo";
  });
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

function render(): void {
  const date = new Date("2024-01-01T22:00:00+09:00");
  getECIToECEFRotationMatrix(date, rotationMatrix);
  getSunDirectionECI(date, sunDirection).applyMatrix4(rotationMatrix);
  getMoonDirectionECI(date, moonDirection).applyMatrix4(rotationMatrix);

  skyMaterial.sunDirection.copy(sunDirection);
  skyMaterial.moonDirection.copy(moonDirection);
  aerialPerspective.sunDirection.copy(sunDirection);
  aerialPerspective.moonDirection.copy(moonDirection);
  globe.update();

  if (composer && trackCurve) {
    trackTime += 0.00001;
    if (trackTime > 1) trackTime = 0;

    const pos = trackCurve.getPointAt(trackTime);
    updateDriver(pos);

    if (followCube) {
      const tangent = trackCurve.getTangentAt(trackTime);
      const up = pos.clone().normalize();
      const cameraOffset = tangent.clone().multiplyScalar(-30).add(up.clone().multiplyScalar(15));
      const cameraPos = pos.clone().add(cameraOffset);
      camera.position.copy(cameraPos);
      camera.up.copy(up);
      camera.lookAt(pos.clone().add(tangent.clone().multiplyScalar(10)));
    }

    composer.passes.forEach((pass) => {
      if (pass.fullscreenMaterial instanceof EffectMaterial) {
        pass.fullscreenMaterial.adoptCameraSettings(camera);
      }
    });

    composer.render();
    renderer.autoClear = false;
    renderer.render(scene, camera);
    renderer.autoClear = true;
  }
}

window.addEventListener("load", init);
