import {
  createServer, IncomingMessage, OutgoingHttpHeaders, request as startHttpRequest,
  RequestOptions, Server, ServerResponse,
} from "http";
import { MockCorsProxyConfig } from "./proxy-config.model";
import { sillyReadRawHeaders } from "./silly-read-raw-headers.function";

const cookieValueIndex = 1;

const reasons = {
  notImplementedYet: `it's not implemented yet`,
  target: `target is a required additional path segment`,
};

function originOf(req: IncomingMessage) {
  const origin = req.headers && (req.headers.origin || req.headers.host);
  return typeof origin === "string"
    ? origin
    : Array.isArray(origin)
      ? origin[0]
      : false
  ;
}

export class MockCorsProxy {
  public readonly protocols: {
    [protocol: string]: (req: IncomingMessage, res: ServerResponse, path: string) => void,
  } = {};
  public get registeredProtocols() {
    return Object.keys(this.protocols);
  }
  public listen: typeof Server.prototype.listen;
  public close: typeof Server.prototype.close;

  private server: Server;
  private get registeredProtocolsString() {
    return ["", ...this.registeredProtocols].join("\n - ");
  }

  constructor(
    public config: Readonly<MockCorsProxyConfig> = new MockCorsProxyConfig(),
  ) {
    this.config.log.info("create proxy", config);
    this.server = createServer((req, res) => {
      const fail = this.fail(res);

      if (req.method === "OPTIONS") {
        return this.createPreflightResponse(req, res);
      }

      const url = req.url;
      this.config.log.info("requested url", url);
      if (!url || url.length < 1 || url === "/") {
        return fail.withReason(`protocol is required as first path segment`);
      }

      const handler = Object.entries(this.protocols)
        .filter(([key]) => url.substr(1).startsWith(key))
        .sort((a, b) => a[0].length - b[0].length)
        .map(([key, handle]) => ({ path: key, handle }))
        .find((entry) => !!entry);

      if (!handler) {
        return fail.withReason(
          `no controller for url: '${url}'.`,
          `Registered controllers: ${this.registeredProtocolsString}`,
        );
      }

      const path = url.substr(handler.path.length + 1);
      this.config.log.info("got", handler.path, path);
      return handler.handle(req, res, path);
    });
    this.listen = this.server.listen.bind(this.server);
    this.close = this.server.close.bind(this.server);

// tslint:disable-next-line: variable-name
    this.protocols[config.testUrl] = (_req, res) => {
      res.writeHead(200);
      res.write(`Proxy is up and running with protocols: ${this.registeredProtocolsString}`);
      res.end();
    };
    this.protocols.http = (req, res, path) => this.forward(req, res, "http", path);
    this.protocols.https = (req, res, path) => this.forward(req, res, "https", path);
  }

  public registerStaticRoute(path: string, targetUrl: string) {
    if (!path.startsWith("/")) {
      throw new Error(`proxy url must start with "/" but is: "${targetUrl}"`);
    }
    const match = targetUrl.match(/(https?:)\/\/([^:\/]+)(:([0-9]+))(.*)/);
    if (!match) {
      throw new Error(`invalid target url: "${targetUrl}"`);
    }

    const target = {
      url: targetUrl,
      protocol: match[1],
      hostname: match[2],
      port: match[4],
      path: match[5],
    };
    this.protocols[path.substr(1)] = (proxyRequest, proxyResponse, proxyRequestPath) => {
      const options = {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        method: proxyRequest.method,
        headers: proxyRequest.headers,
        path: target.path  + proxyRequestPath,
      } as RequestOptions;
      this.config.log.info(options);

      this.forwardTo(options, proxyRequest, proxyResponse);
    };
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
    path: string,
  ) {
    this.config.log.info("forward", { protocol, path });
    if (!path.startsWith("/")) {
      return this.fail(proxyResponse).withReason("invalid path", path);
    }
    const target = path.substr(1).split("/").shift();
    if (!target) {
      return this.fail(proxyResponse).withReason(reasons.target);
    }

    const [hostname, port] = target.split(":");
    const options = {
      protocol: protocol + ":", hostname, port, method: proxyRequest.method,
      headers: proxyRequest.headers, path: path.substr(("/" + target).length),
    } as RequestOptions;
    this.config.log.info(options);

    this.forwardTo(options, proxyRequest, proxyResponse);
  }

