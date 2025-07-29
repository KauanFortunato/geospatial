import {
    Mesh,
    PCFSoftShadowMap,
    PerspectiveCamera,
    Scene,
    Vector3,
    Matrix4,
    WebGLRenderer,
    TextureLoader,
    Plane,
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
    MeshStandardMaterial,
    MeshBasicMaterial,
    ACESFilmicToneMapping,
    Box3,
    Quaternion,
    Raycaster,
    Sphere,
    Spherical,
    Vector2,
    Vector4,
    Clock,
    MathUtils,
    Euler,
    AxesHelper,
    CameraHelper,
    Color,
    ArrowHelper,
    Triangle,
    Matrix3,
    Object3D,
    Shape,
    ExtrudeGeometry,
    MeshNormalMaterial,
    PlaneGeometry,
    BufferAttribute,
    Camera
} from "three";
import { VRButton, XRButton } from "three/examples/jsm/Addons.js";
import { Globe } from "../globe";
import { Geodetic, radians } from "@takram/three-geospatial";
import { Team } from "../models/Team";
import { Driver } from "../models/Driver";
import { Weather } from "../models/Weather";
import { Track } from "../models/Track";
import { Car } from "../models/Car";
import CameraControls from "camera-controls";
import { loadCarModel } from "../utils/modelLoader";
import { RaceViewUI } from "../utils/RaceViewUI";
import { TilesFadePlugin } from "3d-tiles-renderer/plugins";
import { update } from "three/examples/jsm/libs/tween.module.js";
import { Const } from "three/tsl";

const subsetOfTHREE = {
    Vector2: Vector2,
    Vector3: Vector3,
    Vector4: Vector4,
    Quaternion: Quaternion,
    Matrix4: Matrix4,
    Spherical: Spherical,
    Box3: Box3,
    Sphere: Sphere,
    Raycaster: Raycaster,
};

CameraControls.install({ THREE: subsetOfTHREE });

// ————————————————————————————————
// Global Configuration
// ————————————————————————————————

const GLOBE_CONTAINER = new Group();
const INITIAL_POSITIONS: Vector3[] = [];
const DRIVERS: Driver[] = [];
const LABEL_OFFSET = new Vector3(0, 0, 20);

const LOD_CAM_CONFIG = {
    numCols: 1,
    numRows: 1,
    fov: 155,
    height: 350,
    aspectRatio: 1,
}

const CONFIG = {
  scale: 1/1700, // Scale factor for the globe
  globalScale: 1, // Global scale for the globe, used for ECEF coordinates
  coordinate: { longitude: -9.394761567056307, latitude: 38.75025825516866 }, // Longitude and Latitude in degrees of the globe center
  rayOriginAlt: 10000, // Altitude of the ray origin in meters
  flags: {
    enableRecording: false, // Enable recording
    showOrigin:      false, // Show the origin axes helper
    showLodHelpers:  false, // Show LOD cameras helpers
    useClipping:     false, // Clip the globe
  },
  gpxUrl: new URL("/assets/tracks/estoril.gpx", import.meta.url).href,
} as const;

let controls: CameraControls;
let globe: Globe;
let renderer: WebGLRenderer;
let camera: PerspectiveCamera;
let rendererCamera: Camera;
let scene: Scene;
let trackCurve: CatmullRomCurve3 | null = null;
let trackTime = 0;
let currentFollowDriver: Driver | null = null;
let arPlacingGeomap = false;
let reticle: Mesh | null = null;
let hitTestSourceRequested = false;
let hitTestSource: XRHitTestSource | null = null;
let lodCameras: PerspectiveCamera[] = [];

let btnXR: HTMLElement | null = null;
let btnVR: HTMLElement | null = null;
let xrRig: Group;

let recorder;

const clock = new Clock();
let transform;

let detailCamRenderer: WebGLRenderer | null = null;
let currentDetailDriver: Driver | null = null;
let camViewEnabled = false;

const detailsPanel = document.getElementById('driver-details');
if (detailsPanel)
    detailsPanel.style.display = 'none';

let cockpitView = false;

const maxDrivers = 20;
const maxLap = 72;
let currentLap: number = 0;

const centerECEF = new Geodetic(radians(CONFIG.coordinate.longitude), radians(CONFIG.coordinate.latitude), 0).toECEF().multiplyScalar(CONFIG.globalScale);
const cameraUp = centerECEF.clone().normalize();
const cameraRaycaster = new Raycaster();
const mouseNormalBuff = new Vector2();

const carRaycaster = new Raycaster();

const rawLLA = [
    [-9.392928078775599, 38.749255151676735, 188],
    [-9.392958428064668, 38.749343493902465, 188],
    [-9.392858320990218, 38.74938142433314, 188],
    [-9.392882174967271, 38.749474958015774, 188],
    [-9.392780327138661, 38.74951615683619, 188],
];

const cameraPositions: Vector3[] = [
    new Vector3(4914449.702275728, -812735.0475000107, 3970834.0878650616).multiplyScalar(CONFIG.globalScale),
    new Vector3(4914668.737085846, -813010.9913910049, 3971105.824077781).multiplyScalar(CONFIG.globalScale),
];

/* Weather and Track */

const weather = new Weather("15:16:00", 23.7, 5, true);
const track = new Track(36.0, "Dry", 0.0, "Very Low", "Normal");

const raceView = new RaceViewUI();
raceView.updateInterface(weather, track);

for (const [lon, lat, alt] of rawLLA) {
    const geo = new Geodetic(radians(lon), radians(lat), alt);
    INITIAL_POSITIONS.push(geo.toECEF());
}

// Catmullrom
const t: Vector3[] = [];
const n: Vector3[] = [];
const b: Vector3[] = [];

const ls = 4800; // length segments
const lss = ls + 1;

let curvePoints: Vector3[] = [];

declare module 'three' {
  interface Quaternion {
    setFromBasis(e1: Vector3, e2: Vector3, e3: Vector3): this;
  }
}

