import { MockCorsProxy } from './proxy';
import { expect } from 'chai';
import http, { IncomingMessage } from 'http';
import { MockCorsProxyConfig } from './proxy-config.model';

let nextPort = 2345;

describe('proxy', function () {
  this.timeout(100);

  describe('started', function () {
    const proxyPort = nextPort++;
    const proxyHost = 'localhost';
    const proxyUrl = `http://${proxyHost}:${proxyPort}`;
    let proxy: MockCorsProxy;
    let proxyConfig: MockCorsProxyConfig;

    beforeEach(function () {
      proxyConfig = new MockCorsProxyConfig();
      proxyConfig.log = {
        info: () => {},
        error: (...args) => expect.fail(undefined, undefined, args.join(' ')),
      };
      proxy = new MockCorsProxy(proxyConfig);
      proxy.listen(proxyPort);
    });

    function thisTestShouldNotFailOnErrorResponse() {
      proxyConfig.log.error = () => {};
    }

    function thisTestShouldLogInfoMessages() {
      proxyConfig.log.info = (...args) => console.log(...args);
    }

    it('should be up', function (done) {
      const requestUrl = proxyUrl + '/' + proxy.config.testUrl;
      http.get(requestUrl, (res) => {
        expect(res.statusCode).to.equal(200);
        done();
      });
    });

    it('should give useful error responses', function (done) {
      thisTestShouldNotFailOnErrorResponse();
      const protocol = proxy.config.testUrl + '-unknown';
      const requestUrl = proxyUrl + '/' + protocol;

      http.get(requestUrl, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk.toString());
        res.on('end', () => {
          const responseValue = JSON.parse(data);
          expect(res.statusCode).to.equal(400);
          expect(res.statusMessage).to.contain('unkonwn protocol');
          expect(res.statusMessage).to.contain(protocol);
          expect(responseValue).to.have.property('reason');
          expect(responseValue).to.have.property('additionalInformation');
          done();
        })
      });
    });

    describe('response preflight requests', function() {
      it('should contain default cors headers', function(done) {
        proxyConfig.accessControl.requestHeaders = ['X-CUSTOM-HEADER1', 'X-CUSTOM-HEADER2'];
        http.request({
          method: 'OPTIONS',
          host: proxyHost,
          port: proxyPort,
          path: '/http/localhost',
        }, (res) => {
          const headersJson = JSON.stringify(res.rawHeaders);
          expect(headersJson).to.contain('"Access-Control-Allow-Origin","*"');
          proxyConfig.accessControl.methods.forEach((method) => {
            expect(headersJson).to.contain(`"Access-Control-Allow-Methods","${method}"`);
          });
          proxyConfig.accessControl.requestHeaders.forEach((allowedRequestHeader) => {
            expect(headersJson).to.contain(`"Access-Control-Request-Headers","${allowedRequestHeader}"`);
          });
          expect(headersJson).to.contain('"Access-Control-Allow-Credentials","true"');
          expect(headersJson).to.contain(`"Access-Control-Max-Age","${proxyConfig.accessControl.maxAge}"`)
          done();
        }).end();
      });
    });

    describe('forward request', function() {
      it('should return failure response if target path segment is missing', function(done) {
        thisTestShouldNotFailOnErrorResponse();
        const requestUrl = proxyUrl + '/http';

        http.get(requestUrl, (response) => {
          expect(response.statusCode).to.equal(400);
          done();
        });
      });

      describe('to test endpoint', function() {
        const targetProtocol = 'http';
        const targetHost = '127.0.0.1';
        const targetPort = nextPort++;

        const requestPath = `/${targetProtocol}/${targetHost}:${targetPort}`;
        const requestUrl = proxyUrl + requestPath;
        let target: http.Server;
        let serverLogic: (req: http.IncomingMessage, res: http.ServerResponse) => void;

        beforeEach(() => {
          serverLogic = () => expect.fail('did not expect any requests on server')
          target = http.createServer((req, res) => serverLogic(req, res));
          target.listen(targetPort);
        });

        it('but option requests (preflights) should not get forwarded', function (done) {
          serverLogic = () => expect.fail('forwarded request');

          http.request({
            method: 'OPTIONS',
            host: proxyHost,
            port: proxyPort,
            path: requestPath,
          }, () => done()).end();
        });

        describe('get', function () {
          it('should forward request', function (done) {
            serverLogic = () => done();

            http.get(requestUrl);
          });

          it('should forward response with body', function (done) {
            serverLogic = (_req, res) => {
              res.writeHead(201, 'head');
              res.write('data1');
              res.write('data2');
              res.end();
            }

            http.get(requestUrl, (res) => {
              let data: string [] = [];
              res.on('data', (chunk) => data.push(chunk.toString()));
              res.on('end', () => {
                expect(res.statusCode).to.equal(201);
                expect(res.statusMessage).to.equal('head');
                expect(data).to.eql(['data1', 'data2']);
                done();
              })
            })
          });
        });

        describe('post', function() {
          it('should forward request with payload', function (done) {

            let data: string[] = [];
            let test = () => {};
            serverLogic = (req) => {
              req.on('data', (chunk) => data.push(chunk.toString()));
              req.on('end', () => test());
            };

            const testRequest = http.request({
              method: 'POST',
              host: proxyHost,
              port: proxyPort,
              path: requestPath,
            });
            testRequest.write('data1');
            testRequest.write('data2');
            testRequest.end();

            test = () => {
              expect(data).to.eql(['data1', 'data2']);
              done();
            };
          });

          it('should forward response', function (done) {
            let test: (res: IncomingMessage) => void;
            serverLogic = (_req, res) => {
              res.writeHead(201, 'head');
              res.end();
            };

            const testRequest = http.request({
              method: 'POST',
              host: proxyHost,
              port: proxyPort,
              path: requestPath,
            }, (res) => test(res));
            testRequest.write('data1');
            testRequest.write('data2');
            testRequest.end();

            test = (res: IncomingMessage) => {
              expect(res.statusCode).to.equal(201);
              expect(res.statusMessage).to.equal('head');
              done();
            };
          });
        });

        describe('headers', function () {
          it('should forward request headers', function(done) {
            serverLogic = (req) => {
              expect(req.headers['x-test']).to.equal('test');
              done();
            };

            http.get({
              host: proxyHost,
              port: proxyPort,
              path: requestPath,
              headers: {
                'x-test': 'test',
              },
            }, () => {});
          });

          it('should forward response headers', function(done) {
            serverLogic = (_req, res) => {
              res.writeHead(201, 'head', {
                'X-Test': 'test',
                'date': '2010-10-10T00:00:00.000Z',
              });
              res.end();
            };

            http.get(requestUrl, (res) => {
              const headersJson = JSON.stringify(res.rawHeaders);
              expect(headersJson).to.contain('"X-Test","test"');
              expect(headersJson).to.contain('"date","2010-10-10T00:00:00.000Z"');
              done();
            });
          });

          it('should add cors to response', function (done) {
            const origin = 'localhost';
            const methods = ['GET', 'DELETE', 'PURGE'];
            const date = '2010-10-10T00:00:00.000Z';
            serverLogic = (_req, res) => {
              res.setHeader('allow', methods);
              res.setHeader('date', date);
              res.writeHead(201, 'head');
              res.write('data1');
              res.write('data2');
              res.end();
            }

            http.request({
              method: 'GET',
              host: proxyHost,
              port: proxyPort,
              path: requestPath,
              headers: { origin },
            }, (res) => {
              const headersJson = JSON.stringify(res.rawHeaders);
              expect(headersJson).to.contain(`"Access-Control-Allow-Origin","${origin}"`);
              expect(headersJson).to.contain(`"Access-Control-Allow-Methods","GET"`);
              expect(headersJson).to.contain(`"Access-Control-Allow-Methods","DELETE"`);
              expect(headersJson).to.contain(`"Access-Control-Allow-Methods","PURGE"`);
              expect(headersJson).to.contain(`"Access-Control-Allow-Credentials","true"`);
              expect(headersJson).to.contain(`"Access-Control-Expose-Headers","allow"`);
              expect(headersJson).to.contain(`"Access-Control-Expose-Headers","date"`);
              expect(headersJson).to.contain(`"Access-Control-Expose-Headers","Connection"`);
              expect(headersJson).to.contain(`"Access-Control-Expose-Headers","Transfer-Encoding"`);
              expect(headersJson).to.contain(`"Access-Control-Max-Age","10"`);
              done();
            }).end();
          });
        });

        afterEach(() => target.close());
      });

    });

    afterEach(() => proxy.close());
  });

});
