import { expect } from "chai";
import http, { IncomingHttpHeaders, IncomingMessage } from "http";

import { MockCorsProxy } from "./proxy";
import { MockCorsProxyConfig } from "./proxy-config.model";

let nextPort = 2360;
const infoLogAll = false;
const shouldNotBeThere = null;

const expectedHeaders = (expected: Array<{ key: string, value: any | null }>) =>
  (actual: IncomingHttpHeaders) => {
    const headersAsJson = JSON.stringify(actual);
    expected.forEach(({ key, value }) => {
      if (value === shouldNotBeThere) {
        expect(headersAsJson).not.to.contain(`"${key}"`);
      } else {
        expect(headersAsJson).to.contain(`"${key}","${value}"`);
      }
    });
    return true;
  }
;

describe("proxy", function() {
  this.timeout(5000);

  describe("started", function() {
    const proxyPort = nextPort++;
    const proxyHost = "localhost";
    const proxyUrl = `http://${proxyHost}:${proxyPort}`;
    const warnings: any[][] = [];
    const errors: any[][] = [];
    let proxy: MockCorsProxy;
    let proxyConfig: MockCorsProxyConfig;

    beforeEach(function() {
      proxyConfig = new MockCorsProxyConfig();
      proxyConfig.log = {
        info: () => { /* do not log*/},
        warn: (...args) => warnings.push(args),
        error: (...args) => errors.push(args),
      };
      proxyConfig.port = proxyPort;
      proxyConfig.host = "127.0.0.1";
      if (infoLogAll) {
        thisTestShouldLogInfoMessages();
      }
      proxy = new MockCorsProxy(proxyConfig);
      proxy.start();
    });

    function thisTestShouldNotFailOnErrorResponse() {
      proxyConfig.log.error = () => { /* test with expected errors */ };
    }

    function thisTestShouldLogInfoMessages() {
      // tslint:disable-next-line: no-console
      proxyConfig.log.info = (...args) => console.log("\n", ...args);
    }

    it("should be up", function(done) {
      const requestUrl = proxyUrl + "/" + proxy.config.testUrl;
      http.get(requestUrl, (res) => {
        expect(res.statusCode).to.equal(200);
        done();
      });
    });

    it("should return failure response if protocol path part is missing", (done) => {
      http.get(proxyUrl, (res) => {
        expect(res.statusCode).to.be.equal(400);
        expect(errors.length).to.equal(1);
        errors.shift();
        done();
      });
    });

    it("should give useful error responses", function(done) {
      thisTestShouldNotFailOnErrorResponse();
      const protocol = "unknown";
      const requestUrl = proxyUrl + "/" + protocol;

      http.get(requestUrl, (res) => {
        let data = "";
        res.on("data", (chunk) => data += chunk.toString());
        res.on("end", () => {
          const responseValue = JSON.parse(data);
          expect(res.statusCode).to.equal(400);
          expect(res.statusMessage).to.contain("no controller");
          expect(res.statusMessage).to.contain(protocol);
          expect(responseValue).to.have.property("reason");
          expect(responseValue).to.have.property("additionalInformation");
          done();
        });
      });
    });

    describe("response preflight requests", function() {
      it("should contain default cors headers", function(done) {
        const customHeaders = ["X-CUSTOM-HEADER1", "X-CUSTOM-HEADER2", "x-Custom-Header-3"];
        const allowedMethods = ["GET", "PUT", "CUSTOM"];
        const maxAge = 13;

        proxyConfig.accessControl = {
          requestHeaders: customHeaders,
          methods: allowedMethods,
          maxAge,
        };

        http.request({
          method: "OPTIONS",
          host: proxyHost,
          port: proxyPort,
          path: "/http/localhost",
        }, (res) => {
          expect(res.rawHeaders).to.satisfies(expectedHeaders([
            { key: "Access-Control-Allow-Origin", value: "localhost:" + proxyPort },
            ...allowedMethods.map((method) => ({ key: "Access-Control-Allow-Methods", value: method })),
            { key: "Access-Control-Allow-Headers", value: customHeaders.join(",") },
            { key: "Access-Control-Allow-Credentials", value: true },
            { key: "Access-Control-Max-Age", value: maxAge },
          ]));
          done();
        }).end();
      });
    });

    describe("forward generic request", function() {
      it("should return failure response if target path segment is missing", function(done) {
        thisTestShouldNotFailOnErrorResponse();
        const requestUrl = proxyUrl + "/http";

        http.get(requestUrl, (response) => {
          expect(response.statusCode).to.equal(400);
          done();
        });
      });

      describe("to test endpoint", function() {
        const targetProtocol = "http";
        const targetHost = "127.0.0.1";
        const targetPort = nextPort++;

        const requestPath = `/${targetProtocol}/${targetHost}:${targetPort}`;
        const requestUrl = proxyUrl + requestPath;
        let target: http.Server;
        let serverLogic: (req: http.IncomingMessage, res: http.ServerResponse) => void;

        beforeEach(() => {
          serverLogic = () => expect.fail("did not expect any requests on server");
          target = http.createServer((req, res) => serverLogic(req, res));
          target.listen(targetPort);
        });

        it("but option requests (preflights) should not get forwarded", function(done) {
          serverLogic = () => expect.fail("forwarded request");

          http.request({
            method: "OPTIONS",
            host: proxyHost,
            port: proxyPort,
            path: requestPath,
          }, () => done()).end();
        });

        describe("error", function() {
          it("should forward error response", function(done) {
            serverLogic = (_req, res) => {
              res.writeHead(401, "unauthorized");
              res.end();
            };

            http.get(requestUrl, (res) => {
              expect(res.statusCode).to.equal(401);
              expect(res.statusMessage).to.equal("unauthorized");
              done();
            });
          });
        });

        describe("get", function() {
          it("should forward request", function(done) {
            serverLogic = (_req, res) => {
              res.writeHead(200);
              res.end();
            };

            http.get(requestUrl, () => done());
          });

          it("should map path", function(done) {
            const requestEndpoint = "/rest/obj?q=search";
            let requestedUrl: string | undefined;

            serverLogic = (req, res) => {
              requestedUrl = req.url;
              res.writeHead(200, "OK");
              res.end();
            };

            http.get(requestUrl + requestEndpoint, () => {
              expect(requestedUrl).to.equal(`${requestEndpoint}`);
              done();
            });
          });

          it("should forward response with body", function(done) {
            serverLogic = (_req, res) => {
              res.writeHead(201, "head");
              res.write("data1");
              res.write("data2");
              res.end();
            };

            http.get(requestUrl, (res) => {
              const data: string [] = [];
              res.on("data", (chunk) => data.push(chunk.toString()));
              res.on("end", () => {
                expect(res.statusCode).to.equal(201);
                expect(res.statusMessage).to.equal("head");
                expect(data).to.eql(["data1", "data2"]);
                done();
              });
            });
          });
        });

        describe("post", function() {
          it("should forward request with payload", function(done) {

            const data: string[] = [];
            serverLogic = (req, res) => {
              req.on("data", (chunk) => data.push(chunk.toString()));
              req.on("end", () => res.end());
              res.writeHead(200);
              res.end();
            };

            const testRequest = http.request({
              method: "POST",
              host: proxyHost,
              port: proxyPort,
              path: requestPath,
            }, () => {
              expect(data).to.eql(["data1", "data2"]);
              done();
            });

            testRequest.write("data1");
            testRequest.write("data2");
            testRequest.end();
          });

          it("should forward response", function(done) {
            let test: (res: IncomingMessage) => void;
            serverLogic = (_req, res) => {
              res.writeHead(201, "head");
              res.end();
            };

            const testRequest = http.request({
              method: "POST",
              host: proxyHost,
              port: proxyPort,
              path: requestPath,
            }, (res) => test(res));
            testRequest.write("data1");
            testRequest.write("data2");
            testRequest.end();

            test = (res: IncomingMessage) => {
              expect(res.statusCode).to.equal(201);
              expect(res.statusMessage).to.equal("head");
              done();
            };
          });
        });

        describe("headers", function() {
          it("should forward request headers", function(done) {
            serverLogic = (req, res) => {
              expect(req.headers["x-test"]).to.equal("test");
              res.writeHead(200);
              res.end();
            };

            http.get({
              host: proxyHost,
              port: proxyPort,
              path: requestPath,
              headers: {
                "x-test": "test",
              },
            }, () => done());
          });

          it("should forward response headers", function(done) {
            serverLogic = (_req, res) => {
              res.writeHead(201, "head", {
                "X-Test": "test",
                "date": "2010-10-10T00:00:00.000Z",
              });
              res.end();
            };

            http.get(requestUrl, (res) => {
              expect(res.rawHeaders).to.satisfies(expectedHeaders([
                { key: "X-Test", value: "test" },
                { key: "x-test", value: shouldNotBeThere },
                { key: "date", value: "2010-10-10T00:00:00.000Z" },
              ]));
              done();
            });
          });

          it("should add cors to response", function(done) {
            const origin = "localhost";
            const methods = ["GET", "DELETE", "PURGE"];
            const date = "2010-10-10T00:00:00.000Z";
            serverLogic = (_req, res) => {
              res.setHeader("allow", methods);
              res.setHeader("date", date);
              res.writeHead(201, "head");
              res.write("data1");
              res.write("data2");
              res.end();
            };

            http.request({
              method: "GET",
              host: proxyHost,
              port: proxyPort,
              path: requestPath,
              headers: { origin },
            }, (res) => {
              expect(res.rawHeaders).to.satisfy(expectedHeaders([
                { key: "Access-Control-Allow-Origin", value: origin },
                ...methods.map((method) => ({ key: "Access-Control-Allow-Methods", value: method })),
                { key: "Access-Control-Expose-Headers", value: "allow" },
                { key: "Access-Control-Expose-Headers", value: "date" },
                { key: "Access-Control-Expose-Headers", value: "Connection" },
                { key: "Access-Control-Expose-Headers", value: "Transfer-Encoding" },
              ]));
              done();
            }).end();
          });
        });

        describe("rewrite cookies", () => {
          it("should warn for invalid cookies but forward them untouched", (done) => {
            serverLogic = (_req, res) => {
              res.writeHead(200, "Ok", {
                "Set-Cookie": "=",
              });
              res.end();
            };

            http.get(requestUrl, (res) => {
              expect("" + warnings.shift()).to.contain("invalid cookie");
              expect(res.rawHeaders).to.satisfy(expectedHeaders([
                { key: "Set-Cookie", value: "="},
              ]));
              done();
            });
          });

          it("adjust domain", (done) => {
            serverLogic = (_req, res) => {
              res.writeHead(200, "Ok", {
                "Set-Cookie": `SESSION_ID=1948910; Domain=${targetHost}; Secure; HttpsOnly`,
              });
              res.end();
            };

            http.get(requestUrl, (res) => {
              const cookieHeader = res.headers["set-cookie"];
              if (!cookieHeader) {
                throw new Error("cookie header not set");
              }
              expect(cookieHeader.length).to.be.equal(1, "too many cookie headers");
              expect(cookieHeader[0]).to.contain(`Domain=${proxyHost}`);
              done();
            });
          });

          it("remove path", (done) => {
            serverLogic = (_req, res) => {
              res.writeHead(200, "Ok", {
                "Set-Cookie": `SESSION_ID=1948910; Domain=${targetHost}; Path=/test; Secure; HttpsOnly`,
              });
              res.end();
            };

            http.get(requestUrl, (res) => {
              const cookieHeader = res.headers["set-cookie"];
              if (!cookieHeader) {
                throw new Error("cookie header not set");
              }
              expect(cookieHeader.length).to.be.equal(1, "too many cookie headers");
              expect(cookieHeader[0]).not.to.contain(`Path=`);
              done();
            });
          });

          it("remove security by default", (done) => {
            serverLogic = (_req, res) => {
              res.writeHead(200, "Ok", {
                "Set-Cookie": `SESSION_ID=1948910; Domain=${targetHost}; Path=/test; Secure; HttpsOnly`,
              });
              res.end();
            };

            http.get(requestUrl, (res) => {
              const cookieHeader = res.headers["set-cookie"];
              if (!cookieHeader) {
                throw new Error("cookie header not set");
              }
              expect(cookieHeader.length).to.be.equal(1, "too many cookie headers");
              expect(cookieHeader[0]).not.to.contain("Secure").and.not.to.contain("HttpsOnly");
              done();
            });
          });

          it("keep security if configured", (done) => {
            proxyConfig.security = true;
            serverLogic = (_req, res) => {
              res.writeHead(200, "Ok", {
                "Set-Cookie": `SESSION_ID=1948910; Domain=${targetHost}; Path=/test; Secure; HttpsOnly`,
              });
              res.end();
            };

            http.get(requestUrl, (res) => {
              const cookieHeader = res.headers["set-cookie"];
              if (!cookieHeader) {
                throw new Error("cookie header not set");
              }
              expect(cookieHeader.length).to.be.equal(1, "too many cookie headers");
              expect(cookieHeader[0]).to.contain("Secure").and.to.contain("HttpsOnly");
              done();
            });
          });
        });

        afterEach((done) => target.close(done));
      });

    });

    describe("forward to register static route", function() {
      const targetProtocol = "http";
      const targetHost = "127.0.0.1";
      const targetPort = nextPort++;
      const targetUrl = `${targetProtocol}://${targetHost}:${targetPort}`;

      let target: http.Server;
      let serverLogic: (req: http.IncomingMessage, res: http.ServerResponse) => void;

      beforeEach(() => {
        serverLogic = () => expect.fail("did not expect any requests on server");
        target = http.createServer((req, res) => serverLogic(req, res));
        target.listen(targetPort);
      });

      it("should map url", (done) => {
        let requestedEndpoint: string | undefined;
        proxy.registerStaticRoute("/rest", targetUrl + "/api");
        serverLogic = (req, res) => {
          requestedEndpoint = req.url;
          res.writeHead(200, "OK");
          res.end();
        };

        http.get(proxyUrl + "/rest/endpoint?q=search", () => {
          expect(requestedEndpoint).to.equal("/api/endpoint?q=search");
          done();
        });
      });

      afterEach((done) => target.close(done));
    });

    afterEach((done) => {
      proxy.close(done);
      expect(errors).to.eql([], "errors should be empty");
      expect(warnings).to.be.eql([], "warnings should be empty");
    });
  });

  describe("inital config", () => {
    it("can register static routes", (done) => {
      // given
      const proxyPort = nextPort++;
      const proxyHost = "localhost";
      const proxyUrl = `http://${proxyHost}:${proxyPort}`;

      const config = new MockCorsProxyConfig();
      config.port = proxyPort;
      config.log.info = () => { /* do not log info */ };

      const targetProtocol = "http";
      const targetHost = "127.0.0.1";
      const targetPort = nextPort++;
      const targetUrl = `${targetProtocol}://${targetHost}:${targetPort}`;
      let requestedEndpoint: string | undefined;

      const target = http.createServer((req, res) => {
        requestedEndpoint = req.url;
        res.writeHead(200, "OK", {
          "Set-Cookie": `SESSION_ID=1948910; Domain=${targetHost}; Path=/endpoint; Secure; HttpsOnly`,
        });
        res.end();
      });
      target.listen(targetPort);

      // when
      config.staticRoutes = [
        { from: "/target", to: targetUrl + "/static-target" },
      ];
      const proxy = new MockCorsProxy(config);
      proxy.start();

      // then
      setTimeout(() => http.get(proxyUrl + "/target/endpoint?q=search", (res) => {
          target.close();
          proxy.close();
          expect(requestedEndpoint).to.equal("/static-target/endpoint?q=search");
          const cookieHeader = res.headers["set-cookie"];
          if (!cookieHeader) {
            throw new Error("cookie header not set");
          }
          expect(cookieHeader.length).to.be.equal(1, "too many cookie headers");
          expect(cookieHeader[0]).not.to.contain(`Path`);
          done();
        })
      , 200);
    });
  });
});
