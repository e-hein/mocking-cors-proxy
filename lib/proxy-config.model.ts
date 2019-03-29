export class MockCorsProxyConfig {
  public port = 80;
  public testUrl = 'mocking-cors-proxy-test';
  public log = {
    info: (...args: any[]) => console.log(...args),
    error: (...args: any[]) => console.error(...args),
  }
}
