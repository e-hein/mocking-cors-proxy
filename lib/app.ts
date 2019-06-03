import { MockCorsProxy } from "./proxy";
import { MockCorsProxyConfig } from "./proxy-config.model";

const proxyConfig = new MockCorsProxyConfig();
const proxy = new MockCorsProxy(proxyConfig);
proxy.listen();
