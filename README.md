Mocking Cors Proxy
==================
That's an ***development util*** - do **never** use for productive systems!

Quickstart
----------
```bash
npm i -g mocking-cors-proxy
mocking-cors-proxy --help
> Usage: mocking-cors-proxy [options]
>
> Options:
>   -V, --version                  output the version number
>   -m, --map <...path to target>  statically map an endpoint to real targets
>   -p, --port <port>              start on alternative port (default is 2345)
>   -c, --config <configJson>      use config file
>   -h, --help                     output usage information
mocking-cors-proxy
> (running)
```
- should forward http://localhost:2345/http/www.example.com/index.html to http://www.example.com/index.html and add cors headers to the response.  
- should forward http://localhost:2345/https/www.example.com/index.html to https://www.example.com/index.html and add cors headers to the response.
- should forward http://localhost:2345/http/localhost:4200/app to http://localhost:4200/app so your local app and the google api seems to be on the same host and CORS security is disabled completely.
- there's a test page at http://localhost:2345/mocking-cors-proxy-test that shows you wheter the proxy is alive and known pathes.

Intent
------
During development of web pages it's often useful to be able to run a local dev version with a staged central dev backend. You should not send valid CORS-Responses for localhost from every stage of your backend but while this improves security (a bit) it can lead to much harder development setups. So this proxy helps you to destroy this bit of additional security ;-)

> **Warning:**
> It's not intended to use this software deployed on a central (dev-)server. There's no security and it can help people to hide their true identity while doing eval things!


Command line interface
----------------------
With the command line interface you can configure the port and some static rules without writing a config file.

#### Example:
```bash
npm i -g mocking-cors-proxy
mocking-cors-proxy --port 8080 \
  --map "/app/ to http://localhost:4200" \
  --map "/app2 to http://localhost:4200/app/"
> (running)
```
* should forward http://localhost:8080/app/ to http://localhost:4200/app/
* should forward http://localhost:8080/app2/ to http://localhost:4200/app/ (2nd source does not end with '/' so path is replaced)
* should also do defaults (see above) at port 8080

Config File
-----------
Using a config file, you will get more settings and reusable configurations.  
Complete schema of the config can be found at: [./lib/config.schema.json]()

### Example:
```json
{
  "port": 8081,
  "host": "0.0.0.0",
  "accessControl": {
    "methods": [
      "GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"
    ],
    "maxAge": 10,
    "requestHeaders": [
      "Authorization", "X-Custom-Header"
    ]
  },
  "staticRoutes": [
    { "from": "/app/", "to": "http://localhost:4200" },
    { "from": "/app2", "to": "http://localhost:4200/app/" },
    { "from": "/rest", "to": "http://localhost:3000/rest/" }
  ]
}
```
* should forward http://localhost:8081/app/ to http://localhost:4200/app/
* should forward http://localhost:8081/app2/ to http://localhost:4200/app/ (2nd source does not end with '/' so path is replaced)
* should also do defaults (see above) at port 8081

### Usage:
```bash
npm i -g mocking-cors-proxy
mocking-cors-proxy -c my-mocking-cors-proxy.conf.json
> (running)
```