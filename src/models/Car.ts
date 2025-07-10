import { Mesh, MeshStandardMaterial, SphereGeometry, Vector3, Object3D, Quaternion, Matrix4, Euler, ArrowHelper } from "three";
import { GLTFLoader, OBJLoader, FBXLoader, STLLoader, ColladaLoader, TDSLoader } from "three/examples/jsm/Addons.js";
import { Team } from "./Team";
import { formatError } from "cesium";
import { MedianPassFilter } from "../utils/MedianPassFilter";
export class Car {
  number: number;
  model: string;
  team: Team;
  car: Object3D;
  lastUp: Vector3 = new Vector3(0, 1, 0); // up inicial
  trackPos: number;
  altFilter: MedianPassFilter;

  constructor(number: number, modelo: string, car: Object3D, team: Team) {
    this.number = number;
    this.model = modelo;
    this.team = team;
    this.car = car;
    this.altFilter = new MedianPassFilter(9);

    this.trackPos = 0;
  }

  setPosition(tangent: Vector3, binormal: Vector3, normal: Vector3, position: Vector3) {
    this.car.position.copy(position);
    this.car.quaternion.setFromBasis(tangent, binormal, normal);
    this.car.updateMatrixWorld(true);
  }
}
