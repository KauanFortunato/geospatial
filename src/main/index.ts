import "../styles.css"; // Import the CSS file

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
  InstancedMesh,
  Color,
  MeshStandardMaterial,
} from "three";
import { Globe } from "../globe";
import { Geodetic, PointOfView, radians } from "@takram/three-geospatial";
import { Team } from "../models/Team";
import { Driver } from "../models/Driver";
import { Car } from "../models/Car";

let globalScale = 1;
let globe: Globe;
let renderer: WebGLRenderer;
let camera: PerspectiveCamera;
let scene: Scene;
let trackCurve: CatmullRomCurve3 | null = null;
let trackTime = 0;
let currentFollowDriver: Driver | null = null;
const initialPositions: Vector3[] = [];
const drivers: Driver[] = [];
const labelOffset = new Vector3(0, 0, 30);

const params = new URLSearchParams(window.location.search);
const scaleParam = params.get("scale");

const buttonScale = document.getElementById("scale-scene");
if (buttonScale) {
  buttonScale.addEventListener("click", () => {
    const url = new URL(window.location.href);
    if (scaleParam === "small") {
      url.searchParams.delete("scale");
    } else {
      url.searchParams.set("scale", "small");
    }
    window.location.href = url.toString();
  });
}

if (scaleParam === "small") {
  globalScale = 1 / 1300;
  if (buttonScale) {
    buttonScale.textContent = "Aumentar escala da cena";
  }
} else {
  globalScale = 1;
  if (buttonScale) {
    buttonScale.textContent = "Reduzir escala da cena";
  }
}

const longitude = -9.394761567056307; // degrees
const latitude = 38.75025825516866; // degrees
// Calculate the center point on the globe in ECEF coordinates
const centerECEF = new Geodetic(radians(longitude), radians(latitude), 0).toECEF().multiplyScalar(globalScale);
const cameraUp = centerECEF.clone().normalize();

const rawLLA = [
  [-9.392928078775599, 38.749255151676735, 188],
  [-9.392958428064668, 38.749343493902465, 188],
  [-9.392858320990218, 38.74938142433314, 188],
  [-9.392882174967271, 38.749474958015774, 188],
  [-9.392780327138661, 38.74951615683619, 188],
];

const cameraPositions: Vector3[] = [
  new Vector3(4914449.702275728, -812735.0475000107, 3970834.0878650616).multiplyScalar(globalScale),
  new Vector3(4914668.737085846, -813010.9913910049, 3971105.824077781).multiplyScalar(globalScale),
];

for (const [lon, lat, alt] of rawLLA) {
  const geo = new Geodetic(radians(lon), radians(lat), alt);
  initialPositions.push(geo.toECEF());
}

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

    const geo = new Geodetic(radians(lon), radians(lat), alt + 50);
    points.push(geo.toECEF());
  });

  console.log("GPX Points:", points.length, points);
  return points;
}

