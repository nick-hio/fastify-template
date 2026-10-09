---
name: add-rate-limit
description: Steps for limiting how many requests one client may send to this Fastify server with the @fastify/rate-limit plugin, covering the limit per client address, reverse proxies, the 429 response, per-route limits and tests. Use this when asked to add rate limiting or throttling, to protect a login or another costly route from repeated requests, or when clients get 429 responses they should not get.
---

# Add a rate limit

[@fastify/rate-limit](https://github.com/fastify/fastify-rate-limit) counts the requests of each client in a time window and answers those over the limit with 429. The template does not ship with it.

A client is an address, `req.ip`, so the limit is only as good as `TRUST_PROXY`:

- Behind a reverse proxy, every request arrives from the proxy's address. All clients then share one limit, and one busy client locks out the rest. Set `TRUST_PROXY` to the address of the proxy.
- List the proxies in `TRUST_PROXY` and nothing more. With a range that clients are in, such as `0.0.0.0/0`, the address is the first entry of `X-Forwarded-For`, which the client writes. A client that sends a new value with each request is then never limited.

## Steps

1. **Install the plugin** with `bun add @fastify/rate-limit`.

2. **Add the limit** to `src/env.ts`:

    ```ts
    /** How many requests one client address may send per `RATE_LIMIT_WINDOW_MS`. The rest are answered with 429. */
    RATE_LIMIT_MAX: z.coerce.number("Must be a positive whole number").int().positive().default(100),

    /** The length of the window that `RATE_LIMIT_MAX` counts in. */
    RATE_LIMIT_WINDOW_MS: z.coerce
        .number("Must be a positive whole number of milliseconds")
        .int()
        .positive()
        .default(60_000),
    ```

    The right limit depends on the deployment: how many users share an address, how many instances run, and what an incident calls for. That is why it is a variable.

3. **Write the plugin** in `src/plugins/rate-limit.ts`:

    ```ts
    import rateLimit from "@fastify/rate-limit";
    import fp from "fastify-plugin";
    import { env } from "@/env";

    /**
     * Limits how many requests one client address may send per time window and answers the rest with 429.
     * The counts are kept in memory: they start again when the server restarts, and every instance keeps its own.
     */
    export default fp(
        async (fastify) => {
            await fastify.register(rateLimit, {
                max: env.RATE_LIMIT_MAX,
                timeWindow: env.RATE_LIMIT_WINDOW_MS,
                // The plugin throws what this returns, so the error handler gives the 429 the usual error body.
                errorResponseBuilder: () => fastify.httpErrors.tooManyRequests("Rate Limit Exceeded"),
            });

            // The plugin only limits routes. A request that matches none counts too, so that guessing URLs is cut off.
            fastify.setNotFoundHandler({ preHandler: fastify.rateLimit() }, (req, reply) => {
                return reply.notFound(`Route ${req.method}:${req.url} not found`);
            });
        },
        { name: "rate-limit", dependencies: ["@fastify/sensible"] },
    );
    ```

    - The 429 passes through `src/plugins/error-handler.ts`, which builds the body from the `statusCode` and `message` of what was thrown. Return an HTTP error from `errorResponseBuilder`. A plain object without `statusCode` becomes a 500.
    - The plugin sets `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` on the responses of a limited route and `Retry-After` on a 429. The error handler keeps them.
    - Without the not-found handler, requests to unknown routes are not counted at all. Fastify accepts one such handler. If the project has its own, add the `preHandler` to it instead.
    - The counts live in memory. A restart forgets them, and each instance counts alone, so two instances allow twice the limit. Only the 5000 most recent clients are remembered (`cache`). For counts that instances share, pass the plugin a `redis` client or a custom `store`.

4. **Register it** in `src/server.ts` with `await fastify.register(rateLimit);`, after `sensible` and before the routes.

    The plugin uses `httpErrors` from `sensible`. It adds its hook to each route while the route is registered, so a route registered before the plugin is never limited, without a warning. Its hook runs after the server-wide hooks of other plugins, such as CORS and security headers, wherever they are registered, so a 429 carries their headers.

5. **Exempt `/health`** in `src/routes/health.ts`. A route with `rateLimit: false` is not counted:

    ```ts
    // A check that is answered with 429 would report a healthy server as down, so it is not rate limited.
    config: { rateLimit: false },
    ```

6. **Test it.** Every test request comes from one address, so first lift the limit for the other test files in `test/setup.ts`:

    ```ts
    // every test request comes from one address, so the real limit would cut a long test file off
    process.env.RATE_LIMIT_MAX = "100000";
    ```

    `src/env.ts` is read once per test run. To test with a low limit, start a process with `useProcess()` in `test/rate-limit.test.ts`:

    ```ts
    // A limit of two requests in a window that no test outlasts.
    const LIMIT = { RATE_LIMIT_MAX: "2", RATE_LIMIT_WINDOW_MS: "60000" };

    /** Sends `count` requests one after another and returns the status code of each. */
    const statuses = async (url: string, count: number, headers: Record<string, string> = {}) => {
        const codes: number[] = [];
        for (let sent = 0; sent < count; sent++) {
            codes.push((await fetch(url, { headers })).status);
        }
        return codes;
    };

    test("gives each client behind a trusted proxy a limit of its own", async () => {
        const server = await start({ ...LIMIT, TRUST_PROXY: "127.0.0.1" });
        const url = `${server.url}/example`;

        expect(await statuses(url, 3, { "x-forwarded-for": "203.0.113.7" })).toEqual([200, 200, 429]);
        expect(await statuses(url, 1, { "x-forwarded-for": "203.0.113.8" })).toEqual([200]);
    });
    ```

    Cover the body and the headers of a 429, `/health`, an unknown route, and two clients with and without a trusted proxy.

7. **Update the documentation.** Add both variables to `.env.example`, to the table in `README.md` and to `compose.yml` as `RATE_LIMIT_MAX: ${RATE_LIMIT_MAX:-}`. Say in the API section of `README.md` that a client over the limit gets a 429 with `Retry-After`, and in the Routes conventions of `AGENTS.md` how a route sets or leaves the limit.

8. **Verify** with `bun run check`. To see the limit, run `RATE_LIMIT_MAX=3 bun run dev` and send four requests with `for i in 1 2 3 4; do curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/example; done`. The last one is a 429.

## One route

Give a route that is costly or worth guessing at, such as a login, a stricter limit in its `config`:

```ts
// five attempts a minute for each client, counted apart from the limit of the other routes
const loginLimit = { max: 5, timeWindow: "1 minute" };
fastify.post("/login", { config: { rateLimit: loginLimit } }, async () => ({ ok: true }));
```

- A route with its own options has its own count. Its requests do not use up the general limit, and the general limit does not apply to it.
- `config: { rateLimit: false }` takes a route out, as step 5 does for `/health`.
- To count by something other than the address, such as an API key, add `keyGenerator: (req) => ...` to the options.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| All clients get 429 at the same time | They count as one address. The request log shows it as `req.remoteAddress`. Put the address of the proxy in `TRUST_PROXY` |
| A 429 arrives as a 500 | `errorResponseBuilder` returns an object without `statusCode` |
| A route is never limited | It is registered before the plugin, or it has `rateLimit: false` |
| Tests in other files fail with 429 | `test/setup.ts` does not lift the limit, see step 6 |
| `The dependency '@fastify/sensible' of plugin 'rate-limit' is not registered` | The plugin is registered before `sensible` |
| `Not found handler already set for Fastify instance with prefix: '/'` | The project has a not-found handler of its own, see step 3 |
