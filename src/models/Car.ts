import { Mesh, MeshStandardMaterial, SphereGeometry, Vector3, Object3D, Quaternion, Matrix4, Euler, ArrowHelper } from "three";
import { GLTFLoader, OBJLoader, FBXLoader, STLLoader, ColladaLoader, TDSLoader } from "three/examples/jsm/Addons.js";
import { Team } from "./Team";
import { formatError } from "cesium";
export class Car {
  number: number;
  model: string;
  team: Team;
  car: Object3D;
  lastUp: Vector3 = new Vector3(0, 1, 0); // up inicial

  constructor(number: number, modelo: string, car: Object3D, team: Team) {
    this.number = number;
    this.model = modelo;
    this.team = team;
    this.car = car;
  }

  setPosition(position: Vector3, tangent: Vector3) {
    this.car.position.copy(position);

    const forward = tangent.clone().normalize();

    const right = new Vector3().crossVectors(this.lastUp, forward).normalize();
    const newUp = new Vector3().crossVectors(forward, right).normalize();

    this.lastUp.copy(newUp.clone());
    
    const m = new Matrix4().makeBasis(right, this.lastUp, forward);
    this.car.quaternion.setFromRotationMatrix(m);

    const correction = new Quaternion().setFromEuler(new Euler(0, 0, Math.PI / 2));
    this.car.quaternion.multiply(correction);

    this.car.updateMatrixWorld();
  }
}
