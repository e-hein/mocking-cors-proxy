import { MockingCorsProxy } from "./proxy";
import { MockingCorsProxyConfig } from "./proxy-config.model";

const proxyConfig = new MockingCorsProxyConfig();
const proxy = new MockingCorsProxy(proxyConfig);
proxy.listen();
