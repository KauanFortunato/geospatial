import { Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from "three";
import { Team } from "./Team";

export class Car {
  number: number;
  model: string;
  team: Team;
  mesh: Mesh;

  constructor(number: number, modelo: string, team: Team) {
    this.number = number;
    this.model = modelo;
    this.team = team;

    // Criar a malha do carro (uma esfera com cor da equipe)
    const geometry = new SphereGeometry(2, 16, 16); // raio, segmentos
    const material = new MeshStandardMaterial({ color: team.color });
    this.mesh = new Mesh(geometry, material);
  }

  setPosition(posicao: Vector3) {
    this.mesh.position.copy(posicao);
  }
}
