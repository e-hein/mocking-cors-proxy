import { MockCorsProxy } from './proxy';
import { expect } from 'chai';
import http from 'http';
import { MockCorsProxyConfig } from './proxy-config.model';

let nextPort = 2345;

describe('proxy', () => {

  describe('started', () => {
    const proxyPort = nextPort++;
    const proxyHost = 'localhost';
    const proxyUrl = `http://${proxyHost}:${proxyPort}`;
    let proxy: MockCorsProxy;
    let proxyConfig: MockCorsProxyConfig;

    beforeEach(() => {
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
          expect(Object.keys(responseValue)).to.contain('reason');
          expect(Object.keys(responseValue)).to.contain('additionalInformation');
          done();
        })
      });
    });

    describe('forward request', () => {
      it('should return failure response if target path segment is missing', function(done) {
        this.timeout(100);
        thisTestShouldNotFailOnErrorResponse();
        const requestUrl = proxyUrl + '/http';

        http.get(requestUrl, (response) => {
          expect(response.statusCode).to.equal(400);
          done();
        });
      });

      describe('to test endpoint', () => {
        const targetProtocol = 'http';
        const targetHost = '127.0.0.1';
        const targetPort = nextPort++;
        const requestUrl = proxyUrl + `/${targetProtocol}/${targetHost}:${targetPort}`;
        let target: http.Server;
        let serverLogic: (req: http.IncomingMessage, res: http.ServerResponse) => void;

        beforeEach(() => {
          serverLogic = () => expect.fail('did not expect any requests on server')
          target = http.createServer((req, res) => serverLogic(req, res));
          target.listen(targetPort);
        });

        it('should forward get request', function (done) {
          this.timeout(100);
          serverLogic = () => done();

          http.get(requestUrl);
        });

        it('should forward response with body', function (done) {
          this.timeout(100);
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
        })

        afterEach(() => target.close());
      })

    });

    afterEach(() => proxy.close());
  });

});
