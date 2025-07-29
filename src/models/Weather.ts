export class Weather {
  time: string;
  temperature: number; // in Celsius
  humidity: number; // percentage
  sun: boolean;
  lastAtt: string;

  constructor(time: string, temperature: number, humidity: number, sun: boolean, lastAtt: string = '0 seconds') {
    this.time = time;
    this.temperature = temperature;
    this.humidity = humidity;
    this.sun = sun;
    this.lastAtt = lastAtt;
  }
}
