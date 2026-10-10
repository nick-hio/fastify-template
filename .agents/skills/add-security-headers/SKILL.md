---
name: add-security-headers
description: Steps for adding security response headers to this Fastify server with the @fastify/helmet plugin, covering which headers suit a JSON API, the Content-Security-Policy, HSTS and tests. Use this when asked to add security headers or helmet, to harden the HTTP responses, to turn on HSTS, or when a security scan reports missing headers.
---

# Add security headers

[@fastify/helmet](https://github.com/fastify/fastify-helmet) adds the headers of [helmet](https://helmet.js.org) to every response. The template does not ship with it.

Helmet's defaults are written for a site that serves HTML pages. This server answers with JSON, so the plugin below changes three of them and keeps the rest. [Which headers and why](#which-headers-and-why) gives the reasons.

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
     * The values suit an API that answers with JSON. A route that serves HTML needs a policy of its own.
     */
    export default fp(
        async (fastify) => {
            await fastify.register(helmet, {
                // Helmet's default policy is written for pages with scripts and styles. An API has neither, so a
                // browser that renders a response as a page may load nothing and may not show it in a frame.
                contentSecurityPolicy: {
                    useDefaults: false,
                    directives: {
                        "default-src": ["'none'"],
                        "frame-ancestors": ["'none'"],
                    },
                },
                // the same as `frame-ancestors`, for browsers that do not know it
                xFrameOptions: { action: "deny" },
                // A browser remembers this header for the host name, so it is only sent when the deployment asks for it.
                strictTransportSecurity:
                    env.HSTS_MAX_AGE_SECONDS === undefined
                        ? false
                        : { maxAge: env.HSTS_MAX_AGE_SECONDS, includeSubDomains: false },
            });
        },
        { name: "security-headers" },
    );
    ```

4. **Register it** in `src/server.ts` with `await fastify.register(securityHeaders);`, after `errorHandler` and before every other plugin that adds a hook, such as CORS or authentication.

    The headers are set in an `onRequest` hook, and hooks run in registration order. A plugin that answers a request in its own hook, as CORS does for a preflight and authentication for a 401, ends the request there, and a hook registered after it never runs. `sensible` and `errorHandler` add no hooks, so the order towards them does not matter.

5. **Test it** in `test/security-headers.test.ts`, in a `describe` block that calls `useServer()`. Check a normal response, an error from the error handler and a 404:

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

    `src/env.ts` is read once per test run, so test HSTS in processes of their own. Start one with `useProcess()` and `{ HSTS_MAX_AGE_SECONDS: "300" }` and expect `max-age=300`, and one without the variable and expect no header.

6. **Update the documentation.** Add the variable to `.env.example`, to the table in `README.md` and to `compose.yml` as `HSTS_MAX_AGE_SECONDS: ${HSTS_MAX_AGE_SECONDS:-}`. In `AGENTS.md`, add to the Routes conventions that a route which serves HTML sets its own policy with the `helmet` route option.

7. **Verify** with `bun run check`. To see the headers, run `bun run dev` and send `curl -i http://127.0.0.1:3000/health`.

## Which headers and why

| Header | Sent as | Reason |
| --- | --- | --- |
| `Content-Security-Policy` | `default-src 'none';frame-ancestors 'none'`, not helmet's default | The default allows the scripts, styles and images of a site. An API has none, so a response that a browser renders as a page may load nothing |
| `Strict-Transport-Security` | Only when `HSTS_MAX_AGE_SECONDS` is set. Helmet's default is one year, subdomains included | It only means something over HTTPS, and this server speaks HTTP: whether TLS is in front of it is a fact of the deployment. A browser keeps the promise for the whole `max-age` |
| `X-Frame-Options` | `DENY`, not `SAMEORIGIN` | No response is meant to be shown in a frame |
| `X-Content-Type-Options` | `nosniff`, the default | Keeps a browser from reading a JSON response as HTML or script |
| `Cross-Origin-Resource-Policy` | `same-origin`, the default | Other sites cannot embed a response with `<script>` or `<img>`. A `fetch` that CORS allows is not affected |
| `Referrer-Policy` and six more | The defaults | They act on HTML pages or old browsers and do nothing for JSON. They stay because they cost little and cover a page the server may serve later |

- Start HSTS low, such as `HSTS_MAX_AGE_SECONDS="300"`, and raise it to `31536000` (one year) once every client uses HTTPS. To take it back, set `0`: removing the variable leaves browsers with what they remember.
- `includeSubDomains` is off, so the header speaks for this host name only.

## One route

An HTML page, such as a browsable API documentation UI, needs scripts and styles. `default-src 'none'` blocks them and the page stays blank. Give its route a policy of its own with the `helmet` route option, which replaces the plugin option of the same name. `sendPage` is the handler:

```ts
// a page with a style of its own, which the policy of the API would block
const pagePolicy = {
    useDefaults: false,
    directives: { "default-src": ["'self'"], "style-src": ["'self'", "'unsafe-inline'"] },
};
fastify.get("/page", { helmet: { contentSecurityPolicy: pagePolicy } }, sendPage);
```

- The routes that another plugin registers take no route options. Register that plugin in a scope with an `onRequest` hook that calls `reply.header("content-security-policy", "...")`. A header set on the reply replaces the one from helmet.
- `helmet: false` on a route sends none of the headers.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| A preflight or a 401 has no security headers | The plugin that answered is registered before this one, see step 4 |
| A route's policy contains directives it does not list | `useDefaults: false` is missing, so helmet merged its default policy in |