Quaternion.prototype.setFromBasis = function (e1: Vector3, e2: Vector3, e3: Vector3) {
  const m11 = e1.x, m12 = e1.y, m13 = e1.z,
        m21 = e2.x, m22 = e2.y, m23 = e2.z,
        m31 = e3.x, m32 = e3.y, m33 = e3.z,
        trace = m11 + m22 + m33;

  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    
    this._w = 0.25 / s;
    this._x = -(m32 - m23) * s;
    this._y = -(m13 - m31) * s;
    this._z = -(m21 - m12) * s;
  } else if (m11 > m22 && m11 > m33) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33);
    
    this._w = (m32 - m23) / s;
    this._x = -0.25 * s;
    this._y = -(m12 + m21) / s;
    this._z = -(m13 + m31) / s;
  } else if (m22 > m33) {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33);
    
    this._w = (m13 - m31) / s;
    this._x = -(m12 + m21) / s;
    this._y = -0.25 * s;
    this._z = -(m23 + m32) / s;
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22);
    
    this._w = (m21 - m12) / s;
    this._x = -(m13 + m31) / s;
    this._y = -(m23 + m32) / s;
    this._z = -0.25 * s;
  }

  this._onChangeCallback();
  return this;
};

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

    return points;
}

function isMobileDevice() {
  return /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

async function init(): Promise<void> {
    await loadLoadingScreen();

    if (isMobileDevice()) {
        LOD_CAM_CONFIG.fov = 55;
        LOD_CAM_CONFIG.height = 1500;
    }
    console.log("Mobile: ", isMobileDevice());

    setupGraphicsEngine();
    setupLight();
    setupMainCamera();
    setupLODCameras();
    setupCameraControls();
    updateLap(currentLap);

    setupXR();  
    setupVR();

    if (CONFIG.flags.enableRecording) {
        setupRecordingFeatures();
    }

    globe = new Globe(scene, lodCameras, renderer, true);
    GLOBE_CONTAINER.add(globe.tiles.group);
    scene.add(GLOBE_CONTAINER);

    const enuMatrix = new Matrix4();
    globe.tiles.ellipsoid.getEastNorthUpFrame(
        MathUtils.degToRad(CONFIG.coordinate.latitude),
        MathUtils.degToRad(CONFIG.coordinate.longitude),
        enuMatrix
    );
    enuMatrix.multiply(new Matrix4().makeRotationFromEuler(new Euler(Math.PI / 2, Math.PI / 2, 0)));
    transform = enuMatrix.clone().invert();
    globe.tiles.group.applyMatrix4(transform);
    GLOBE_CONTAINER.scale.setScalar(CONFIG.scale);
    GLOBE_CONTAINER.updateMatrixWorld(true);

    const unit = 0.9;
    const clippingPlanes = [
        new Plane(new Vector3(unit, 0, 0), unit / 2),
        new Plane(new Vector3(-unit, 0, 0), unit / 2),
        new Plane(new Vector3(0, 0, unit), unit / 2),
        new Plane(new Vector3(0, 0, -unit), unit / 2),
    ];
    if (CONFIG.flags.useClipping) {
        renderer.clippingPlanes = clippingPlanes;
    }

    const globeReady = globe.tilesLoaded;

    const carsReady = (async () => {
        await loadFormula1Font();
        await createDriversAndTeams(maxDrivers);
    })();

    const gpxReady = (async () => {
        const points = await loadGPXasECEF(CONFIG.gpxUrl);
        if (points.length > 1) {
            // cria curva CatmullRom
            trackCurve = new CatmullRomCurve3(points, false);
            for (let i = 0; i <= ls; i++) {
                curvePoints.push(trackCurve.getPoint(i / ls));
            }
            // precompute t,n,b
            const normal = new Vector3();
            const binormal = new Vector3(0, 1, 0);
            for (let j = 0; j < lss; j++) {
                const tangent = trackCurve.getTangent(j / ls).normalize();
                t.push(tangent.clone());
                normal.crossVectors(tangent, binormal);
                normal.y = 0;
                n.push(normal.clone().normalize());
                binormal.crossVectors(normal, tangent).normalize();
                b.push(binormal.clone());
            }
            // gera malha da pista
            const roadWidth = 8;
            const halfW = roadWidth / 2;
            const dw = [-halfW, -halfW * 0.6, -0.1, 0.1, halfW * 0.6, halfW];
            const ws = dw.length - 1;
            const vertices = new Float32Array(lss * (ws + 1) * 3);
            const indices  = new Uint32Array(ls * ws * 6);
            let vIdx = 0, iIdx = 0;
            for (let j = 0; j < lss; j++) {
                for (let i = 0; i <= ws; i++) {
                    const base = curvePoints[j];
                    const x = base.x + dw[i] * n[j].x;
                    const y = base.y;
                    const z = base.z + dw[i] * n[j].z;
                    vertices[vIdx++] = x;
                    vertices[vIdx++] = y;
                    vertices[vIdx++] = z;
                }
            }
            for (let j = 0; j < ls; j++) {
                for (let i = 0; i < ws; i++) {
                    const a = j * (ws + 1) + i;
                    const b = (j + 1) * (ws + 1) + i;
                    const c = b + 1;
                    const d = a + 1;
                    indices[iIdx++] = a; indices[iIdx++] = b; indices[iIdx++] = c;
                    indices[iIdx++] = a; indices[iIdx++] = c; indices[iIdx++] = d;
                }
            }
            const geom = new BufferGeometry();
            geom.setAttribute("position", new BufferAttribute(vertices, 3));
            geom.setIndex(new BufferAttribute(indices, 1));
            geom.computeVertexNormals();
            const roadMesh = new Mesh(geom, new MeshStandardMaterial({ color: 0xfcba03 }));
            // globe.tiles.group.add(roadMesh);
        } else {
            console.warn("Nenhum ponto GPX carregado");
        }
    })();

    await Promise.all([globeReady, carsReady, gpxReady]);

    // Hidde loading screen
    const loadingContainer = document.getElementById("loading-screen");
    if (loadingContainer) {
        loadingContainer.classList.add("hidden");
    }

    window.addEventListener("resize", onWindowResize);
    document.getElementById("camera-position-1")?.addEventListener("click", () => {
        if (CONFIG.flags.enableRecording) recorder.start();
    });
    
    document.getElementById("camera-position-2")?.addEventListener("click", () => {
        if (CONFIG.flags.enableRecording) recorder.stop();
    });

    document.getElementById("ic-sync")?.addEventListener("click", () => {
        raceView.updateInterface(weather, track);
    });

    if (CONFIG.flags.showOrigin) {
        scene.add(new AxesHelper(10));
    }
    setInterval(updateScoreboardIntervals, 1000);
}

function setupGraphicsEngine() {
    renderer = new WebGLRenderer({
        powerPreference: "high-performance",
        antialias: true,
        stencil: true,
        depth: true,
        alpha: !CONFIG.flags.enableRecording,
        logarithmicDepthBuffer: true,
        preserveDrawingBuffer: CONFIG.flags.enableRecording
    });
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    renderer.localClippingEnabled = true;
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);

    const webContainer = document.getElementById("container");
    if (webContainer) {
        webContainer.appendChild(renderer.domElement);
    }
    
    scene = new Scene();
    if (CONFIG.flags.enableRecording)
        scene.background = new Color().setHex(0x00FF00);

    renderer.setAnimationLoop(onRender);
}

