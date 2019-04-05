import { expect } from "chai";
import http, { IncomingHttpHeaders, IncomingMessage } from "http";

import { MockCorsProxy } from "./proxy";
import { MockCorsProxyConfig } from "./proxy-config.model";

let nextPort = 2345;
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
  this.timeout(500);

  describe("started", function() {
    const proxyPort = nextPort++;
    const proxyHost = "localhost";
    const proxyUrl = `http://${proxyHost}:${proxyPort}`;
    let proxy: MockCorsProxy;
    let proxyConfig: MockCorsProxyConfig;

    beforeEach(function() {
      proxyConfig = new MockCorsProxyConfig();
      proxyConfig.log = {
        info: () => { /* do not log*/},
        error: (...args) => expect.fail(undefined, undefined, args.join(" ")),
      };
      if (infoLogAll) {
        thisTestShouldLogInfoMessages();
      }
      proxy = new MockCorsProxy(proxyConfig);
      proxy.listen(proxyPort);
    });

    function thisTestShouldNotFailOnErrorResponse() {
      proxyConfig.log.error = () => { /* test with expected errors */ };
    }

    function thisTestShouldLogInfoMessages() {
      // tslint:disable-next-line: no-console
      proxyConfig.log.info = (...args) => console.log(...args);
    }

    it("should be up", function(done) {
      const requestUrl = proxyUrl + "/" + proxy.config.testUrl;
      http.get(requestUrl, (res) => {
        expect(res.statusCode).to.equal(200);
        done();
      });
    });

    it("should give useful error responses", function(done) {
      thisTestShouldNotFailOnErrorResponse();
      const protocol = proxy.config.testUrl + "-unknown";
      const requestUrl = proxyUrl + "/" + protocol;

      http.get(requestUrl, (res) => {
        let data = "";
        res.on("data", (chunk) => data += chunk.toString());
        res.on("end", () => {
          const responseValue = JSON.parse(data);
          expect(res.statusCode).to.equal(400);
          expect(res.statusMessage).to.contain("unkonwn protocol");
          expect(res.statusMessage).to.contain(protocol);
          expect(responseValue).to.have.property("reason");
          expect(responseValue).to.have.property("additionalInformation");
          done();
        });
      });
    });

    describe("response preflight requests", function() {
      it("should contain default cors headers", function(done) {
        const customHeaders = ["X-CUSTOM-HEADER1", "X-CUSTOM-HEADER2"];
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
            { key: "Access-Control-Allow-Origin", value: "*" },
            ...allowedMethods.map((method) => ({ key: "Access-Control-Allow-Methods", value: method })),
            ...customHeaders.map((header) => ({ key: "Access-Control-Request-Headers", value: header })),
            { key: "Access-Control-Allow-Credentials", value: true },
            { key: "Access-Control-Max-Age", value: maxAge },
          ]));
          done();
        }).end();
      });
    });

    describe("forward request", function() {
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

        describe("get", function() {
          it("should forward request", function(done) {
            serverLogic = (_req, res) => {
              res.writeHead(200);
              res.end();
            };

            http.get(requestUrl, () => done());
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
          it("adjust domain", (done) => {
            serverLogic = (_req, res) => {
              res.writeHead(200, undefined, {
                "Set-Cookie": `name=SESSION_ID,domain=${targetHost},value=1948910`,
              });
              res.end();
            };

            http.get(requestUrl, (res) => {
              expect(res.headers["Set-Cookie"]).to.eql(`name=SESSION_I D,domain=${proxyHost},value=1948910}`);
              done();
            });
          });
        });

        afterEach((done) => target.close(done));
      });

    });

    afterEach((done) => proxy.close(done));
  });

});
