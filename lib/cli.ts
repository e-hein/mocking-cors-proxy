import commander from "commander";
import { MockCorsProxy } from "./proxy";
import { MockCorsProxyConfig } from "./proxy-config.model";

// tslint:disable-next-line: no-var-requires
const packageJson = require("../package.json");
const mappings: Array<{ from: string, to: string }> = [];

function endpointMapping(val: string) {
  const [from, to] = val.split(/ to /);
  const mapping = { from , to };
  mappings.push(mapping);
  return mappings;
}
commander
  .version(packageJson.version)
  .option("-m, --map <...path to target>", "statically map an endpoint to real targets", endpointMapping)
  .option("-p, --port <port>", "start on alternative port (default is 2345")
;

commander.parse(process.argv);
const config = new MockCorsProxyConfig();
const proxy = new MockCorsProxy(config);
mappings.forEach((mapping) => proxy.registerStaticRoute(mapping.from, mapping.to));
proxy.listen(commander.port || config.port);
process.on("SIGTERM", function() {
  proxy.close();
});