function setupXR() {
    renderer.xr.enabled = true;
    renderer.xr.addEventListener('sessionend', onSessionEnd);

    btnXR = XRButton.createButton(renderer, {
        requiredFeatures: ['hit-test'],
        optionalFeatures: []
    });

    btnXR.addEventListener('click', onXRSession);
    document.body.appendChild(btnXR);

    const tLoader = new TextureLoader();
    reticle = new Mesh(
        new BoxGeometry(9.15 / 10, 6.10 / 10, 0.01).rotateX(-Math.PI / 2),
        new MeshBasicMaterial({ map: tLoader.load('assets/reticle.png'), transparent: true })
    );
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    renderer.xr.addEventListener('sessionstart', async () => {
        const session = renderer.xr.getSession();
        if (session && session.enabledFeatures) {
            console.log("Granted WebXR Features:", Array.from(session.enabledFeatures));

            if (session.enabledFeatures.includes('hit-test')) {
                if (hitTestSourceRequested === false) {
                    session.requestReferenceSpace('viewer').then(function (referenceSpace) {
                        // @ts-ignore
                        session.requestHitTestSource({ space: referenceSpace }).then(function (source) {
                            hitTestSource = source;
                        });
                    });

                    session.addEventListener('end', function () {
                        hitTestSource = null;
                        hitTestSourceRequested = false;
                    });
                    hitTestSourceRequested = true;
                }
            }
            session.addEventListener('select', onSelect);
        }
    });
}

function setupVR() {
  btnVR = VRButton.createButton(renderer);
  btnVR.classList.add("vr-button");
  btnVR.style.position = "absolute";
  btnVR.style.bottom = "10px";
  btnVR.style.right  = "10px";
  btnVR.addEventListener("click", onVRSession);

  renderer.xr.addEventListener("sessionstart", () => {
    cockpitView = true;
  });
  renderer.xr.addEventListener("sessionend", () => {
    cockpitView = false;
    updateEntryButtons(); 
  });
}

function updateEntryButtons() {
  if (btnXR && btnXR.parentElement) btnXR.parentElement.removeChild(btnXR);
  if (btnVR && btnVR.parentElement) btnVR.parentElement.removeChild(btnVR);
  if (renderer.xr.isPresenting) return;
  if (currentFollowDriver) {
    if (btnVR) document.body.appendChild(btnVR);
  } else {
    if (btnXR) document.body.appendChild(btnXR);
  }
}

function setupLight() {
    const ambientLight = new AmbientLight(0xffffff, 11);
    scene.add(ambientLight);
}

function setupMainCamera() {
    camera = new PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.001 * CONFIG.scale, 13000);
    camera.position.copy(new Vector3(-0.1, 0.3, 0.1));
    camera.lookAt(new Vector3(0, 0, 0));
    camera.updateProjectionMatrix();
    camera.name = 'Main Camera';
    rendererCamera = camera;
    
    xrRig = new Group();
    xrRig.name = "xrRig";
    scene.add(xrRig);
    xrRig.add(camera);
}

function setupLODCameras(heightRatio = 2) {
    const halfHeight = (LOD_CAM_CONFIG.height / heightRatio) * Math.tan(MathUtils.degToRad(LOD_CAM_CONFIG.fov) / 2);  // tan45° = 1 → = 350
    const halfWidth = halfHeight * LOD_CAM_CONFIG.aspectRatio;           // rectangular footprint

    for (let i = 0; i < LOD_CAM_CONFIG.numCols; i++) {
        for (let j = 0; j < LOD_CAM_CONFIG.numRows; j++) {
            const x = (i - (LOD_CAM_CONFIG.numCols - 1) / 2) * (2 * halfWidth);
            const z = ((LOD_CAM_CONFIG.numRows - 1) / 2 - j) * (2 * halfHeight);
            const cam = new PerspectiveCamera(LOD_CAM_CONFIG.fov, LOD_CAM_CONFIG.aspectRatio, 1, LOD_CAM_CONFIG.height);
            cam.position.set(x, LOD_CAM_CONFIG.height, z);
            cam.lookAt(new Vector3(x, 0, z));
            cam.updateMatrixWorld();
            lodCameras.push(cam);
            GLOBE_CONTAINER.add(cam);

            if (CONFIG.flags.showLodHelpers) {
                let lodCamHelper = new CameraHelper(cam);
                scene.add(lodCamHelper);
            }
        }
    }
}

function setupCameraControls() {
    controls = new CameraControls(camera, renderer.domElement);
    controls.mouseButtons.right = CameraControls.ACTION.OFFSET;
    controls.maxPolarAngle = Math.PI / 2;
    renderer.domElement.addEventListener('mousedown', (event) => setOrbitPoint(event.clientX, event.clientY));
    renderer.domElement.addEventListener('touchstart', (event) => setOrbitPoint(event.changedTouches[0].clientX, event.changedTouches[0].clientY));
}

function setupRecordingFeatures() {
    const stream = renderer.domElement.captureStream(30);

    // Using a WebM codec that supports alpha (VP8 or VP9)
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm;codecs=vp8';
    const chunks: BlobPart[] = [];
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5_000_000 });

    recorder.ondataavailable = (e) => {
        if (e.data && e.data.size) chunks.push(e.data);
    };

    recorder.onstop = () => {
        // Assemble the final WebM blob
        const blob = new Blob(chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);

        // Automatically download the content
        const a = document.createElement('a');
        a.href = url;
        a.download = 'transparent_capture.webm';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };
}

