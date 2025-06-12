import { Vector3, Sprite, Line, PerspectiveCamera } from "three";
import { Car } from "./Car";

export class Driver {
  name: string;
  acronym: string;
  driverNumber: number;
  nationality: string;
  position: number;
  points: number;
  interval?: NodeJS.Timeout;
  car: Car;
  label?: Sprite;
  line?: Line;

  constructor(
    nome: string,
    acronym: string,
    driverNumber: number,
    nacionalidade: string,
    position: number,
    points: number,
    car: Car
  ) {
    this.name = nome;
    this.acronym = acronym;
    this.driverNumber = driverNumber;
    this.nationality = nacionalidade;
    this.position = position;
    this.points = points;
    this.car = car;
  }

  updateLabel(camera: PerspectiveCamera, offset: Vector3) {
    if (this.label && this.car && this.line) {
      const pos = this.car.mesh.position;
      const labelPos = pos.clone().add(offset);

      this.label.position.copy(labelPos);
      this.label.quaternion.copy(camera.quaternion);
      this.line.geometry.setFromPoints([pos, labelPos]);
    }
  }

  positionOnTrack(posicao: Vector3) {
    this.car.setPosition(posicao);
  }
}
