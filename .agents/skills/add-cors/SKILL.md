---
name: add-cors
description: Steps for letting web pages on other origins call this Fastify server with the @fastify/cors plugin, covering the origin allowlist, preflight requests, credentials and tests. Use this when a browser frontend on another domain or port must call the API, when a browser reports a CORS error, or when asked to add or change the allowed origins.
---

# Add CORS

A browser lets a page read a response from another origin only when the response names that origin. [@fastify/cors](https://github.com/fastify/fastify-cors) adds those headers and answers the preflight (`OPTIONS`) request a browser sends before a `PATCH`, a `DELETE` or a JSON body. The template does not ship with it, so no page on another origin can call the API.

CORS is not authentication. Only browsers enforce it, and they only keep the response from the page: a request that needs no preflight, such as a `GET`, still runs when its origin is not allowed.

## Steps

1. **Ask which origins, and whether they send cookies.** An origin is a scheme, a host and a port, without a path: `https://app.example.com`, `http://localhost:5173`. `http://localhost:5173` and `http://127.0.0.1:5173` are two origins. Ask too whether the browser must send cookies with its requests. A token that the page puts in an `Authorization` header is not a cookie. If the task names no origin, leave the list empty and do not guess one.

2. **Install the plugin** with `bun add @fastify/cors`.

3. **Add the allowlist** to `src/env.ts`, above `createEnv`:

    ```ts
    const originMessage =
        "Must be an origin as a browser sends it, such as https://app.example.com, without a path or a trailing slash";

    /**
     * `CORS_ALLOWED_ORIGINS` as a list. An entry is compared with the `Origin` header as a string,
     * so one with a path, a trailing slash, a default port or a wildcard would never match and is refused.
     */
    const origins = z
        .string()
        .transform((value) => value.split(",").map((origin) => origin.trim()))
        .pipe(
            z.array(
                z
                    // `abort` keeps a value that is not a URL away from the next check, where `new URL` would throw
                    .url({ protocol: /^https?$/, hostname: /^[^*]+$/, abort: true, error: originMessage })
                    .refine((value) => new URL(value).origin === value, originMessage),
            ),
        );
    ```

    Then add the variable inside `server`:

    ```ts
    /** The origins, such as `https://app.example.com`, whose pages may call the API from a browser. Unset means none. */
    CORS_ALLOWED_ORIGINS: origins.default([]),
    ```

4. **Write the plugin** in `src/plugins/cors.ts`:

    ```ts
    import cors from "@fastify/cors";
    import fp from "fastify-plugin";
    import { env } from "@/env";

    /**
     * Lets pages on the origins in `CORS_ALLOWED_ORIGINS` call the API from a browser.
     * A request from any other origin is answered without CORS headers, so the browser keeps the response from the page.
     */
    export default fp(
        async (fastify) => {
            await fastify.register(cors, {
                // `true` answers with the origin of the request, `false` adds no CORS header at all
                origin: (origin, callback) =>
                    callback(null, origin !== undefined && env.CORS_ALLOWED_ORIGINS.includes(origin)),
                // the default is GET, HEAD and POST only
                methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
                allowedHeaders: ["Content-Type", "Authorization"],
                credentials: false,
                // seconds a browser may reuse the answer to a preflight
                maxAge: 600,
                // the strict check answers a preflight without `Access-Control-Request-Method` with a plain-text 400
                strictPreflight: false,
            });
        },
        { name: "cors" },
    );
    ```

    - Keep `origin` a function. Given the list itself, the plugin still answers the preflight of any other origin with 204 and the allowed methods, and with `credentials: true` it sends every origin `Access-Control-Allow-Credentials`. With the function, another origin gets no CORS header, only `Vary: Origin`, and its preflight is a 404.
    - Never set `origin` to `true` or `"*"`. `true` repeats the origin of every request, so with `credentials: true` any site the user visits can call the API with the user's cookies and read the answers. Browsers refuse `"*"` together with credentials.
    - Set `credentials: true` only if step 1 said the browser sends cookies. The page must then call `fetch` with `credentials: "include"`.
    - `allowedHeaders` are the request headers a page may send. Add any other header the API reads, such as one that carries an API key.
    - A page can read only a few response headers. To let it read another, such as `Retry-After`, list it in `exposedHeaders`.

5. **Register it** in `src/server.ts` with `await fastify.register(cors);`, after `errorHandler` and before the routes.

    Hooks run in registration order, and `sensible` and `errorHandler` add none. Register CORS before a plugin that can reject a request, such as authentication: a preflight carries no token and must be answered first, and a 401 from a hook that ran before CORS has no CORS headers, so the page cannot read it. Register it after a plugin whose headers belong on every response, such as security headers: CORS answers a preflight in its own hook, and hooks registered after it do not run for that request.

6. **Test it.** `src/env.ts` is read once per test run, so set the list for the whole run in `test/setup.ts`, next to the other variables:

    ```ts
    // the origins that `test/cors.test.ts` sends requests from
    process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com, http://localhost:5173";
    ```

    Then write `test/cors.test.ts`, in a `describe` block that calls `useServer()`:

    ```ts
    /** The headers a browser sends before a request that is not "simple", such as a PATCH or a JSON body. */
    const preflight = (origin: string, method: string) => ({
        origin,
        "access-control-request-method": method,
        "access-control-request-headers": "content-type",
    });

    test.each(["PATCH", "DELETE"])("answers the preflight of a %s from an allowed origin", async (method) => {
        const response = await server().inject({
            method: "OPTIONS",
            url: "/example/1",
            headers: preflight("https://app.example.com", method),
        });
        expect(response.statusCode).toBe(204);
        expect(response.headers).toMatchObject({
            "access-control-allow-origin": "https://app.example.com",
            "access-control-allow-methods": "GET, HEAD, POST, PUT, PATCH, DELETE",
            "access-control-allow-headers": "Content-Type, Authorization",
            "access-control-max-age": "600",
        });
    });
    ```

    - Cover an allowed origin, an origin that is not on the list, and the preflight of both. The other origin must get no header that starts with `access-control-`, and its preflight a 404.
    - Assert `access-control-allow-origin` on an error from an allowed origin too, such as a 404. Without it the page cannot read the error. `inject()` is not a browser: it blocks nothing, so every check is an assertion on headers.
    - For the empty list, start a process with `useProcess()`. It runs with the defaults of `src/env.ts`, not with what `test/setup.ts` sets.

7. **Update the documentation.** Add the variable to `.env.example`, to the table in `README.md` and to `compose.yml` as `CORS_ALLOWED_ORIGINS: ${CORS_ALLOWED_ORIGINS:-}`. In `AGENTS.md`, add to the Routes conventions that a request header a page sends, or a new method, must be added to `allowedHeaders` or `methods` in `src/plugins/cors.ts`.

8. **Verify** with `bun run check`. To see a preflight by hand, run `bun run dev` with the origin in `CORS_ALLOWED_ORIGINS` and send `curl -i -X OPTIONS http://127.0.0.1:3000/example/1 -H 'Origin: http://localhost:5173' -H 'Access-Control-Request-Method: PATCH'`.

## One route

A route overrides the plugin options in its `config`: `config: { cors: { origin: "*" } }` lets every origin read the route, and `config: { cors: false }` lets none. The preflight is not answered by the route, so it still follows the list. An origin that is not on it can therefore only send requests that need no preflight, such as a `GET` without custom headers.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| The server exits with `CORS_ALLOWED_ORIGINS.0 -> Must be an origin ...` | The entry at that position has a path, a trailing slash, a wildcard, an upper-case letter or a default port such as `:443` |
| The server exits with `TypeError: Invalid URL` | `abort: true` is missing from `z.url()`, so `.refine` ran on a value that is not a URL |
| The preflight is a 404 `Route OPTIONS:/... not found` | The `Origin` of the request is not on the list. Compare it character by character, and check that `compose.yml` passes the variable |
| The preflight is a 204 but the browser blocks the request | The method is missing from `methods`, or a request header is missing from `allowedHeaders` |
| A 401 or another early error has no CORS headers | The plugin that answered is registered before CORS, see step 5 |
