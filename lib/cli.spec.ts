import { expect } from "chai";
import { ChildProcess } from "child_process";
import http from "http";
import shelljs from "shelljs";
import { MockCorsProxyConfig } from "./proxy-config.model";

const defaults = new MockCorsProxyConfig();
const silent = true;

const log = silent ? () => { /* do not log */ } : (args: () => any) => {
  // tslint:disable-next-line: no-console
  console.log(args());
};

function expectCleanExit(exitCode: number, errorOrOut: string, stderr?: string) {
  if (stderr !== undefined) {
    log(() => "\n"
      + "\n" + "process output:"
      + "\n" + "output:"
      + "\n" + errorOrOut
      + "\n"
      + "\n" + "errors:"
      + "\n" + stderr
      + "\n"
    , );
    expect(stderr).to.equal("");
  } else {
    log(() => "\n"
      + "\n" + "process output:"
      + "\n" + "errors:"
      + "\n" + errorOrOut
      + "\n"
    , );
    expect(errorOrOut).to.equal("");
  }
  expect(exitCode).to.equal(0);
}

function startProxy(cmd = "npm run cli", url = defaults.testUrl, port = defaults.port): Promise<ChildProcess> {
  return new Promise((resolve) => {
    log(() => ({ "start proxy": silent }));
    const proxy = shelljs.exec(cmd, { silent }, function(code, stdout, stderr) {
      expectCleanExit(code, stdout, stderr);
    });
    const isUp = setInterval(() => {
      log(() => "test proxy");
      const req = http.get(`http://localhost:${port}/${url}`, (res) => {
        log(() => ({ "proxy response": res.statusCode}));
        if (res.statusCode === 200) {
          log(() => "proxy is up");
          clearInterval(isUp);
          resolve(proxy);
        }
      });
      req.on("error", () => log(() => "proxy connect error"));
    }, 500);
  });
}

describe("proxy cli start", function() {
  this.timeout(10000);

  it("should show help", function(done) {
    shelljs.exec("npm run cli -- --help", { silent }, (exitCode, stdout, stderr) => {
      expect(stdout).to.contain("Usage");
      expectCleanExit(exitCode, stderr);
      done();
    });
  });

  it("should show version from package json", function(done) {
    shelljs.exec("npm run cli -- --version", { silent }, (exitCode, stdout, stderr) => {
      expect(exitCode).to.equal(0);
      expect(stdout).to.contain("\n0.0.1\n");
      expect(stderr).to.equal("");
      done();
    });
  });

  it("should start proxy", function(done) {
    startProxy()
      .then((proxy) => proxy.kill())
      .then(() => done())
    ;
  });

  describe("with test endpoint up", function() {
    const proxyPort = defaults.port;
    const proxyHost = "localhost";
    const proxyUrl = `http://${proxyHost}:${proxyPort}`;
    const requestPath = `/http/127.0.0.1:2344`;
    const requestUrl = proxyUrl + requestPath;
    let target: http.Server;
    let serverLogic: (req: http.IncomingMessage, res: http.ServerResponse) => void;

    beforeEach(() => {
      serverLogic = () => expect.fail("did not expect any requests on server");
      target = http.createServer((req, res) => serverLogic(req, res));
      target.listen(2344);
    });

    afterEach(() => target.close());

    it("should forward generic requests", function(done) {
      serverLogic = (_req, res) => {
        res.writeHead(200);
        res.end();
      };

      startProxy().then((proxyProcess) => {
        http.get(requestUrl, (res) => {
          expect(!!proxyProcess).to.equal(true);
          proxyProcess.kill("SIGTERM");
          expect(res.statusCode).to.equal(200);
          done();
        });
      });
    });

    describe("with static route", () => {
      beforeEach(() => {
        serverLogic = (req, res) => {
          res.writeHead(200, req.url);
          res.end();
        };
      });

      function testMapping(orig: string, mappingTarget: string) {
        return new Promise((resolve) => {
          http.get(proxyUrl + orig, (res) => {
            expect(res.statusMessage).to.equal(mappingTarget);
            resolve();
          });
        });
      }

      it("should register one route", function() {
        const startupCmd = `npm run cli --`
          + ` --map "/mapping-test to http://127.0.0.1:2344/target"`
        ;

        log(() => ({ "startup cmd": startupCmd }));
        return startProxy(startupCmd)
          .then((proxyProcess) => {
            const cleanUp = () => proxyProcess.kill("SIGTERM");
            return testMapping("/mapping-test", "/target")
              .then(cleanUp, cleanUp)
            ;
          })
        ;
      });

      it("should register multiple static routes", function() {
        const startupCmd = `npm run cli --`
          + ` --map "/mapping-test to http://127.0.0.1:2344/target"`
          + ` --map "/another-mapping to http://127.0.0.1:2344/another-target"`
        ;
        log(() => ({ "startup cmd": startupCmd }));
        return startProxy(startupCmd)
          .then((proxyProcess) => {
            const cleanUp = () => proxyProcess.kill("SIGTERM");
            return Promise.resolve()
              .then(() => testMapping("/mapping-test", "/target"))
              .then(() => testMapping("/another-mapping", "/another-target"))
              .then(cleanUp, cleanUp)
            ;
          })
        ;
      });
    });

    it("should take alternative port", (done) => {
      serverLogic = (_req, res) => {
        res.writeHead(200);
        res.end();
      };

      const startupCmd = `npm run cli --`
        + ` --port 2355`
      ;

      startProxy(startupCmd, defaults.testUrl, 2355).then((proxyProcess) => {
        http.get(requestUrl.replace("" + proxyPort, "" + 2355), (res) => {
          expect(!!proxyProcess).to.equal(true);
          proxyProcess.kill("SIGTERM");
          expect(res.statusCode).to.equal(200);
          done();
        });
      });
    });
  });
});
