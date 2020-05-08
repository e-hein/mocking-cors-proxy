import commander from "commander";
import * as fs from "fs";
import * as path from "path";
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

function getConfig() {
  const config = new MockingCorsProxyConfig();

  const configFile = commander.config;
  if (configFile) {
    console.log("use config file:", path.resolve(configFile));
    const userConfig = JSON.parse(fs.readFileSync(commander.config, "utf-8"));
    Object.assign(config, userConfig);
  }

  return config;
}

export function run(args: string[]) {
  commander
    .version("0.0.2")
    .option("-m, --map <...path to target>", "statically map an endpoint to real targets", endpointMapping)
    .option("-p, --port <port>", "start on alternative port (default is 2345")
    .option("-c, --config <configJson>", "use config file")
  ;

  commander.parse(args);
  const config = getConfig();
  const proxy = new MockingCorsProxy(config);
  if (commander.map) {
    mappings.forEach((mapping: StaticRoute) => proxy.registerStaticRoute(mapping.from, mapping.to));
  }
  const port = commander.port || config.port || "2345";
  proxy.listen(port);
  console.log("mocking-cors-proxy runnin on " + port);
  process.on("SIGTERM", function() {
    proxy.close();
  });
  return proxy;
}
