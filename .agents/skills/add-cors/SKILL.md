---
name: add-cors
description: Steps for letting web pages on other origins call this Fastify server with @fastify/cors, covering the origin allowlist, preflights, credentials and tests. Use this when a browser frontend on another domain or port must call the API, when a browser reports a CORS error, or when asked to add or change the allowed origins.
---

# Add CORS

A browser lets a page read a cross-origin response only if the response names the page's origin. [@fastify/cors](https://github.com/fastify/fastify-cors) adds those headers. It also answers the preflight (`OPTIONS`) sent before a `PATCH`, a `DELETE` or a JSON body. The template does not include it, so pages on other origins cannot call the API.

**CORS is not authentication.** Only browsers enforce it, by hiding the response from the page. A request without a preflight, such as a `GET`, still runs from any origin.

## Steps

1. **Ask which origins, and whether they send cookies.**
    - **An origin** is scheme, host and port, without a path: `https://app.example.com`. `http://localhost:5173` and `http://127.0.0.1:5173` are two origins.
    - **Cookies** decide `credentials` in step 4. A token in an `Authorization` header is not a cookie.
    - **No origin given?** Leave the list empty. Do not guess.

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

    - **Keep `origin` a function.** Given a plain list, the plugin answers every preflight with 204 and the allowed methods. With `credentials: true`, it also sends `Access-Control-Allow-Credentials` to every origin. With the function, other origins get only `Vary: Origin` and a 404 preflight.
    - **Never set `origin` to `true` or `"*"`.** `true` echoes any origin, so with `credentials: true` any site the user visits can call the API with the user's cookies and read the answers. Browsers refuse `"*"` with credentials.
    - **`credentials: true`** only if the browser sends cookies (step 1). The page then calls `fetch` with `credentials: "include"`.
    - **`allowedHeaders`** are the request headers a page may send. Add any other header the API reads, such as an API key header.
    - **`exposedHeaders`**: list the response headers a page must read beyond the few defaults, such as `Retry-After`.

5. **Register it** in `src/server.ts` with `await fastify.register(cors);`, after `errorHandler` and before the routes.

    Hooks run in registration order. `sensible` and `errorHandler` add none.
    - **Before plugins that reject requests**, such as authentication. A preflight has no token and must be answered first. A 401 from an earlier hook has no CORS headers, so the page cannot read it.
    - **After plugins that add headers to every response**, such as security headers. CORS answers a preflight in its own hook, so later hooks do not run for it.

6. **Test it.** `src/env.ts` is read once per test run, so set the list in `test/setup.ts`, next to the other variables:

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

    - **Cover** an allowed and an unlisted origin, with and without a preflight. The unlisted origin gets no header that starts with `access-control-`, and a 404 preflight.
    - **Errors too.** Assert `access-control-allow-origin` on an error for an allowed origin, such as a 404. Without it, the page cannot read the error.
    - **`inject()` blocks nothing.** It is not a browser, so every check is a header assertion.
    - **Empty list:** use `useProcess()`. It runs with the defaults of `src/env.ts`, not `test/setup.ts`.

7. **Update the documentation.**
    - Add the variable to `.env.example`, the `README.md` table and `compose.yml` as `CORS_ALLOWED_ORIGINS: ${CORS_ALLOWED_ORIGINS:-}`.
    - In `AGENTS.md`, add under Routes: a new request header a page sends, or a new method, goes into `allowedHeaders` or `methods` in `src/plugins/cors.ts`.

8. **Verify** with `bun run check`. To check a preflight by hand, run `bun run dev` with the origin in `CORS_ALLOWED_ORIGINS`, then:

    ```bash
    curl -i -X OPTIONS http://127.0.0.1:3000/example/1 -H 'Origin: http://localhost:5173' -H 'Access-Control-Request-Method: PATCH'
    ```

## One route

A route's `config` overrides the plugin options:

- `config: { cors: { origin: "*" } }` lets every origin read the route.
- `config: { cors: false }` lets none.

**The preflight still follows the list**, because the route does not answer it. Unlisted origins can only send requests without a preflight, such as a `GET` without custom headers.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Server exits with `CORS_ALLOWED_ORIGINS.0 -> Must be an origin ...` | The entry at that index has a path, a trailing slash, a wildcard, an upper-case letter or a default port such as `:443` |
| Server exits with `TypeError: Invalid URL` | `z.url()` lacks `abort: true`, so `.refine` ran on a non-URL |
| Preflight is a 404 `Route OPTIONS:/... not found` | The request `Origin` is not on the list. Compare it character by character, and check that `compose.yml` passes the variable |
| Preflight is a 204, but the browser blocks the request | A method is missing from `methods`, or a request header from `allowedHeaders` |
| A 401 or other early error has no CORS headers | The plugin that answered is registered before CORS, see step 5 |