async function loadFormula1Font(): Promise<void> {
  const font = new FontFace(
    "Formula1",
    `url("/assets/fonts/Formula1-Regular-1.ttf") format("truetype")`
  );
  // espera o download e parse
  await font.load();
  // registra na coleção de fonts do documento
  (document as any).fonts.add(font);
}

function createDriverLabel(driver: Driver): Sprite {
  // Parâmetros de estilo
  const paddingY = 4;
  const paddingX = 8;
  const gapStripe = 5;
  const stripeWidth = 5;
  const stripePaddingY = 4;
  const stripeRadius = 4;
  const bgRadius = 6;
  const fontSize = 28;
  const fontFamily = `"Formula1", Arial, sans-serif`; // <— sua fonte custom aqui
  const name = driver.name.toUpperCase().split(" ")[1];
  const number = driver.position.toString();

  // Cria canvas
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;

  // Define fonte antes de medir
  ctx.font = `bold ${fontSize}px ${fontFamily}`;
  ctx.textBaseline = "middle";

  // Mede texto
  const numW = ctx.measureText(number).width;
  const nameW = ctx.measureText(name).width;

  const logicalWidth  = paddingX + numW + gapStripe + stripeWidth + gapStripe + nameW + paddingX;
  const logicalHeight = fontSize + paddingY * 2;

  // Ajusta canvas
  const width = paddingX + numW + gapStripe + stripeWidth + gapStripe + nameW + paddingX;
  const height = fontSize + paddingY * 2;
  canvas.width = width;
  canvas.height = height;

  // Redefine contexto (depois de resize)
  ctx.font = `bold ${fontSize}px ${fontFamily}`;
  ctx.textBaseline = "middle";

  // Desenha fundo arredondado
  ctx.fillStyle = "rgba(0, 0, 0, 0.86)";
  const r = bgRadius;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(width - r, 0);
  ctx.quadraticCurveTo(width, 0, width, r);
  ctx.lineTo(width, height - r);
  ctx.quadraticCurveTo(width, height, width - r, height);
  ctx.lineTo(r, height);
  ctx.quadraticCurveTo(0, height, 0, height - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.fill();

  // Posição vertical dos textos
  const textY = height / 2 + paddingY / 2;

  // Número
  ctx.fillStyle = "#fff";
  ctx.textAlign = "left";
  ctx.fillText(number, paddingX, textY);

  // Faixa colorida arredondada
  const stripeX = paddingX + numW + gapStripe;
  const stripeY = stripePaddingY;
  const stripeH = height - stripePaddingY * 2;
  const sr = stripeRadius;
  ctx.fillStyle = driver.car.team.color;
  ctx.beginPath();
  ctx.moveTo(stripeX + sr, stripeY);
  ctx.lineTo(stripeX + stripeWidth - sr, stripeY);
  ctx.quadraticCurveTo(stripeX + stripeWidth, stripeY, stripeX + stripeWidth, stripeY + sr);
  ctx.lineTo(stripeX + stripeWidth, stripeY + stripeH - sr);
  ctx.quadraticCurveTo(stripeX + stripeWidth, stripeY + stripeH, stripeX + stripeWidth - sr, stripeY + stripeH);
  ctx.lineTo(stripeX + sr, stripeY + stripeH);
  ctx.quadraticCurveTo(stripeX, stripeY + stripeH, stripeX, stripeY + stripeH - sr);
  ctx.lineTo(stripeX, stripeY + sr);
  ctx.quadraticCurveTo(stripeX, stripeY, stripeX + sr, stripeY);
  ctx.fill();

  // Nome
  ctx.fillStyle = "#fff";
  ctx.textAlign = "left";
  const nameX = stripeX + stripeWidth + gapStripe;
  ctx.fillText(name, nameX, textY);

  // Cria Sprite Three.js
  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new SpriteMaterial({
    map: texture,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    toneMapped: false,
  });
  const sprite = new Sprite(material);
  const aspect = width / height;
  sprite.scale.set(10 * aspect, 10, 1);
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

async function createDriversAndTeams(maxDrivers = 20) {
    // === Criar equipas ===
    let redBull = new Team("Red Bull Racing", "#1E41FF", "/assets/teams/logos/lg-red-bull.webp");
    let mercedes = new Team("Mercedes-AMG Petronas", "#00E1BE", "/assets/teams/logos/lg-mercedes.webp");
    let ferrari = new Team("Scuderia Ferrari", "#DC0000", "/assets/teams/logos/lg-ferrari.png");
    let mclaren = new Team("McLaren F1 Team", "#FF8000", "/assets/teams/logos/lg-mclaren.png");
    let astonMartin = new Team("Aston Martin Aramco", "#229971", "/assets/teams/logos/lg-astonmartin.png");
    let alpine = new Team("Alpine F1 Team", "#0090FF", "/assets/teams/logos/lg-alpine.png");
    let haas = new Team("Haas F1 Team", "#e24a4aff", "/assets/teams/logos/lg-haas.png");
    let kickSauber = new Team("Kick Sauber", "#00FF87", "/assets/teams/logos/lg-kicksauber.png");
    let williams = new Team("Williams Racing", "#005AFF", "/assets/teams/logos/lg-williams.png");
    let racingBulls = new Team("Visa Cash App RB", "#24135F", "/assets/teams/logos/lg-racingbulls.png");

    // === Carregar modelos ===
    const [
        alpine_car,
        astonmartin_car,
        ferrari_car,
        haas_car,
        kicksauber_car,
        mclaren_car,
        mercedes_car,
        redbull_car,
        redbullvisa_car,
        williams_car
    ] = await Promise.all([
        loadCarModel("/assets/cars/alpine_car.glb", alpine, renderer),
        loadCarModel("/assets/cars/astonmartin_car.glb", astonMartin, renderer),
        loadCarModel("/assets/cars/ferrari_car.glb", ferrari, renderer),
        loadCarModel("/assets/cars/haas_car.glb", haas, renderer),
        loadCarModel("/assets/cars/kicksauber_car.glb", kickSauber, renderer),
        loadCarModel("/assets/cars/mclaren_car.glb", mclaren, renderer),
        loadCarModel("/assets/cars/mercedes_car.glb", mercedes, renderer),
        loadCarModel("/assets/cars/redbull_car.glb", redBull, renderer),
        loadCarModel("/assets/cars/redbullvisa_car.glb", racingBulls, renderer),
        loadCarModel("/assets/cars/williams_car.glb", williams, renderer)
    ]);

    // === Criar todos os drivers ===
    const allDrivers = [
        // RED BULL
        new Driver("Max Verstappen", "/assets/drivers/verstappen.png", "ver", 1, "Netherlands", 1, 0, new Car(1, "RB20", redbull_car.clone(), redBull, "M"), new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.001 * CONFIG.scale, 13000), 40),
        new Driver("Yuki Tsunoda", "/assets/drivers/tsunoda.png", "tsu", 22, "Japan", 16, 0, new Car(22, "RB20", redbull_car.clone(), redBull, "M", true), new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.001 * CONFIG.scale, 13000), 80),

        // MCLAREN
        new Driver("Oscar Piastri", "/assets/drivers/piastri.png", "pia", 81, "Australia", 2, 0, new Car(81, "MCL35M", mclaren_car.clone(), mclaren, "H"), new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.001 * CONFIG.scale, 13000), 50),
        new Driver("Lando Norris", "/assets/drivers/norris.png", "nor", 4, "United Kingdom", 7, 0, new Car(4, "MCL35M", mclaren_car.clone(), mclaren, "S", true), new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.001 * CONFIG.scale, 13000), 45),

        // MERCEDES
        new Driver("Kimi Antonelli", "/assets/drivers/antonelli.png", "ant", 7, "Italy", 3, 0, new Car(7, "W15", mercedes_car.clone(), mercedes, "S"), new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.001 * CONFIG.scale, 13000), 60),
        new Driver("George Russell", "/assets/drivers/russell.png", "rus", 63, "United Kingdom", 6, 0, new Car(63, "W15", mercedes_car.clone(), mercedes, "M"), new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.001 * CONFIG.scale, 13000), 45),

        // FERRARI
        new Driver("Lewis Hamilton", "/assets/drivers/hamilton.png", "ham", 44, "United Kingdom", 4, 7, new Car(44, "SF23", ferrari_car.clone(), ferrari, "M", true), new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.001 * CONFIG.scale, 13000), 50),
        new Driver("Charles Leclerc", "/assets/drivers/leclerc.png", "lec", 16, "Monaco", 5, 0, new Car(16, "SF23", ferrari_car.clone(), ferrari, "S"), new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.001 * CONFIG.scale, 13000), 45),

        // ASTON MARTIN
        new Driver("Fernando Alonso", "/assets/drivers/alonso.png", "alo", 14, "Spain", 9, 2, new Car(14, "AMR24", astonmartin_car.clone(), astonMartin, "M"), new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.001 * CONFIG.scale, 13000), 60),
        new Driver("Lance Stroll", "/assets/drivers/stroll.png", "str", 18, "Canada", 10, 0, new Car(18, "AMR24", astonmartin_car.clone(), astonMartin, "S", true), new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.001 * CONFIG.scale, 13000), 55),

        // WILLIAMS
        new Driver("Alexander Albon", "/assets/drivers/albon.png", "alb", 23, "Thailand", 11, 0, new Car(23, "FW46", williams_car.clone(), williams, "H"), new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.001 * CONFIG.scale, 13000), 50),
        new Driver("Carlos Sainz", "/assets/drivers/sainz.png", "sai", 55, "Spain", 8, 0, new Car(55, "SF23", williams_car.clone(), williams, "M"), new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.001 * CONFIG.scale, 13000), 70),

       // ALPINE
        new Driver("Pierre Gasly", "/assets/drivers/gasly.png", "gas", 10, "France", 12, 0, new Car(10, "A524", alpine_car.clone(), alpine, "M", true), new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.001 * CONFIG.scale, 13000), 60),
        new Driver("Franco Colapinto", "/assets/drivers/colapinto.png", "col", 29, "Argentina", 13, 0, new Car(29, "A524", alpine_car.clone(), alpine, "S"), new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.001 * CONFIG.scale, 13000), 55),

        // HAAS
        new Driver("Esteban Ocon", "/assets/drivers/ocon.png", "oco", 31, "France", 14, 0, new Car(31, "VF-24", haas_car.clone(), haas, "H"), new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.001 * CONFIG.scale, 13000), 110),
        new Driver("Oliver Bearman", "/assets/drivers/bearman.png", "bea", 38, "United Kingdom", 15, 0, new Car(38, "VF-24", haas_car.clone(), haas, "S"), new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.001 * CONFIG.scale, 13000), 70), 
        
        // RACING BULLS
        new Driver("Liam Lawson", "/assets/drivers/lawson.png", "law", 40, "New Zealand", 17, 0, new Car(40, "VCARB01", redbullvisa_car.clone(), racingBulls, "S", true), new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.001 * CONFIG.scale, 13000), 60),
        new Driver("Isack Hadjar", "/assets/drivers/hadjar.png", "had", 20, "France", 20, 0, new Car(20, "A524", redbullvisa_car.clone(), racingBulls, "S", true), new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.001 * CONFIG.scale, 13000), 45),

        // KICK SAUBER
        new Driver("Nico Hulkenberg", "/assets/drivers/hulkenberg.png", "hul", 27, "Germany", 18, 0, new Car(27, "C44", kicksauber_car.clone(), kickSauber, "H"), new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.001 * CONFIG.scale, 13000), 60),
        new Driver("Gabriel Bortoleto", "/assets/drivers/bortoleto.png", "bor", 5, "Brazil", 19, 0, new Car(5, "C44", kicksauber_car.clone(), kickSauber, "M", true), new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.001 * CONFIG.scale, 13000), 50),
    ]

    // Limits the number of pilots
    const selectedDrivers = allDrivers.slice(0, Math.min(maxDrivers, 20));
    DRIVERS.push(...selectedDrivers);

    // Add drivers to the scene
    selectedDrivers.forEach((driver) => {
        driver.label = createDriverLabel(driver);
        globe.tiles.group.add(driver.label);

        const lineMaterial = new LineBasicMaterial({ color: 0xffffff });
        const lineGeometry = new BufferGeometry().setFromPoints([driver.car.car.position, driver.car.car.position.clone()]);
        driver.line = new Line(lineGeometry, lineMaterial);
        globe.tiles.group.add(driver.line);

        globe.tiles.group.add(driver.car.car);

        driver.startIntervalFluctuation(2.0, 0.2, 1500);
    });

    renderScoreboard(DRIVERS);
}

