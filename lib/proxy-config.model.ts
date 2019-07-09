import { StaticRoute } from "./static-route.model";

export class MockCorsProxyConfig {
  public port = 2345;
  public host = "localhost";
  public testUrl = "mocking-cors-proxy-test";
  // tslint:disable: no-console
  public log = {
    info: (...args: any[]) => {
      if (process.env.DEBUG) {
        console.log(...args);
      }
    },
    error: (...args: any[]) => console.error(...args),
    warn: (...args: any[]) => console.error(...args),
  };
  // tslint:enable: no-console
  public accessControl: {
    methods: string[],
    requestHeaders: string[],
    maxAge: number,
  } = {
    methods: [ "GET", "HEAD", "PUT", "PATCH", "POST", "DELETE" ],
    requestHeaders: [],
    maxAge: 10,
  };
  public security = false;
  public staticRoutes: StaticRoute[] = [];
}
