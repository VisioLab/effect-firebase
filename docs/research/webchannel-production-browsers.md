# WebChannel in production and browsers

Research for [#262](https://github.com/VisioLab/effect-firebase/issues/262), part of the map [#259](https://github.com/VisioLab/effect-firebase/issues/259). It follows up the open questions of the WebChannel spike in [#257](https://github.com/VisioLab/effect-firebase/issues/257) (branch `prototype-webchannel-spike`, `packages/client/prototypes/`).

## Sources

Every claim below cites one of these. Line numbers refer to the pinned commits.

| Short name  | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Pinned at                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `fjs`       | [firebase/firebase-js-sdk](https://github.com/firebase/firebase-js-sdk), `packages/firestore` and `packages/webchannel-wrapper`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | [`23bc734`](https://github.com/firebase/firebase-js-sdk/tree/23bc734c5f7d19903d4bb27efe6a48ce7b28a784) |
| `cl`        | [google/closure-library](https://github.com/google/closure-library) (archived), `closure/goog/labs/net/webchannel/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | [`b312823`](https://github.com/google/closure-library/tree/b312823ec5f84239ff1db7526f4a75cba0420a33)   |
| `blob`      | The compiled WebChannel that actually ships: `@firebase/webchannel-wrapper@1.0.7`, `dist/webchannel-blob/esm/webchannel_blob_es2018.js` in this repo's `node_modules`. It is built from [google/closure-net@`6f48f57`](https://github.com/google/closure-net/tree/6f48f578d3e80fe7a85e530a5d95b9351433d135), which only contains compiled blobs ([`fjs` `packages/webchannel-wrapper/package.json`](https://github.com/firebase/firebase-js-sdk/blob/23bc734c5f7d19903d4bb27efe6a48ce7b28a784/packages/webchannel-wrapper/package.json), [`rollup.config.js` L26–L54](https://github.com/firebase/firebase-js-sdk/blob/23bc734c5f7d19903d4bb27efe6a48ce7b28a784/packages/webchannel-wrapper/rollup.config.js#L26-L54)) | 1.0.7                                                                                                  |
| `rpc-ref`   | [Firestore RPC reference, `google.firestore.v1`](https://docs.cloud.google.com/firestore/docs/reference/rpc/google.firestore.v1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | read 2026-11-18                                                                                        |
| `rest-auth` | [Use the Cloud Firestore REST API, "Authentication and authorization"](https://firebase.google.com/docs/firestore/use-rest-api)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | read 2026-11-18                                                                                        |
| `probe`     | Unauthenticated `curl` requests to `https://firestore.googleapis.com` on 2026-11-18, against a project id that does not exist (`demo-x`). No credentials, no real project. Details in [Appendix: probe transcript](#appendix-probe-transcript)                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 2026-11-18                                                                                             |

The readable source (`cl`) is the archived closure-library. The shipped code (`blob`) is a newer closure-net build. Where they differ, this document says so. Where a claim rests on `cl`, the matching string in `blob` was checked: the chunk parser, `X-HTTP-Session-Id`, `Unknown SID`, the `CI`/`TO`/`TYPE=xmlhttp` back-channel parameters, `TYPE=terminate`, the `1.5 *` keep-alive timeout and `credentials: "include"` all appear in `blob` in the same shape.

The `probe` rows are a first-hand observation, not documentation. They were run because they were cheap and needed no credentials. They cover only what an unauthenticated session for a non-existent project shows. Everything that needs a real project or a token is left for the live check in [#269](https://github.com/VisioLab/effect-firebase/issues/269).

## Summary

| Question                                  | Settled by                                        | Answer                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gsessionid` / `X-HTTP-Session-Id`        | source + probe                                    | Ask for it with `X-HTTP-Session-Id=gsessionid` on the handshake. Production answers with an `x-http-session-id` header. Send it back as `gsessionid=<value>` on every later request: forward POSTs, back-channel GETs, terminate. Without it, production answers the back channel with `400 … Unknown SID`, which is fatal.                                                        |
| Back-channel rotation                     | source + probe; busy sessions need live check     | Rotation is client-driven: whenever a back-channel GET completes with `200`, the client opens the next one with the current `AID`, and the server resends every array after `AID`. The server decides when to end a GET. An idle production GET sent a `noop` right away and every 30 s, and ended cleanly after 60 s. How long a busy production GET stays open was not measured. |
| Long-polling fallback                     | source                                            | Same protocol, `CI=1` instead of `CI=0` on the back channel (plus optional `TO=<ms>`). The server then ends each GET after it sends data. Auto-detection is on by default in the browser SDK: if no byte of the first back-channel GET arrives within 2× the handshake RTT, it switches to `CI=1` for the rest of the session.                                                     |
| `\r\n` after length prefixes              | source + probe                                    | Production frames are `<len>\n<json>` with no `\r`, same as the emulator. The closure parser would tolerate a `\r` anyway, because it parses the prefix with `Number()`.                                                                                                                                                                                                           |
| CORS                                      | source + probe                                    | Production allows any `Origin` with credentials, allows `GET,POST`, echoes the requested headers in preflight, and exposes `x-http-session-id` and `x-client-wire-protocol`. The SDK avoids preflights by putting the auth headers in the handshake body (`headers=`).                                                                                                             |
| `fetch` streaming                         | source                                            | The browser SDK uses `fetch` streaming by default (`useFetchStreams = true`, except React Native) for back-channel GETs. Whether Effect's `FetchHttpClient` delivers chunks incrementally in each target browser is not something source reading can settle.                                                                                                                       |
| Service-account OAuth on `Listen`/`Write` | docs strongly suggest yes; **needs a live check** | The RPC reference lists the `datastore` and `cloud-platform` OAuth scopes for `Listen` and `Write` and says both are "only available via gRPC or WebChannel". No first-party source shows a service-account token over WebChannel specifically.                                                                                                                                    |

## gsessionid and X-HTTP-Session-Id

**What the SDK asks for.** `WebChannelConnection.openStream` sets `httpSessionIdParam: 'gsessionid'` with the comment "Required for backend stickiness, routing behavior is based on this parameter" ([`fjs` `webchannel_connection.ts` L231–L254](https://github.com/firebase/firebase-js-sdk/blob/23bc734c5f7d19903d4bb27efe6a48ce7b28a784/packages/firestore/src/platform/browser/webchannel_connection.ts#L231-L254)). The same options add `database=projects/<p>/databases/<d>` to every request through `messageUrlParams`, "to improve routing and project isolation by the backend and must be included in every request".

**Handshake.** When `httpSessionIdParam` is set, the handshake URL carries `X-HTTP-Session-Id=<param name>`, so `X-HTTP-Session-Id=gsessionid` ([`cl` `webchannelbase.js` L1458–L1462](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/webchannelbase.js#L1458-L1462)). The header name constant is `X-HTTP-Session-Id` ([`cl` `labs/net/webchannel.js` L884–L891](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel.js#L884-L891)).

**Reading the reply.** When the `["c", SID, hostPrefix, VER, SVER, keepAliveMs]` array arrives, `onInput_` calls `applyControlHeaders_` before it starts the back channel ([`cl` `webchannelbase.js` L2276–L2327](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/webchannelbase.js#L2276-L2327)). `applyControlHeaders_` reads the `X-HTTP-Session-Id` response header, stores it, and writes `gsessionid=<value>` into the cached forward-channel URI. If the header is missing it only logs a warning, "Missing X_HTTP_SESSION_ID in the handshake response" ([L2238–L2264](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/webchannelbase.js#L2238-L2264)). That is why the spike works against the emulator, which does not send the header (#257).

**Where it goes afterwards.**

- Forward POSTs clone `forwardChannelUri_`, which now holds `gsessionid` ([`makeForwardChannelRequest_` L1535–L1574](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/webchannelbase.js#L1535-L1574)).
- The back-channel URI is built after the header was applied ([`startBackchannelAfterHandshake_`](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/webchannelbase.js#L2373-L2386)), and `getBackChannelUri` adds `gsessionid=<value>` when both the parameter name and the value are known ([L2597–L2601](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/webchannelbase.js#L2597-L2601)).
- `disconnect()` builds the terminate request from `forwardChannelUri_`, so it carries `gsessionid` too ([L758–L778](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/webchannelbase.js#L758-L778)).
- The value is opaque to the protocol ([`labs/net/webchannel.js` L884–L891](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel.js#L884-L891)). The client never renews it during a session.

**What production does** (`probe`):

- The handshake reply carries `x-http-session-id: <opaque ~54 chars>` and `access-control-expose-headers: x-client-wire-protocol,x-http-session-id`. The body is `51\n[[0,["c","<SID>","",8,15,30000]]]`: `VER` 8, server version 15 (the emulator reports 12, see #257), keep-alive 30000 ms.
- A back-channel GET with `gsessionid` returned `200` and streamed frames.
- The same back-channel GET **without** `gsessionid` returned `400` with an HTML body containing `Unknown SID`. `ChannelRequest` maps a `400` whose body contains `Unknown SID` to `UNKNOWN_SESSION_ID` ([`cl` `channelrequest.js` L705–L722](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/channelrequest.js#L705-L722)), and `isFatalError_` treats that, and any other non-200 status, as fatal: no retry, the channel errors ([`webchannelbase.js` L2095–L2099](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/webchannelbase.js#L2095-L2099)).

One probe is one data point: the routing might sometimes land on the right backend by chance. The SDK comment and the probe together say: always send it.

## Back-channel rotation

There is no explicit rotation message in the protocol. The client keeps exactly one back-channel GET open and replaces it when it ends:

- `startBackChannel_` sends `GET ?RID=rpc&SID&AID=<lastArrayId>&CI=0|1[&TO]&TYPE=xmlhttp` ([`cl` `webchannelbase.js` L1794–L1840](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/webchannelbase.js#L1794-L1840)). `AID` is the id of the last array the client processed, so the server can resend what the client has not seen.
- When a back-channel request completes successfully, `onRequestComplete` calls `ensureBackChannel_`, which starts the next GET right away through `goog.async.run` ([L2106–L2140](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/webchannelbase.js#L2106-L2140), [L1650–L1670](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/webchannelbase.js#L1650-L1670)).
- A completed GET that ends partway through a frame is `BAD_DATA` ([`channelrequest.js` L915–L940](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/channelrequest.js#L915-L940)). An empty completed body is `NO_DATA` (same function). Both are not fatal ([`isFatalError_`](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/webchannelbase.js#L2095-L2099)), so they are retried.
- Failed back-channel GETs are retried up to `BACK_CHANNEL_MAX_RETRIES = 3` times, with delay `(base + random(seed)) * retryCount` (×2 if inactive) ([L579](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/webchannelbase.js#L579), [`maybeRetryBackChannel_`](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/webchannelbase.js#L1678-L1699), [`getRetryTime_` L2207–L2220](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/webchannelbase.js#L2207-L2220)). Any received data resets the retry count ([L2348–L2354](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/webchannelbase.js#L2348-L2354)).
- **Timeout.** The default `ChannelRequest` timeout is 45 s ([`channelrequest.js` L316](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/channelrequest.js#L316)). If the handshake advertises a keep-alive (6th element, `CVER=22`), the back-channel timeout becomes `1.5 × keepAlive` ([`webchannelbase.js` L2301–L2308](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/webchannelbase.js#L2301-L2308)); production advertises 30000, so 45 s. The watchdog is rearmed whenever data arrives ([`readyStateChangeHandler_` → `ensureWatchDogTimer_`](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/channelrequest.js#L765-L781)), so it fires only after 45 s of silence.
- **Dead back channel.** Each forward POST is answered with `[backChannelPresent, lastArrayIdSent, outstandingBytes]`. If the first value is `0`, the server says it has no back channel, and the client cancels and restarts its GET when the GET is older than the POST by more than `RTT_ESTIMATE` (3 s) ([`handlePostResponse_` L1956–L1983](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/webchannelbase.js#L1956-L1983), [`handleBackchannelMissing_` L1992–L2015](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/webchannelbase.js#L1992-L2015)). If arrays are outstanding (`lastArrayIdSent > lastArrayId`), fewer than 37 500 bytes, it arms a 6 s timer (`2 × RTT_ESTIMATE`) and restarts the back channel if nothing arrives (`onBackChannelDead_`).

What the server does (`probe`, idle session, no targets, `CI=0`): the GET returned `200` immediately and sent `14\n[[1,["noop"]]]` at once, then a `noop` every 30 s, matching the advertised keep-alive. Production ended the response cleanly right after the third `noop`, 60 s after it opened. So production rotates idle streaming GETs after about 60 s, at a frame boundary. A follow-up GET on the same session with a stale `AID=0` got arrays 1–3 again, then array 4: the server keeps unacknowledged arrays and resends everything after `AID` (appendix).

**Not settled:** when production ends a busy streaming GET (by time, by bytes, or the same 60 s), and whether it ever ends one in the middle of a frame. Source only says the client must be ready for a `200` completion at any time and then reconnect with the current `AID`. The spike already loops (#257, `webchannel-direct.demo.ts`).

## Long-polling fallback and its detection

**Wire difference.** The only difference on the wire is the back-channel query: `CI=0` streams (server keeps the GET open), `CI=1` long-polls (server ends the GET after it sends data), and `TO=<ms>` asks the server to end a hanging long-poll GET after that time ([`cl` `webchannelbase.js` L1814–L1819](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/webchannelbase.js#L1814-L1819); same in `blob`: `S(b,"CI",a.F?"0":"1");!a.F&&a.ia&&S(b,"TO",a.ia)`). The SDK docs describe long-polling as "Each response from the backend will be closed immediately after the backend sends data" ([`fjs` `api/settings.ts` L72–L89](https://github.com/firebase/firebase-js-sdk/blob/23bc734c5f7d19903d4bb27efe6a48ce7b28a784/packages/firestore/src/api/settings.ts#L72-L89)). The handshake and forward channel do not change.

**SDK settings.**

- `experimentalForceLongPolling` → `forceLongPolling` → `allowStreamingMode_ = false`, so every back-channel GET uses `CI=1` ([`fjs` `webchannel_connection.ts` L252–L253](https://github.com/firebase/firebase-js-sdk/blob/23bc734c5f7d19903d4bb27efe6a48ce7b28a784/packages/firestore/src/platform/browser/webchannel_connection.ts#L252-L253), [`cl` `webchannelbase.js` L451–L453](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/webchannelbase.js#L451-L453)).
- `experimentalAutoDetectLongPolling` → `detectBufferingProxy`. It defaults to `true` since v9.22.0 (May 2023) ([`fjs` `api/settings.ts` L91–L105](https://github.com/firebase/firebase-js-sdk/blob/23bc734c5f7d19903d4bb27efe6a48ce7b28a784/packages/firestore/src/api/settings.ts#L91-L105), [`lite-api/settings.ts` L51, L190–L202](https://github.com/firebase/firebase-js-sdk/blob/23bc734c5f7d19903d4bb27efe6a48ce7b28a784/packages/firestore/src/lite-api/settings.ts#L190-L202)). Forcing turns detection off.
- `experimentalLongPollingOptions.timeoutSeconds` (5–30 s, default 30 s on the server) → `longPollingTimeout` in ms → `TO` ([`fjs` `api/long_polling_options.ts` L28–L48](https://github.com/firebase/firebase-js-sdk/blob/23bc734c5f7d19903d4bb27efe6a48ce7b28a784/packages/firestore/src/api/long_polling_options.ts#L28-L48), [`webchannel_connection.ts` L256–L259](https://github.com/firebase/firebase-js-sdk/blob/23bc734c5f7d19903d4bb27efe6a48ce7b28a784/packages/firestore/src/platform/browser/webchannel_connection.ts#L256-L259)).
- Both settings "cannot be used in a Node.js environment" ([`api/settings.ts` L87, L103](https://github.com/firebase/firebase-js-sdk/blob/23bc734c5f7d19903d4bb27efe6a48ce7b28a784/packages/firestore/src/api/settings.ts#L72-L105)), because the Node SDK uses gRPC, not WebChannel.

**Detection algorithm** ([`cl` `webchannelbase.js` L1705–L1775, L1866–L1880](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/webchannelbase.js#L1705-L1775)):

1. Measure the handshake RTT: time from sending the handshake to processing its `c` array ([L2317–L2321](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/webchannelbase.js#L2317-L2321)).
2. Start the first back-channel GET with `CI=0` and a timer of `2 × handshakeRtt`.
3. If any response byte arrives first (`onFirstByteReceived`), there is no buffering proxy: cancel the timer, stay on streaming for the session.
4. If the timer fires first, cancel the GET, set `enableStreaming_ = false`, and start a new GET at once with `CI=1`. Long-polling then lasts for the rest of the session.
5. Detection is off when `fastHandshake` is on ([L456–L465](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/webchannelbase.js#L456-L465)); Firestore does not set `fastHandshake`.

**Production long-poll** (`probe`, one request, idle session): a `CI=1&TO=10000` GET returned the three resent `noop` arrays and then a fourth one, and ended after 30 s, not 10 s and not right after the first data. Either `TO` was ignored or the resent arrays did not count as new data; one request cannot tell which.

This depends on the server sending a byte promptly on a fresh streaming GET. Production does: the `probe` got a `noop` frame 0.2 s after opening the GET. Whether the emulator does the same was not checked; if it does not, detection against the emulator would switch to long-polling. The SDK only logs the outcome as `STAT_EVENT: detected buffering proxy` / `no buffering proxy` ([`fjs` `webchannel_connection.ts` L105–L117](https://github.com/firebase/firebase-js-sdk/blob/23bc734c5f7d19903d4bb27efe6a48ce7b28a784/packages/firestore/src/platform/browser/webchannel_connection.ts#L105-L117)).

## `\r\n` after length prefixes

**Response framing.** `getNextChunk_` reads up to the next `\n`, parses the prefix with `Number(...)`, rejects only `NaN`, and slices that many UTF-16 code units of the decoded text ([`cl` `channelrequest.js` L1032–L1055](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/channelrequest.js#L1032-L1055); identical in `blob`: `d=b.indexOf("\n",c)…c=Number(b.substring(c,d));if(isNaN(c))return Ab`). Consequences:

- `Number("51\r")` is `51`, so a `\r` before the `\n` would be accepted. So would `" 51"`, `""` (0), `"0x33"` and `"5.1e1"`.
- A `\r\n` between frames would be read as an empty prefix → a zero-length chunk, which the channel ignores as whitespace ([`webchannelbase.js` L1916–L1919](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/webchannelbase.js#L1916-L1919)).
- The spike's `WebChannelFrames.ts` is stricter: it requires `^\d+$` and fails with `InvalidLength` otherwise.

**What production sends** (`probe`, inspected with `cat -v`): `51\n[[0,…]]`, `14\n[[1,["noop"]]]`, `661\n[[1,{…}],[2,["close"]]]`. No `\r` anywhere, frames back to back. The handshake reply and the back channel use the same framing as the emulator.

**Request side.** The only `\r\n` in the protocol is in the request: the handshake's `headers=` field is `key:value\r\n` per header, URL-encoded ([`cl` `net/rpc/httpcors.js` L52–L74](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/net/rpc/httpcors.js#L52-L74), used in [`open_` L1467–L1471](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/webchannelbase.js#L1467-L1471)). The spike already does this.

**Text decoding.** On the `fetch` path the client decodes `Uint8Array` chunks with a streaming `TextDecoder` before framing. The archived `cl` passes `{stream: isLastChunk}`, which is inverted ([`channelrequest.js` L866–L871](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/channelrequest.js#L866-L871)); the shipped `blob` passes `{stream:!(e&&f==d-1)}`, which is correct. The spike decodes text before framing too, which is what lengths in UTF-16 code units require.

## CORS

**What the SDK does.**

- Every XHR or fetch sets `withCredentials` from `supportsCrossDomainXhr`, which Firestore sets to `true` ([`fjs` `webchannel_connection.ts` L242](https://github.com/firebase/firebase-js-sdk/blob/23bc734c5f7d19903d4bb27efe6a48ce7b28a784/packages/firestore/src/platform/browser/webchannel_connection.ts#L242), [`cl` `createXhrIo` L2619–L2633](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/webchannelbase.js#L2619-L2633)). On the fetch path `withCredentials = true` means `credentials: "include"`, otherwise `"same-origin"` (`blob`: `set:function(a){this.m=a?"include":"same-origin"}`).
- Auth, App Check, API key and client headers go into `initMessageHeaders`, and `encodeInitMessageHeaders = true` puts them in the handshake body instead of HTTP headers, "to avoid the CORS preflight request" ([`fjs` `webchannel_connection.ts` L265–L281](https://github.com/firebase/firebase-js-sdk/blob/23bc734c5f7d19903d4bb27efe6a48ce7b28a784/packages/firestore/src/platform/browser/webchannel_connection.ts#L265-L281)). The headers are `X-Goog-Api-Client`, `Content-Type: text/plain`, `X-Firebase-GMPID`, the token's headers (`Authorization: Bearer …`), App Check's `x-firebase-appcheck`, custom headers, and `x-goog-api-key` ([`fjs` `rest_connection.ts` L161–L189](https://github.com/firebase/firebase-js-sdk/blob/23bc734c5f7d19903d4bb27efe6a48ce7b28a784/packages/firestore/src/remote/rest_connection.ts#L161-L189), [`webchannel_connection.ts` L491–L502](https://github.com/firebase/firebase-js-sdk/blob/23bc734c5f7d19903d4bb27efe6a48ce7b28a784/packages/firestore/src/platform/browser/webchannel_connection.ts#L491-L502)).
- Firestore sets no `messageHeaders`, so later requests carry no custom headers ([`cl` `webchannelbasetransport.js` L109–L123](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/webchannelbasetransport.js#L109-L123)). POSTs use `Content-Type: application/x-www-form-urlencoded` ([`channelrequest.js` L578–L583](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/channelrequest.js#L578-L583)). Both are CORS-safelisted, so no request in a session needs a preflight.
- Terminate goes through `navigator.sendBeacon` (a POST with an empty body), else an `Image` GET, else an XHR ([`channelrequest.js` L1076–L1106](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/channelrequest.js#L1076-L1106)). It is fire-and-forget.

**What production does** (`probe`, `Origin: https://example.com`):

- Preflight `OPTIONS` → `200`, `access-control-allow-origin: https://example.com`, `access-control-allow-credentials: true`, `access-control-allow-methods: GET,POST`, and `access-control-allow-headers` echoing the requested headers (tried `content-type` and `authorization,x-goog-api-key`).
- Handshake `POST` and back-channel `GET` both carry `access-control-allow-origin: <origin>` and `access-control-allow-credentials: true`. The handshake also carries `access-control-expose-headers: x-client-wire-protocol,x-http-session-id`, so browser code can read `x-http-session-id`.
- The `400 Unknown SID` error page also carried the CORS headers, so a browser can read the status.

**Not settled:** behaviour with a real browser `Origin` and real credentials (for example, whether an allow-list of origins applies once a project's API key has HTTP-referrer restrictions). The probe used no API key.

## `fetch` streaming

- The browser entry point registers Firestore with `useFetchStreams = true`; only React Native passes `false` ([`fjs` `register.ts` L35–L56](https://github.com/firebase/firebase-js-sdk/blob/23bc734c5f7d19903d4bb27efe6a48ce7b28a784/packages/firestore/src/register.ts#L35-L56), [`index.rn.ts` L20](https://github.com/firebase/firebase-js-sdk/blob/23bc734c5f7d19903d4bb27efe6a48ce7b28a784/packages/firestore/src/index.rn.ts#L20)). So fetch streaming is what the SDK uses in browsers today.
- With `useFetchStreams`, every request goes through `FetchXmlHttpFactory`; only back-channel GETs ask for streamed binary chunks (`streamBinaryChunks: isStreaming`, where `isStreaming` is "no POST body") ([`cl` `createXhrIo` L2619–L2633](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/webchannelbase.js#L2619-L2633), [`sendXmlHttp_` L544–L563](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/channelrequest.js#L544-L563), [`useFetchStreamsForResponse_` L898–L907](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/channelrequest.js#L898-L907)). Only the response is streamed; nothing needs request-body streaming.
- Without `TextDecoder` the request fails ([`channelrequest.js` L853–L861](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/channelrequest.js#L853-L861)).
- Buffering-proxy detection (above) is the SDK's guard against environments that buffer the streamed response.

**Not settled:** whether Effect's `FetchHttpClient` response stream delivers each chunk as it arrives in Chrome, Firefox and Safari, and whether a service worker, extension or corporate proxy in the test setup buffers it. That is an Effect and browser question, not a protocol one.

## Service-account OAuth tokens on Listen and Write

**What the docs say.**

- `Listen`: "Listens to changes. This method is only available via gRPC or WebChannel (not REST)." `Write`: "Streams batches of document updates and deletes, in order. This method is only available via gRPC or WebChannel (not REST)." Both list the authorization scopes `https://www.googleapis.com/auth/datastore` and `https://www.googleapis.com/auth/cloud-platform` (`rpc-ref`).
- For the REST API: "Use Firebase ID tokens to authenticate requests from your application's users", and "Use a Google Identity OAuth 2.0 token and a service account to authenticate requests from your application". Requests with a service-account token ignore Security Rules and are authorized by IAM; the token needs the `datastore` scope (`rest-auth`).

**What the SDK shows.**

- A Firebase ID token is sent as `Authorization: Bearer <idToken>`. The class is called `OAuthToken`, but it carries the Firebase Auth ID token ([`fjs` `api/credentials.ts` L83–L93, L200–L220](https://github.com/firebase/firebase-js-sdk/blob/23bc734c5f7d19903d4bb27efe6a48ce7b28a784/packages/firestore/src/api/credentials.ts#L83-L93)). So an ID token and an OAuth access token travel in the same header; the server tells them apart.
- On WebChannel the header travels only in the handshake body (`headers=`). The token is fixed for the session. On a credential change the SDK tears all streams down and opens new ones ([`fjs` `remote_store.ts` L1087–L1113](https://github.com/firebase/firebase-js-sdk/blob/23bc734c5f7d19903d4bb27efe6a48ce7b28a784/packages/firestore/src/remote/remote_store.ts#L1087-L1113)). An `UNAUTHENTICATED` error before the stream is healthy invalidates the token ([`persistent_stream.ts` L390–L403](https://github.com/firebase/firebase-js-sdk/blob/23bc734c5f7d19903d4bb27efe6a48ce7b28a784/packages/firestore/src/remote/persistent_stream.ts#L390-L403)).
- The browser SDK also has a Google-internal `firstParty` credential that sends an arbitrary `Authorization` value plus `X-Goog-AuthUser` and `X-Goog-Iam-Authorization-Token` over the same WebChannel ([`credentials.ts` L40–L64, L407–L470](https://github.com/firebase/firebase-js-sdk/blob/23bc734c5f7d19903d4bb27efe6a48ce7b28a784/packages/firestore/src/api/credentials.ts#L407-L470)). So the WebChannel endpoint accepts some Google credentials besides Firebase ID tokens. It does not show service-account access tokens.
- Unauthenticated requests are accepted at the transport level: the `probe` handshake succeeded with no token, and the error (`PERMISSION_DENIED`, reason `CONSUMER_INVALID`, for the non-existent project) only arrived on the back channel after a target was added.

**Verdict.** Source and docs **do not settle it**. The RPC reference names WebChannel as a transport for `Listen`/`Write` and lists the OAuth scopes for them, which points to yes. No first-party source shows a service-account OAuth access token used over the WebChannel endpoint. A live check is needed.

## Errors on the back channel

Not one of this ticket's questions, but the `probe` produced one and #257 lists it as open:

- Production delivers a stream error as an array with the payload `{"__sm__":{"status":[[{"error":{"code":403,"status":"PERMISSION_DENIED","message":"…","details":[…]}}]]}}`, followed in the same chunk by `[2,["close"]]`.
- `__sm__` is a "single-metadata" wrapper: the transport unwraps it to `data = metadata[firstKey]`, here `[[{error}]]` ([`cl` `webchannelbasetransport.js` L334–L345](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/webchannelbasetransport.js#L334-L345)). The SDK then reads `msg.data[0]`, so `[{error}]`, and checks both `.error` and `[0].error` ("a bug in One Platform that caused errors (and only errors) to be wrapped in an extra array") ([`fjs` `webchannel_connection.ts` L381–L444](https://github.com/firebase/firebase-js-sdk/blob/23bc734c5f7d19903d4bb27efe6a48ce7b28a784/packages/firestore/src/platform/browser/webchannel_connection.ts#L381-L444)). The extra array is exactly what production sent.
- `close` makes the client call `disconnect()` (sends terminate); `stop` signals the `STOP` error ([`cl` `webchannelbase.js` L2331–L2341](https://github.com/google/closure-library/blob/b312823ec5f84239ff1db7526f4a75cba0420a33/closure/goog/labs/net/webchannel/webchannelbase.js#L2331-L2341)).
- After the `close` frame, production kept the GET open (the probe's `curl` timed out after 10 s) instead of ending the response.

## Which open questions from #257 are settled

| #257 open question                | Status                                                                                                                                                                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gsessionid` header in production | Settled (source + probe): production sends `x-http-session-id`; the back channel fails with `400 Unknown SID` without it.                                                                                                                                                      |
| Back-channel rotation             | Mechanism settled by source (client reopens on any `200` completion, using `AID`; 45 s silence timeout; retries). Production ends an idle GET after 60 s at a frame boundary and resends arrays after a stale `AID` (probe). How often production ends a busy GET: live check. |
| Long-polling fallback             | Settled by source: `CI=1` + optional `TO`; detection = no byte within 2× handshake RTT. Production's long-poll timing (one probe: 30 s despite `TO=10000`): live check.                                                                                                        |
| `\r\n` after length prefixes      | Settled (source + probe): production does not send `\r`; the reference parser would tolerate it.                                                                                                                                                                               |
| Browsers: `fetch` streaming       | Protocol side settled (SDK streams back-channel GETs with `fetch` by default). Effect's `FetchHttpClient` in real browsers: live check.                                                                                                                                        |
| Browsers: CORS                    | Settled for an arbitrary origin without credentials (probe). With a real project, API key restrictions and `credentials: "include"`: live check.                                                                                                                               |
| Firestore errors end to end       | Out of scope here; the `__sm__` error shape above is a start. `targetChange.cause` needs a real project.                                                                                                                                                                       |
| Service-account OAuth tokens      | Not settled: live check.                                                                                                                                                                                                                                                       |

## Checklist for the live check

For [#269](https://github.com/VisioLab/effect-firebase/issues/269). It covers only what source reading and the unauthenticated probe could not settle. Use a real production project with a Firestore database, one document the test user may read under Security Rules, one it may not, and a service account with `roles/datastore.user`.

1. **Service-account token, Listen.** Mint an access token for the service account with scope `https://www.googleapis.com/auth/datastore` (and separately `cloud-platform`). Open a `Listen` channel with `Authorization: Bearer <token>` in the handshake `headers=` field. Add a target on a document that Security Rules deny to everyone. Expect: `targetChange` `ADD`, the document, `CURRENT`. Record any error frame verbatim.
2. **Service-account token, Write.** Same token on the `Write` channel: handshake, the initial `WriteRequest` with `database`, read the `streamId` and `streamToken`, send one write, expect a `WriteResponse` with `writeResults`.
3. **Firebase ID token.** Repeat 1 with a Firebase Auth ID token: a rules-allowed document streams; a rules-denied one gives `targetChange` `REMOVE` with a `cause` (record its shape) or an error frame (record it).
4. **No token / expired token.** Listen with no `Authorization`, and with an expired ID token. Record whether the error comes as a `targetChange.cause`, a `__sm__` error frame, or an HTTP status, and its code (`UNAUTHENTICATED` expected for the expired token).
5. **API key.** Repeat 3 with and without `x-goog-api-key` in `headers=`, and with an API key restricted to HTTP referrers, to see whether the key is required or checked against `Origin`.
6. **Busy back-channel rotation.** Keep a Listen session with an active target open for at least 10 minutes while a writer updates the document every few seconds. Log, with timestamps, when each back-channel GET completes and with what (status, last frame, partial frame or not), and whether the next GET with the current `AID` loses or repeats arrays.
7. **Long-polling against production.** Run 6 with `CI=1`, once without `TO` and once with `TO=10000`, always with the current `AID`. Record how long each GET stays open when idle and whether it ends right after each data frame. The unauthenticated probe saw a `TO=10000` GET end only after 30 s.
8. **Browser, `fetch` streaming.** In Chrome, Firefox and Safari, run the Listen session through Effect's `FetchHttpClient` from a page on a real origin (not `localhost` only). Check that each frame is processed when it arrives, not when the GET completes: the first `noop` should show up within a second of opening the back channel.
9. **Browser, CORS with credentials.** In the same pages, check that the handshake needs no preflight (auth in `headers=` only), that `x-http-session-id` is readable from the handshake response, and whether `credentials: "include"` or `"omit"` makes any difference.
10. **Write after an idle period.** Leave a Listen and a Write session idle for longer than the 45 s back-channel timeout and the SDK's 60 s idle timeout, then write. Record whether the server ended the session (`Unknown SID`) and how.

## Implications for the native engine

Facts only; the decisions belong to #259 and its tickets.

- `gsessionid` is per session, comes from the handshake's `x-http-session-id` header, and has to be added to every later request, terminate included. A missing value only produces a warning in the SDK, but production then fails the back channel with a fatal `400 Unknown SID`.
- Every request also carries `database=projects/<p>/databases/<d>` and `VER=8`; the handshake carries `CVER=22`.
- Rotation is the client's job: reopen the back channel after every `200` completion with the current `AID`. A completion that cuts a frame is a retryable `BAD_DATA`, not a fatal error; an empty body is a retryable `NO_DATA`. Any non-200 status is fatal for the session.
- The back channel has a silence timeout of `1.5 × keepAlive` (45 s in production); production sends `noop` every 30 s and ended an idle GET after 60 s. The server resends arrays after the `AID` the client reports, so a reconnect with the right `AID` loses nothing and one with a stale `AID` sees duplicates.
- Long-polling needs no other code path than `CI=1` (and `TO`) on the back channel; the client already loops on completion. Automatic detection needs the handshake RTT and a timer on the first back-channel byte.
- The production framing is `<len>\n<json>` with no `\r`, so the spike's strict prefix check holds against production as observed. The reference parser is more lenient.
- Auth headers travel in the handshake body, so the token is fixed per session; a new token means a new session. Browsers need no preflight as long as nothing else is sent as an HTTP header.
- Error frames arrive as `{"__sm__":{"status":[[{"error":{…}}]]}}`, followed by `["close"]`; the session's GET can stay open after `close`.
- Whether a service-account access token works over WebChannel is open. If it does not, an admin engine would need gRPC (or another transport) for `Listen` and `Write`.

## Appendix: probe transcript

Requests, all to `https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel`, with `database=projects/demo-x/databases/(default)`, no credentials.

**Handshake**: `POST ?VER=8&database=…&RID=100&CVER=22&X-HTTP-Session-Id=gsessionid&t=1`, body `count=1&ofs=0&req0___data__=<addTarget for documents/a/b, targetId 2>`:

```
HTTP/2 200
x-client-wire-protocol: h2
x-http-session-id: WI7BvEouuVFO_f3rjDxaCE9zhJ4UW0iGTjb6xLO9iqFsNazPemGg7A
content-type: text/plain; charset=utf-8
access-control-allow-origin: https://example.com
access-control-allow-credentials: true
access-control-expose-headers: x-client-wire-protocol,x-http-session-id

51
[[0,["c","Xw3iLgy7sdlQBVoLK2ddQw","",8,15,30000]]]
```

**Back channel with `gsessionid`**: `GET ?VER=8&database=…&gsessionid=<value>&RID=rpc&SID=<SID>&AID=0&CI=0&TYPE=xmlhttp&t=1`:

```
HTTP/2 200
cache-control: private, no-store
content-type: text/plain; charset=utf-8
access-control-allow-origin: https://example.com
access-control-allow-credentials: true

661
[[1,{"__sm__":{"status":[[{"error":{"code":403,"details":[{"@type":"type.googleapis.com/google.rpc.ErrorInfo","domain":"googleapis.com","metadata":{"consumer":"projects/demo-x","containerInfo":"demo-x","service":"firestore.googleapis.com"},"reason":"CONSUMER_INVALID"},…],"message":"Permission denied on resource project demo-x.","status":"PERMISSION_DENIED"}}]]}}],[2,["close"]]]
```

The response stayed open after this (the `curl` timed out at 10 s).

**Back channel without `gsessionid`**, same session: `HTTP/2 400`, HTML body `… Your client has issued a malformed or illegal request. Unknown SID …`, with the CORS headers.

**Idle session**: handshake with `count=0`, then a streaming back channel (`CI=0`):

```
[+    0.2s] b'14\n[[1,["noop"]]]'
[+   30.2s] b'14\n[[2,["noop"]]]'
[+   60.2s] b'14\n[[3,["noop"]]]'
[+   60.2s] EOF
streaming GET ended after 60s
```

Then, same session, a long-poll back channel with the stale `AID=0`: `GET …&AID=0&CI=1&TO=10000&TYPE=xmlhttp&t=2` (status `200`):

```
long-poll GET (TO=10000) ended after 30s exit 0
40
[[1,["noop"]],[2,["noop"]],[3,["noop"]]]14
[[4,["noop"]]]
```

Per-frame timestamps were not recorded for this request.

**Preflight**: `OPTIONS` with `Access-Control-Request-Method: POST` and `Access-Control-Request-Headers: authorization,x-goog-api-key`:

```
HTTP/2 200
access-control-allow-origin: https://example.com
access-control-allow-credentials: true
access-control-allow-methods: GET,POST
access-control-allow-headers: authorization,x-goog-api-key
```
