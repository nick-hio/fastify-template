---
name: add-security-headers
description: Steps for adding security response headers with @fastify/helmet, covering which headers suit a JSON API, the Content-Security-Policy, HSTS and tests. Use this when asked to add security headers or helmet, to harden HTTP responses, to turn on HSTS, or when a security scan reports missing headers.
---

# Add security headers

[@fastify/helmet](https://github.com/fastify/fastify-helmet) adds the [helmet](https://helmet.js.org) headers to every response. The template does not ship with it.

Helmet's defaults suit HTML sites. This server answers with JSON, so the plugin below changes three defaults and keeps the rest. See [Which headers and why](#which-headers-and-why).

## Steps

1. **Install the plugin** with `bun add @fastify/helmet`.

2. **Add the HSTS variable** to `src/env.ts`:

    ```ts
    /**
     * Sends `Strict-Transport-Security` with this `max-age`: how long a browser refuses plain HTTP for this
     * host name. Unset sends no header. Set it only when every client reaches the server over HTTPS.
     */
    HSTS_MAX_AGE_SECONDS: z.coerce.number("Must be a whole number of seconds").int().min(0).optional(),
    ```

3. **Write the plugin** in `src/plugins/security-headers.ts`:

    ```ts
    import helmet from "@fastify/helmet";
    import fp from "fastify-plugin";
    import { env } from "@/env";

    /**
     * Adds the security headers to every response, error responses and 404s included.
     * The values suit a JSON API. A route that serves HTML needs a policy of its own.
     */
    export default fp(
        async (fastify) => {
            await fastify.register(helmet, {
                // An API has no scripts or styles, so a response rendered as a page loads nothing and cannot be framed.
                contentSecurityPolicy: {
                    useDefaults: false,
                    directives: {
                        "default-src": ["'none'"],
                        "frame-ancestors": ["'none'"],
                    },
                },
                // the same as `frame-ancestors`, for browsers that do not know it
                xFrameOptions: { action: "deny" },
                // A browser remembers this header for the host name, so send it only when the deployment asks.
                strictTransportSecurity:
                    env.HSTS_MAX_AGE_SECONDS === undefined
                        ? false
                        : { maxAge: env.HSTS_MAX_AGE_SECONDS, includeSubDomains: false },
            });
        },
        { name: "security-headers" },
    );
    ```

4. **Register it** in `src/server.ts` with `await fastify.register(securityHeaders);`. Put it after `errorHandler` and before any other plugin that adds a hook, such as CORS or authentication.

    - **Why:** helmet sets the headers in an `onRequest` hook. Hooks run in registration order.
    - **Early answers:** a plugin that answers in its own hook (CORS preflight, authentication 401) ends the request. Later hooks never run.
    - **`sensible` and `errorHandler`** add no hooks. The order relative to them does not matter.

5. **Test it** in `test/security-headers.test.ts`, in a `describe` block that calls `useServer()`. Cover a normal response, a thrown error, a validation error and an unknown route:

    ```ts
    /** The headers that matter for an API. Helmet adds a few more that only act on HTML pages. */
    const SECURITY_HEADERS = {
        "content-security-policy": "default-src 'none';frame-ancestors 'none'",
        "cross-origin-resource-policy": "same-origin",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
    };

    test.each([
        ["a response", "/health", 200],
        ["an error that a handler throws", "/example/999999", 404],
        ["a request that fails validation", "/example/not-a-number", 400],
        ["a route that does not exist", "/does-not-exist", 404],
    ])("are set on %s", async (_name, url, statusCode) => {
        const response = await server().inject({ method: "GET", url });
        expect(response.statusCode).toBe(statusCode);
        expect(response.headers).toMatchObject(SECURITY_HEADERS);
    });
    ```

    `src/env.ts` is read once per test run. Test HSTS in separate processes with `useProcess()`:

    - With `{ HSTS_MAX_AGE_SECONDS: "300" }`, expect `max-age=300`.
    - Without the variable, expect no header.

6. **Update the documentation.**
    - Add the variable to `.env.example`, to the table in `README.md`, and to `compose.yml` as `HSTS_MAX_AGE_SECONDS: ${HSTS_MAX_AGE_SECONDS:-}`.
    - In `AGENTS.md` Routes conventions, add: a route that serves HTML sets its own policy with the `helmet` route option.

7. **Verify** with `bun run check`. To see the headers, run `bun run dev` and send `curl -i http://127.0.0.1:3000/health`.

## Which headers and why

| Header | Sent as | Reason |
| --- | --- | --- |
| `Content-Security-Policy` | `default-src 'none';frame-ancestors 'none'`, not helmet's default | The default allows a site's scripts, styles and images. An API has none, so a response rendered as a page loads nothing |
| `Strict-Transport-Security` | Only when `HSTS_MAX_AGE_SECONDS` is set. Helmet's default is one year, subdomains included | Works only over HTTPS. TLS in front of this HTTP server is a deployment choice. A browser keeps the promise for the whole `max-age` |
| `X-Frame-Options` | `DENY`, not `SAMEORIGIN` | No response belongs in a frame |
| `X-Content-Type-Options` | `nosniff`, the default | Stops a browser reading JSON as HTML or script |
| `Cross-Origin-Resource-Policy` | `same-origin`, the default | Other sites cannot embed a response with `<script>` or `<img>`. A CORS-allowed `fetch` still works |
| `Referrer-Policy` and six more | The defaults | Act only on HTML pages or old browsers. Kept because they are cheap and cover a page the server may serve later |

- **Start HSTS low**, such as `HSTS_MAX_AGE_SECONDS="300"`. Raise it to `31536000` (one year) once every client uses HTTPS.
- **To take HSTS back**, set `0`. Removing the variable leaves browsers with what they remember.
- **`includeSubDomains` is off**, so the header covers this host name only.

## One route

An HTML page, such as an API docs UI, needs scripts and styles. `default-src 'none'` blocks them, so the page stays blank. Set its route's policy with the `helmet` route option, which replaces the plugin option. `sendPage` is the handler:

```ts
// a page with its own style, which the API policy would block
const pagePolicy = {
    useDefaults: false,
    directives: { "default-src": ["'self'"], "style-src": ["'self'", "'unsafe-inline'"] },
};
fastify.get("/page", { helmet: { contentSecurityPolicy: pagePolicy } }, sendPage);
```

- **Routes from another plugin** take no route options. Register that plugin in a scope with an `onRequest` hook that calls `reply.header("content-security-policy", "...")`. It replaces helmet's header.
- **`helmet: false`** on a route sends none of the headers.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| A preflight or a 401 has no security headers | The answering plugin is registered before this one, see step 4 |
| A route's policy has directives it does not list | `useDefaults: false` is missing, so helmet merged in its defaults |
