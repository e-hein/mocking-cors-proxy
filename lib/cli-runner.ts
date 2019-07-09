import commander from "commander";
import * as fs from "fs";
import { MockingCorsProxy } from "./proxy";
import { MockingCorsProxyConfig } from "./proxy-config.model";
import { StaticRoute } from "./static-route.model";

const mappings: StaticRoute[] = [];
function endpointMapping(val: string) {
  const [from, to] = val.split(/ to /);
  const mapping = { from , to };
  mappings.push(mapping);
  return mapping;
}

export function run(args: string[]) {
  commander
    .version("0.0.1")
    .option("-m, --map <...path to target>", "statically map an endpoint to real targets", endpointMapping)
    .option("-p, --port <port>", "start on alternative port (default is 2345")
    .option("-c, --config <configJson>", "use config file")
  ;

  commander.parse(args);
  const config = commander.config
    ? Object.assign(new MockingCorsProxyConfig(), JSON.parse(fs.readFileSync(commander.config, "utf-8")))
    : new MockingCorsProxyConfig()
  ;
  const proxy = new MockingCorsProxy(config);
  if (commander.map) {
    mappings.forEach((mapping: StaticRoute) => proxy.registerStaticRoute(mapping.from, mapping.to));
  }
  proxy.listen(commander.port || config.port);
  process.on("SIGTERM", function() {
    proxy.close();
  });
  return proxy;
}
