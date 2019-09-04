import { IncomingMessage, Server, ServerResponse } from "http";
import * as WebSocket from "ws";

export class TrafficMonitorServer {
  private readonly wss: WebSocket.Server;

  constructor(server: Server) {
    this.wss = new WebSocket.Server({ server });
  }

  public onRequest = (_req: IncomingMessage, _res: ServerResponse, path: string) => {
    console.log("path", path, this.wss);
  }
}
