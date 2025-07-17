import { Mesh, MeshStandardMaterial, SphereGeometry, Vector3, Object3D, Quaternion, Matrix4, Euler, ArrowHelper } from "three";
import { GLTFLoader, OBJLoader, FBXLoader, STLLoader, ColladaLoader, TDSLoader } from "three/examples/jsm/Addons.js";
import { Team } from "./Team";
import { MedianPassFilter } from "../utils/MedianPassFilter";
export class Car {
  number: number;
  model: string;
  team: Team;
  car: Object3D;
  lastUp: Vector3 = new Vector3(0, 1, 0); // up inicial
  trackPos: number;
  altFilter: MedianPassFilter;
  tire: String;

  constructor(number: number, modelo: string, car: Object3D, team: Team, tire: String) {
    this.number = number;
    this.model = modelo;
    this.team = team;
    this.car = car;
    this.tire = tire;

    this.altFilter = new MedianPassFilter(9);
    this.trackPos = 0;

    this.car.userData.filteredT = new Vector3();
    this.car.userData.filteredB = new Vector3();
    this.car.userData.filteredN = new Vector3();
    this.car.userData.smoothFactor = 0.8;  // low-pass α
    this.car.userData.initialized = false;

  }

  setPosition(tangent: Vector3, binormal: Vector3, normal: Vector3, position: Vector3) {
    this.car.position.copy(position);
    this.car.quaternion.setFromBasis(tangent, binormal, normal);
    this.car.updateMatrixWorld(true);
  }

  getTireColor(): string {
    switch (this.tire.toUpperCase()) {
        case 'S':
        return '#c90705';
        case 'M':
        return '#ffee00';
        case 'H':
        return 'white';
        default:
        return 'gray'; // fallback
    }
  }
}
