import { MockCorsProxyConfig } from './proxy-config.model';
import http, { createServer, request as startHttpRequest, IncomingMessage, RequestOptions, Server, ServerResponse } from 'http';

const reasons = {
  notImplementedYet: `it's not implemented yet`,
  target: `target is a required additional path segment`,
}
export class MockCorsProxy {
  public readonly protocols: { [protocol: string]: (req: IncomingMessage, res: ServerResponse, path: string[]) => void} = {};
  public get registeredProtocols() {
    return Object.keys(this.protocols);
  }

  private server: Server;
  private fail = (res: ServerResponse) => ({
    withReason: (reason: string, additionalInformation?: string) => {
      this.config.log.error('failed because', reason, additionalInformation ? '\n' + additionalInformation : '');
      res.writeHead(400, reason);
      res.write(JSON.stringify({
        reason,
        additionalInformation
      }));
      res.end();
      return;
    },
  });
  private get registeredProtocolsString() {
    return ['', ...this.registeredProtocols].join('\n - ');
  }

  constructor(
    public config: Readonly<MockCorsProxyConfig> = new MockCorsProxyConfig(),
  ) {
    this.server = createServer((req, res) => {
      const fail = this.fail(res);
      const url = req.url;
      if (!url) {
        return fail.withReason(`protocol is required as first path segment`);
      }

      const [protocol, ...path] = url.split('/').slice(1);
      const handle = this.protocols[protocol];
      if (typeof handle === 'function') {
        return handle(req, res, path);
      } else {
        return fail.withReason(`unkonwn protocol: '${protocol}'.`, `Registered protocols: ${this.registeredProtocolsString}`);
      }
    });

    this.protocols[config.testUrl] = (_req, res) => {
      res.writeHead(200);
      res.write(`Proxy is up and running with protocols: ${this.registeredProtocolsString}`);
      res.end();
    }
    this.protocols.http = (req, res, path) => this.forward(req, res, 'http', path);
    this.protocols.https = (req, res, path) => this.forward(req, res, 'https', path);
  }

  private forward(proxyRequest: IncomingMessage, proxyResponse: ServerResponse, protocol: 'http' | 'https', path: string[]) {
    const target = path.shift();
    if (!target) return this.fail(proxyResponse).withReason(reasons.target);

    const [hostname, port] = target.split(':');
    const options = {
      protocol: protocol + ':', hostname, port, method: proxyRequest.method,
    } as RequestOptions;
    this.config.log.info(options);

    const targetRequest = startHttpRequest(options, (targetResponse) => {
      proxyResponse.writeHead(targetResponse.statusCode || 200, targetResponse.statusMessage);

      targetResponse.pipe(proxyResponse);
    });
    proxyRequest.pipe(targetRequest);
  }

  public listen(port = this.config.port) {
    this.server.listen(port);
  }

  public close() {
    this.server.close();
  }
}
