import {
  createServer, IncomingMessage, OutgoingHttpHeaders, request as startHttpRequest,
  RequestOptions, Server, ServerResponse,
} from "http";
import { MockCorsProxyConfig } from "./proxy-config.model";
import { sillyReadRawHeaders } from "./silly-read-raw-headers.function";

const reasons = {
  notImplementedYet: `it's not implemented yet`,
  target: `target is a required additional path segment`,
};

export class MockCorsProxy {
  public readonly protocols: {
    [protocol: string]: (req: IncomingMessage, res: ServerResponse, path: string[]) => void,
  } = {};
  public get registeredProtocols() {
    return Object.keys(this.protocols);
  }

  private server: Server;
  private get registeredProtocolsString() {
    return ["", ...this.registeredProtocols].join("\n - ");
  }

  constructor(
    public config: Readonly<MockCorsProxyConfig> = new MockCorsProxyConfig(),
  ) {
    this.server = createServer((req, res) => {
      const fail = this.fail(res);

      if (req.method === "OPTIONS") {
        return this.createPreflightResponse(req, res);
      }

      const url = req.url;
      if (!url) {
        return fail.withReason(`protocol is required as first path segment`);
      }

      const [protocol, ...path] = url.split("/").slice(1);
      this.config.log.info("got", protocol, path);
      const handle = this.protocols[protocol];
      if (typeof handle === "function") {
        return handle(req, res, path);
      } else {
        return fail.withReason(
          `unkonwn protocol: '${protocol}'.`,
          `Registered protocols: ${this.registeredProtocolsString}`,
        );
      }
    });

// tslint:disable-next-line: variable-name
    this.protocols[config.testUrl] = (_req, res) => {
      res.writeHead(200);
      res.write(`Proxy is up and running with protocols: ${this.registeredProtocolsString}`);
      res.end();
    };
    this.protocols.http = (req, res, path) => this.forward(req, res, "http", path);
    this.protocols.https = (req, res, path) => this.forward(req, res, "https", path);
  }

  public listen(port = this.config.port) {
    this.server.listen(port);
  }

  public close() {
    this.server.close();
  }

  private fail = (res: ServerResponse) => ({
    withReason: (reason: string, additionalInformation?: string) => {
      this.config.log.error("failed because", reason, additionalInformation ? "\n" + additionalInformation : "");
      res.writeHead(400, reason);
      res.write(JSON.stringify({
        reason,
        additionalInformation,
      }));
      res.end();
      return;
    },
  })

  private createPreflightResponse(req: IncomingMessage, res: ServerResponse) {
    const corsHeaders = this.corsHeadersFor(req);
    this.config.log.info("corsHeaders", corsHeaders);
    res.writeHead(200, "OK", corsHeaders);
    res.end();
  }

  private forward(
    proxyRequest: IncomingMessage,
    proxyResponse: ServerResponse,
    protocol: "http" | "https",
    path: string[],
  ) {
    const target = path.shift();
    if (!target) {
      return this.fail(proxyResponse).withReason(reasons.target);
    }

    const [hostname, port] = target.split(":");
    const options = {
      protocol: protocol + ":", hostname, port, method: proxyRequest.method,
      headers: proxyRequest.headers,
    } as RequestOptions;
    this.config.log.info(options);

    const targetRequest = startHttpRequest(options, (targetResponse) => {
      const incomingHeaders = sillyReadRawHeaders(targetResponse.rawHeaders);
      this.config.log.info("incoming headers", incomingHeaders);
      const corsHeaders = this.corsHeadersFor(proxyRequest, targetResponse, incomingHeaders);
      const outgoingHeaders: OutgoingHttpHeaders = Object.entries({
        ...incomingHeaders,
        ...corsHeaders,
      })
        .map(([key, value]) => value ? { key, value } : undefined)
        .filter((entry): entry is { key: string, value: string | string[] } => !!(entry && entry.value))
        .reduce((headers, header) => Object.assign(headers, { [header.key]: header.value }), {})
      ;
      this.config.log.info("outgoing headers", outgoingHeaders);
      proxyResponse.writeHead(targetResponse.statusCode || 200, targetResponse.statusMessage, outgoingHeaders);

      targetResponse.pipe(proxyResponse);
    });

    proxyRequest.pipe(targetRequest);
  }

  private corsHeadersFor(
    proxyRequest: IncomingMessage,
    targetResponse?: IncomingMessage,
    incomingHeaders?: OutgoingHttpHeaders,
  ): { [key: string]: string | string[] } {
    const corsHeaders: { [key: string]: string | string[] } = {
      "Access-Control-Allow-Origin": proxyRequest.headers.origin || "*",
      "Access-Control-Allow-Methods": false
        || targetResponse && targetResponse.headers.allow && targetResponse.headers.allow.split(/\s*,\s*/)
        || proxyRequest.headers["Access-Control-Request-Method"]
        || (proxyRequest.method === "OPTIONS" || !proxyRequest.method
          ? this.config.accessControl.methods
          : proxyRequest.method
        )
      ,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Max-Age": "" + this.config.accessControl.maxAge,
    };
    const exposeHeaders = false
    || incomingHeaders && Object.keys(incomingHeaders)
    || targetResponse && Object.keys(sillyReadRawHeaders(targetResponse.rawHeaders))
    ;
    if (exposeHeaders) {
      corsHeaders["Access-Control-Expose-Headers"] = exposeHeaders;
    }
    if (proxyRequest.method === "OPTIONS") {
      corsHeaders["Access-Control-Request-Headers"] = this.config.accessControl.requestHeaders;
    }
    return corsHeaders;
  }
}