  private forwardTo(options: RequestOptions, proxyRequest: IncomingMessage, proxyResponse: ServerResponse) {
    const targetRequest = startHttpRequest(options, (targetResponse) => {
      const incomingHeaders = sillyReadRawHeaders(targetResponse.rawHeaders);
      this.config.log.info("incoming headers", incomingHeaders);
      const corsHeaders = this.corsHeadersFor(proxyRequest, targetResponse, incomingHeaders);
      let outgoingHeaders: OutgoingHttpHeaders = Object.entries({
        ...incomingHeaders,
        ...corsHeaders,
      })
        .map(([key, value]) => value ? { key, value } : undefined)
        .filter((entry): entry is {
          key: string;
          value: string | string[];
        } => !!(entry && entry.value))
        .reduce((headers, header) => Object.assign(headers, { [header.key]: header.value }), {});
      outgoingHeaders = this.rewriteCookieHeadersFor(proxyRequest).in(outgoingHeaders);
      this.config.log.info("outgoing headers", outgoingHeaders);
      proxyResponse.writeHead(targetResponse.statusCode || 200, targetResponse.statusMessage, outgoingHeaders);
      targetResponse.pipe(proxyResponse);
    });
    proxyRequest.on("error", (error) => this.config.log.warn("got error response", error));
    proxyRequest.pipe(targetRequest);
  }

  private rewriteCookieHeadersFor = (req: IncomingMessage) => {
    const path = req.url || "/";
    const domain = originOf(req);
    const rewriteCookie = (cookieString: string): string => {
      const cookieParts = cookieString.split(/\s*;\s*/);
      const [name, value] = (cookieParts.shift() as string).split(/\s*=\s*/);
      if (!name || name.length < 1) {
        this.config.log.warn("forwarding invalid cookie without name:", cookieString);
        return cookieString;
      }
      let parsedCookie = cookieParts.map((part) => part.split(/\s*=\s*/));

      if (!this.config.security) {
        parsedCookie = parsedCookie
          .filter(([key]) => ![/Secure/i, /Https?Only/i]
            .some((secureKey) => !!key.match(secureKey)),
          )
        ;
      }

      const domainPart = parsedCookie.filter(([key]) => key.match(/domain/i));
      if (domain) {
        domainPart.forEach((cookie) => cookie[cookieValueIndex] = domain);
      }

      const pathParts = parsedCookie.filter(([key]) => key.match(/path/i));
      if (pathParts.length < 1) {
        parsedCookie.push(["Path", path]);
      } else {
        if (pathParts.length > 1) {
          this.config.log.warn("forwarding invalid cookie with multiple path parts:", parsedCookie);
        }
        pathParts.forEach((cookie) => {
          const origPath = cookie[cookieValueIndex];
          const adjustedPath = `${path}${origPath}`;
          cookie[cookieValueIndex] = adjustedPath;
        });
      }

      const adjustedCookieString = [[name, value], ...parsedCookie].map((cookie) => cookie.join("=")).join("; ");
      this.config.log.info(`adjusted cookie string\nfrom : ${cookieString}\n to  : ${adjustedCookieString}`);
      return adjustedCookieString;
    };

    return {
      in: (headers: OutgoingHttpHeaders) => Object.entries(headers).reduce((result, [key, value]) => {
        const isCookieHeader = key.match(/^set-cookie$/i);
        if (isCookieHeader && typeof value !== "string" && Array.isArray(value)) {
          result[key] = value.map((item) => rewriteCookie(item));
        } else if (isCookieHeader && typeof value === "string") {
          result[key] = rewriteCookie(value);
        } else {
          result[key] = value;
        }
        return result;
      }, {} as OutgoingHttpHeaders),
    };
  }

  private corsHeadersFor(
    proxyRequest: IncomingMessage,
    targetResponse?: IncomingMessage,
    incomingHeaders?: OutgoingHttpHeaders,
  ): { [key: string]: string | string[] } {
    const corsHeaders: { [key: string]: string | string[] } = {
      "Access-Control-Allow-Origin": originOf(proxyRequest) || "*",
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