function init(): void {
  // scene
  scene = new Scene();
  scene.background = new Color(0xffffff);

  // renderer
  renderer = new WebGLRenderer({
    powerPreference: "high-performance",
    antialias: false,
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
  const ambientLight = new AmbientLight(0xffffff, 1);
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
        driver.showLabel();
        driver.showLine();
        btn.textContent = `Seguir ${driver.acronym.toUpperCase()}`;
      } else {
        currentFollowDriver = driver;
        currentFollowDriver.hideLabel();
        currentFollowDriver.hideLine();

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
  camera = new PerspectiveCamera(75, aspect, 0.001, 1300 * globalScale);

  camera.position.copy(cameraPositions[1]); // Use the first camera position from the array
  camera.up.copy(cameraUp);
  camera.lookAt(centerECEF);

  camera.aspect = aspect;
  camera.updateProjectionMatrix();

  clippingGlobe();

  globe = new Globe(scene, camera, renderer, /* disableControls= */ true);
  // globe.tiles.group.scale.multiplyScalar(globalScale);
  scene.add(globe.tiles.group);
  scene.scale.multiplyScalar(globalScale);

  window.addEventListener("resize", onWindowResize); // Handle window resize events

  // Load GPX data
  const gpxUrl = new URL("./estoril-peter-auto.gpx", import.meta.url).href;
  loadGPXasECEF(gpxUrl).then((points) => {
    if (points.length > 1) {
      console.log("GPX Points loaded:", points.length);
      trackCurve = new CatmullRomCurve3(points, false); // false = circuito aberto
    } else {
      console.warn("Nenhum ponto GPX carregado");
    }

    console.log("N points:", points.length);
    const geometry = new SphereGeometry(2);
    const material = new MeshStandardMaterial({ color: 0x00ff62 });
    const sphere = new InstancedMesh(geometry, material, points.length);
    for (let i = 0; i < points.length; i++) {
      sphere.setMatrixAt(i, new Matrix4().setPosition(points[i]));
    }
    // scene.add(sphere);
  });

  // Camera controls
  document.getElementById("camera-position-1")?.addEventListener("click", () => {
    animateCameraTo(cameraPositions[0], cameraUp, centerECEF, 1500);
  });

  document.getElementById("camera-position-2")?.addEventListener("click", () => {
    animateCameraTo(cameraPositions[1], cameraUp, centerECEF, 1500);
  });

  renderer.setAnimationLoop(render);
}

function render(): void {
  globe.update();
  // console.log("Camera position:", camera.position.toArray());

  // Update effect materials with current camera settings
  if (renderer) {
    if (trackCurve && drivers.length > 0) {
      trackTime += 0.0003;
      if (trackTime > 1) trackTime = 0;

      // Add null check for trackCurve
      const spacing = 0.05;

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
      const cameraOffset = tangent
        .clone()
        .multiplyScalar(-30)
        .add(up.clone().multiplyScalar(15))
        .multiplyScalar(globalScale);
      const cameraPos = pos.clone().add(cameraOffset);
      camera.position.copy(cameraPos);
      camera.up.copy(up);
      camera.lookAt(pos.clone().add(tangent.clone().multiplyScalar(10)));
    }

    // composer.render();
    renderer.render(scene, camera);
  }
}

function clippingGlobe() {
  // Clipping planes
  // Create a square around the center point
  // The square is defined by its center, radius, and orientation in ECEF coordinates
  // The square is aligned with the local East-North-Up coordinate system
  const center = new Geodetic(radians(longitude), radians(latitude), 0).toECEF().multiplyScalar(globalScale);
  const radiusMeters = 650; // metade do tamanho do quadrado

  // Create local vectors: East, North, Up
  const up = center.clone().normalize(); // direção radial (Z)
  const east = new Vector3(0, 0, 1).cross(up).normalize(); // Eixo Leste
  const north = up.clone().cross(east).normalize(); // Eixo Norte

  // Calculate square edge points
  const eastOffset = east.clone().multiplyScalar(radiusMeters * globalScale);
  const westOffset = east.clone().multiplyScalar(-radiusMeters * globalScale);
  const northOffset = north.clone().multiplyScalar(radiusMeters * globalScale);
  const southOffset = north.clone().multiplyScalar(-radiusMeters * globalScale);

  // Points of the 4 limits
  const eastPoint = center.clone().add(eastOffset);
  const westPoint = center.clone().add(westOffset);
  const northPoint = center.clone().add(northOffset);
  const southPoint = center.clone().add(southOffset);

  // Plane normals (point inside the square)
  const eastNormal = east.clone().negate();
  const westNormal = east.clone();
  const northNormal = north.clone().negate();
  const southNormal = north.clone();

  // Create planes based on normals and points
  const clippingPlanes = [
    new Plane(eastNormal, -eastNormal.dot(eastPoint)),
    new Plane(westNormal, -westNormal.dot(westPoint)),
    new Plane(northNormal, -northNormal.dot(northPoint)),
    new Plane(southNormal, -southNormal.dot(southPoint)),
  ];

  // Activate clipping planes in the renderer
  renderer.clippingPlanes = clippingPlanes;
  renderer.localClippingEnabled = true;
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
  verstappen.position = 1;
  oscar.position = 2;
  hamilton.position = 3;
  kimi.position = 4;

  // Set initial positions for the drivers
  verstappen.positionOnTrack(initialPositions[1]);
  kimi.positionOnTrack(initialPositions[1]);
  oscar.positionOnTrack(initialPositions[2]);
  hamilton.positionOnTrack(initialPositions[0]);

  // Add drivers to the scene
  drivers.push(hamilton, oscar, verstappen, kimi);

  drivers.forEach((driver) => {
    driver.label = createDriverLabel(driver.acronym.toUpperCase(), driver.car.team.color);
    scene.add(driver.label);

    const lineMaterial = new LineBasicMaterial({ color: 0xffffff });
    const lineGeometry = new BufferGeometry().setFromPoints([
      driver.car.mesh.position,
      driver.car.mesh.position.clone(),
    ]);
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
      <p class="position">${driver.driverNumber}</p>
      <p class="acronym">-${driver.acronym.toLocaleUpperCase()}</p>
      <p class="interval">${driver.interval}</p>
      <div class="tire" style="background-color: ${driver.car.team.color};"></div>
    `;
    console.log("Driver:", driver.name, "Position:", driver.position, "Color:", driver.car.team.color);

    body.appendChild(row);
  });
}

function onWindowResize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

window.addEventListener("load", init);
