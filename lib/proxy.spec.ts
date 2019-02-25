import { MockCorsProxy } from "./proxy";

describe('proxy', () => {
  it('should start and stop', () => {
    const proxy = new MockCorsProxy({
      port: 2345,
    });
    proxy.close();
  });
})