function getRaycastHit(x: number, z: number) {
    const rayOrigin = new Vector3(x, CONFIG.rayOriginAlt, z);
    const rayDirection = new Vector3(0, -1, 0);
    carRaycaster.set(rayOrigin, rayDirection);
    return carRaycaster.intersectObject(globe.tiles.group, false)[0];
}

function getSmoothHitNormal(hit) {
    const { face, object, point } = hit;
    const geom = object.geometry;
    const posAttr = geom.attributes.position;
    let normAttr = geom.attributes.normal;

    // ensure normals exist
    if (!normAttr) {
        geom.computeVertexNormals();
        normAttr = geom.attributes.normal;
    }

    // 1) pull the triangle’s three vertex positions
    const vA = new Vector3().fromBufferAttribute(posAttr, face.a);
    const vB = new Vector3().fromBufferAttribute(posAttr, face.b);
    const vC = new Vector3().fromBufferAttribute(posAttr, face.c);

    // 2) compute barycentric coords of the hit point
    const bary = new Vector3();
    Triangle.getBarycoord(point, vA, vB, vC, bary);

    // 3) pull the three vertex normals
    const nA = new Vector3().fromBufferAttribute(normAttr, face.a);
    const nB = new Vector3().fromBufferAttribute(normAttr, face.b);
    const nC = new Vector3().fromBufferAttribute(normAttr, face.c);

    // 4) interpolate them
    const interpolated = new Vector3()
        .set(0, 0, 0)
        .addScaledVector(nA, bary.x)
        .addScaledVector(nB, bary.y)
        .addScaledVector(nC, bary.z)
        .normalize();

    // 5) transform to world space
    object.updateMatrixWorld(true);
    const normalMatrix = new Matrix3().getNormalMatrix(object.matrixWorld);
    interpolated.applyMatrix3(normalMatrix).normalize();

    return interpolated;
}

