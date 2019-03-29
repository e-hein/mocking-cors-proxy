import { OutgoingHttpHeaders } from "http";

/**
 * Silly reads headers as they are.
 *
 * Compared with nodes header algorithm this method won't change case so 'X-Test-Header' will be 'X-Test-Header' and
 * won't get converted to 'x-test-header'. That's important because case conversion in headers caused different results
 * in proxied and direct requests in some use-cases.
 *
 * @param rawHeaders (e.g. from an request: IncomingMessage)
 */
export function sillyReadRawHeaders(rawHeaders?: string []): OutgoingHttpHeaders {
  if (!rawHeaders) {
    return {};
  }

  return rawHeaders
    .reduce(
      (prev, current, index) => index % 2
        ? prev.concat(Object.assign(prev.pop(), { value: current }))
        : prev.concat({key: current})
      , new Array<{key: string, value?: string}>(),
    )
    .reduce((outgoingHeaders, { key, value }) => {
      if (value) {
        const existingValue = outgoingHeaders[key];
        if (existingValue) {
          if (!(typeof existingValue === "string") && Array.isArray(existingValue)) {
            existingValue.push(value);
          } else {
            outgoingHeaders[key] = ["" + existingValue, value];
          }
        } else {
          outgoingHeaders[key] = value;
        }
      }
      return outgoingHeaders;
    }, {} as OutgoingHttpHeaders);
}
