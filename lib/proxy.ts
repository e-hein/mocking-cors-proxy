import { MockCorsProxyConfig } from "./proxy-config.model";

export class MockCorsProxy {
  constructor(
    public config: Readonly<MockCorsProxyConfig>,
  ) {}

  public close() {}
}