function getHitAltitude(hit, compensation = 0){
    return (CONFIG.rayOriginAlt - hit.distance) + compensation;
}

function setObjectOnRoad(object: Object3D){
    // TODO
    // get object pos x, y
    // call getRaycastHit
    // get hit position, compensate car altitude approx: 0.5 / scale
    // get hit normal
    // apply normal and position
    //       object.quaternion.copy(q);
    //       object.position.copy(hitPointCompensated);
}

function setOrbitPoint(mouseX, mouseY) {
	const elRect = renderer.domElement.getBoundingClientRect();
	const canvasX = mouseX - elRect.left;
    const canvasY = mouseY - elRect.top;

	mouseNormalBuff.set(
		(canvasX / elRect.width) * 2.0 - 1.0,
		((elRect.height - canvasY) / elRect.height) * 2.0 - 1.0
	);

    camera.updateMatrixWorld();
	cameraRaycaster.setFromCamera(mouseNormalBuff, camera);
	const intersections = cameraRaycaster.intersectObject(globe.tiles.group, false);

	if (intersections.length !== 0) {
		controls.setOrbitPoint(intersections[0].point.x, intersections[0].point.y, intersections[0].point.z);
	}
}

function renderScoreboard(drivers: Driver[]): void {
    const body = document.getElementById("scoreboard-body");
    if (!body) return;

    const maxLapElement = document.getElementById("max-lap");
    if (maxLapElement) {
        maxLapElement.textContent = `${maxLap}`;
    }

    body.innerHTML = "";

    drivers.sort((a, b) => a.position - b.position);

    drivers.forEach((driver, i) => {
    const row = document.createElement("div");
    row.setAttribute("data-driver-number", driver.driverNumber.toString());
    row.className = "driver-row";

    const tireColor = driver.car.getTireColor?.() || "gray";

    row.innerHTML = `
        <div class="position-container p-2">
            <p class="text-center position">${driver.position}</p>
        </div>
        <img class="team-logo mx-2" src="${driver.car.team.logo}" alt="Team Logo">
        <p class="acronym">${driver.acronym.toUpperCase()}</p>
        <p class="interval">${driver.interval}</p>
        <div class="tire mx-2" style="color: ${tireColor};">${driver.car.tire}</div>

        <div class="fastest-lap" style="display: none;">
            <img src="/assets/fastest-lap.png" alt="Fastest Lap">
        </div>
    `;

    body.appendChild(row);

    setTimeout(() => {
        row.classList.add("show");
    }, i * 100);

    // Event listener para seguir/parar de seguir

    row.addEventListener('click', () => {
    if (currentDetailDriver === driver) {
        detailsPanel!.style.display = 'none';
        currentDetailDriver = null;
        camViewEnabled = false;
        if (detailCamRenderer) detailCamRenderer.domElement.style.display = 'none';
        const labelCam = detailsPanel!.querySelector('.label-cam') as HTMLElement;
        if (labelCam) labelCam.style.display = 'none';
    } else {
        showDriverDetails(driver);
    }
    });

    });
}

function updateScoreboard(fastestDriver: Driver): void {
  document.querySelectorAll(".driver-row .fastest-lap").forEach(el => {
    (el as HTMLElement).style.display = "none";
  });

  const row = document.querySelector(`.driver-row[data-driver-number="${fastestDriver.driverNumber.toString()}"]`);
  const fastestElem = row?.querySelector(".fastest-lap") as HTMLElement;
  if (fastestElem) {
    fastestElem.style.display = "block";
  }
}

function updateScoreboardIntervals(): void {
  document.querySelectorAll(".driver-row").forEach((row) => {
    const driverNumber = row.getAttribute("data-driver-number");
    const driver = DRIVERS.find((d) => d.driverNumber.toString() === driverNumber);
    if (driver) {
      const intervalElem = row.querySelector(".interval");
      if (intervalElem) {
        intervalElem.textContent = driver.interval ?? "";
      }
    }
  });
}

