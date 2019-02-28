import { MockCorsProxyConfig } from './proxy-config.model';
import http from 'http';

export class MockCorsProxy {
  private server: http.Server;

  constructor(
    public config: Readonly<MockCorsProxyConfig> = new MockCorsProxyConfig(),
  ) {
    this.server = http.createServer((req, res) => {
      res.writeHead(404);
      res.end();
    });
  }

  public listen(port = this.config.port) {
    this.server.listen(port);
  }

  public close() {
    this.server.close();
  }
}