function updateLap(lap: Number) {
    const lapElement = document.getElementById("current-lap");
    if (lapElement) {
        lapElement.textContent = `${lap}`;
    }
}

function onRender(ts, frame): void {
    const delta = clock.getDelta();

    if (frame) {
        const referenceSpace = renderer.xr.getReferenceSpace();
        const session = renderer.xr.getSession();

        if (reticle && session?.enabledFeatures?.includes('hit-test')) {
            if (hitTestSource) {
                const hitTestResults = frame.getHitTestResults(hitTestSource);
                if (hitTestResults.length && arPlacingGeomap) {
                    const hit = hitTestResults[0];
                    reticle.visible = true;
                    // @ts-ignore
                    reticle.matrix.fromArray(hit.getPose(referenceSpace).transform.matrix);
                } else {
                    reticle.visible = false;
                }
            }
        }
    } else {
        if (controls)
            controls.update(delta);
        globe.update();
    }

    if (renderer) {
        if (trackCurve && DRIVERS.length > 0) {
            const speedFactor = 0.02; 
            trackTime += delta * speedFactor;

            if (trackTime > 1) trackTime = 0;

            // Add null check for trackCurve

            let normal;
            DRIVERS.forEach((driver, index) => {
                if (!trackCurve || curvePoints.length === 0 || t.length === 0 || n.length === 0 || b.length === 0) {
                    return;
                }

                const spacing = 40;
                const idx = Math.max(0, Math.min(ls, Math.floor((trackTime * ls - index * spacing + ls) % ls)));
                if (idx === 0 && driver.position === DRIVERS.length) {
                    const randomIndex = Math.floor(Math.random() * DRIVERS.length);
                    const fastest = DRIVERS[randomIndex];

                    updateScoreboard(fastest);
                }

                if (idx === 0 && driver.position === 1) {
                    currentLap++;
                    if(currentLap > maxLap) currentLap = 0;
                    updateLap(currentLap);
                }

                const raw = trackTime - (index * spacing) / ls + 1;         // shift + garantia de positivo
                const prog = raw % 1;                                       // progresso de 0 a 1
                const prevProg = driver.lastIdx ?? prog;
                driver.lastIdx = prog;

                if (prevProg > prog && currentLap > 0) {
                    driver.lap++;
                    console.log(`Driver ${driver.name} completed lap ${driver.lap}`);
                }

                const pos = curvePoints[idx].clone();
                if (pos) {
                    normal = new Vector3();
                    globe.tiles.group.localToWorld(pos); // Convert to world coordinates
                    const hit = getRaycastHit(pos.x, pos.z);
                    if (hit) {
                        // normal = getSmoothHitNormal(hit);
                        pos.y = getHitAltitude(hit, 0); // Set new height in world coordinates
                    }
                    globe.tiles.group.worldToLocal(pos); // Convert back to geo coordinates
                    pos.add(new Vector3(0, -0.00085, 0)); // Offset to compensate car altitude
                }

                const tangent = t[idx];
                const bin = b[idx];
                const norm = n[idx];
                
                if (norm.x < 0 && norm.z < 0) {
                    norm.negate();
                    bin .negate();
                }

                const ud = driver.car.car.userData;
                if (!ud.initialized) {
                    ud.filteredN = norm.clone();
                    ud.filteredB = bin.clone();
                    ud.smoothFactorMin = 0.02;
                    ud.smoothFactorMax = 0.2;
                    ud.initialized = true;
                }

                const prevN = ud.filteredN;
                const prevB = ud.filteredB;
                const dotN  = Math.max(-1, Math.min(1, prevN.dot(norm)));
                const angleN = Math.acos(dotN);
                const a = angleN / Math.PI;  // 0 em reta, 1 em curva de 180°
                const dynamicAlpha = ud.smoothFactorMin + (ud.smoothFactorMax - ud.smoothFactorMin) * a;

                ud.filteredN.lerp(norm, dynamicAlpha);
                ud.filteredB.lerp(bin,   dynamicAlpha);

                ud.filteredN.normalize();
                // garante que binormal seja ortogonal a N e T
                ud.filteredB.crossVectors(ud.filteredN, tangent).normalize();

                driver.positionOnTrack(tangent, ud.filteredB, ud.filteredN, pos);
                driver.updateLabel(camera, LABEL_OFFSET);
            });
        }

        if (currentFollowDriver) {
            const car = currentFollowDriver.car.car;

            const carPos = car.getWorldPosition(new Vector3());
            const carQuat = car.getWorldQuaternion(new Quaternion());

            const forward = new Vector3(1, 0, 0).applyQuaternion(carQuat); // look ahead
            const worldUp = new Vector3(0, 1, 0); // upWorld

            const offsetBehind = forward.clone().multiplyScalar(0.02 * CONFIG.scale); // Z Camera Depth
            const offsetAbove = worldUp.clone().multiplyScalar(0.65 * CONFIG.scale);  // Y da camera

            const cameraPos = carPos.clone().add(offsetBehind).add(offsetAbove);
            const lookAt = carPos.clone().add(forward.clone().multiplyScalar(0.1 * CONFIG.scale));

            // if(cockpitView) {
            //     currentFollowDriver.camera.position.set(-3, 0, 2);
            // } else {
            //     currentFollowDriver.camera.position.set(-20, 0, 90);
            // }

            // console.log("Camera Position: ", currentFollowDriver.camera.position);

            rendererCamera = currentFollowDriver.camera;
        } else {
            rendererCamera = camera;
        }

        if (detailCamRenderer && currentDetailDriver && camViewEnabled) {
            detailCamRenderer.render(scene, currentDetailDriver.camera);
        }

        if (cockpitView && renderer.xr.isPresenting && currentFollowDriver) {
            xrRig.updateMatrixWorld(true);
            rendererCamera = xrRig.children[0] as PerspectiveCamera;
        }

        renderer.render(scene, rendererCamera);
    }
}

function onWindowResize(): void {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function onXRSession() {
  currentFollowDriver = null;
  arPlacingGeomap = true;
  controls.enabled = true;
  updateEntryButtons();
}

function onVRSession() {
  if (!currentFollowDriver) {
    console.warn("Selecione um piloto antes de entrar em VR");
    return;
  }

  controls.enabled    = false;
  cockpitView         = true;
  arPlacingGeomap     = false;

  scene.remove(xrRig);
  const carObj = currentFollowDriver.car.car;
  carObj.add(xrRig);

  const bb = new Box3().setFromObject(carObj);
  const roofHeightZ = bb.max.z - bb.min.z;

  // coloca o rig no meio dessa altura, em Z
  xrRig.position.set(0, 0, roofHeightZ * 0.5);

  const qCorr = new Quaternion().setFromEuler(
    new Euler(Math.PI / 2, 0, 0, /* ordem default 'XYZ' */)
  );
  xrRig.quaternion.copy(carObj.quaternion).multiply(qCorr);

  xrRig.clear();
  xrRig.add(currentFollowDriver.camera);

  updateEntryButtons();
}

function onSessionEnd() {
    arPlacingGeomap = false;
    // globe.tiles.group.visible = true;
    hitTestSourceRequested = false;
}

function onSelect(event) {
    if (reticle && reticle.visible) {
        const clippingPlugin = globe.tiles.getPluginByName('GLOBE_CLIPPING_PLUGIN');
        reticle.matrix.decompose(GLOBE_CONTAINER.position, GLOBE_CONTAINER.quaternion, GLOBE_CONTAINER.scale);
        GLOBE_CONTAINER.scale.setScalar(CONFIG.scale);
        GLOBE_CONTAINER.updateMatrixWorld(true);

        //         const clippingPlanes = clippingPlugin.clippingPlanes.map(plane => plane.clone().applyMatrix4(globeContainer.matrixWorld));
        //         clippingPlugin.applyClipping(clippingPlanes);

        // const planeHelpers = clippingPlanes.map(p => new PlaneHelper(p, 1, 0x00ff00));
        // planeHelpers.forEach(helper => scene.add(helper));

        arPlacingGeomap = false;
    }
}

function showDriverDetails(driver: Driver) {
    if (!detailsPanel) return;

    currentDetailDriver = driver;
    detailsPanel.style.display = 'block';

    raceView.updateInterface(weather, track);

    const camContainer = detailsPanel.querySelector('.cam-view') as HTMLElement;
    const labelCam = camContainer.querySelector('.label-cam') as HTMLElement;

    // Minicam initialization
    if (!detailCamRenderer) {
        detailCamRenderer = new WebGLRenderer({ antialias: true, alpha: true });
        detailCamRenderer.domElement.style.width   = '100%';
        detailCamRenderer.domElement.style.height  = '100%';
        detailCamRenderer.domElement.style.display = camViewEnabled ? 'block' : 'none';
        camContainer.appendChild(detailCamRenderer.domElement);
    }
    const w = camContainer.clientWidth, h = camContainer.clientHeight;
    detailCamRenderer.setSize(w, h, false);

    // SVG Toggle
    if (!labelCam.dataset.toggleInitialized) {
        labelCam.style.cursor = 'pointer';
        labelCam.addEventListener('click', () => {
            camViewEnabled = !camViewEnabled;

            if(camViewEnabled) {
                labelCam.classList.add('active');
            } else {
                labelCam.classList.remove('active');
            }

            detailCamRenderer!.domElement.style.display = camViewEnabled ? 'block' : 'none';
        });
        labelCam.dataset.toggleInitialized = 'true';
    }
    if(camViewEnabled) {
        labelCam.classList.add('active');
    } else {
        labelCam.classList.remove('active');
    }

    // Preenche os campos de texto/imagem/etc
    const info = detailsPanel.querySelector('.driver-info')!;
    info.querySelector('p')!.textContent = String(driver.position);
    (info.querySelector('.bar') as HTMLElement)!.style.backgroundColor = driver.car.team.color;
    info.querySelector('p.text-uppercase')!.textContent = driver.name.split(' ')[1].toUpperCase();

    const drsDiv = detailsPanel.querySelector('.drs')!;
    drsDiv.classList.toggle('active', !!driver.car.drs);

    const closeBtn = detailsPanel.querySelector('.close-button') as HTMLElement;
    closeBtn.onclick = () => {
        detailsPanel.style.display = 'none';
        currentDetailDriver = null;
        camViewEnabled = false;
        if (detailCamRenderer) detailCamRenderer.domElement.style.display = 'none';
        const labelCam = detailsPanel.querySelector('.label-cam') as HTMLElement;
        if (labelCam) labelCam.style.display = 'none';
    };

    const imgEl = detailsPanel.querySelector('.driver-img img') as HTMLImageElement;
    imgEl.src = driver.img;
    imgEl.alt = driver.name;

    detailsPanel.querySelector('.lap p')!.textContent = `${driver.lap}/${maxLap}`;
    detailsPanel.querySelector('.fastest-lap-time p:last-child')!.textContent = driver.fastestLap || '---';

    // Follow button
    const camBtn = detailsPanel.querySelector('.cam-button')! as HTMLElement;

    camBtn.classList.toggle('active', currentFollowDriver === driver);
    
    camBtn.onclick = (e) => {
        e.stopPropagation();
        if (currentFollowDriver === driver) {
            currentFollowDriver = null;
            controls.enabled = true;
            camBtn.classList.remove('active');
        } else {
            if (currentFollowDriver) {
                currentFollowDriver.showLabel();
                currentFollowDriver.showLine();
            }
            currentFollowDriver = driver;
            driver.hideLabel();
            driver.hideLine();
            controls.enabled = false;
            camViewEnabled = false;
            if (detailCamRenderer) detailCamRenderer.domElement.style.display = 'none';
            labelCam.classList.remove('active');
            camBtn.classList.add('active');
        }
        updateEntryButtons();
    };
}

async function loadLoadingScreen() {
  const loadingContainer = document.getElementById("loading-screen");

  if (!loadingContainer) return;

  const svgRes = await fetch("assets/svg/loading/loading.svg.html");
  const svgText = await svgRes.text();
  loadingContainer.innerHTML = svgText;

  const cssLink = document.createElement("link");
  cssLink.rel = "stylesheet";
  cssLink.href = "assets/svg/loading/loading.css";
  document.head.appendChild(cssLink);

  const script = document.createElement("script");
  script.src = "assets/svg/loading/loading.js";
  script.defer = true;
  document.body.appendChild(script);
}


window.addEventListener("load", init);