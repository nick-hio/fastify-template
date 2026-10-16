---
name: add-rate-limit
description: Steps for limiting each client's requests to this Fastify server with @fastify/rate-limit, covering the limit per client address, reverse proxies, the 429 response, per-route limits and tests. Use this when asked to add rate limiting or throttling, to protect a login or another costly route from repeated requests, or when clients get unwanted 429 responses.
---

# Add a rate limit

[@fastify/rate-limit](https://github.com/fastify/fastify-rate-limit) counts each client's requests in a time window and answers those over the limit with 429. The template does not ship with it.

The plugin counts requests per client address (`req.ip`), so `TRUST_PROXY` must be correct:

- **Behind a proxy**, set `TRUST_PROXY` to the proxy's address. Otherwise all clients share one limit.
- **Trust only the proxies.** With a wide range such as `0.0.0.0/0`, a client can set its own address in `X-Forwarded-For` and is never limited.

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

    The right limit depends on the deployment, so it is a variable.

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

            // The plugin only limits routes. Count unmatched requests too, to cut off URL guessing.
            fastify.setNotFoundHandler({ preHandler: fastify.rateLimit() }, (req, reply) => {
                return reply.notFound(`Route ${req.method}:${req.url} not found`);
            });
        },
        { name: "rate-limit", dependencies: ["@fastify/sensible"] },
    );
    ```

    - **Return an HTTP error** from `errorResponseBuilder`. `src/plugins/error-handler.ts` builds the 429 body from its `statusCode` and `message`. An object without `statusCode` becomes a 500.
    - **Headers:** limited routes get `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`. A 429 also gets `Retry-After`. The error handler keeps them.
    - **Not-found handler:** without it, unknown routes are not counted. Fastify allows only one. If the project has one, add the `preHandler` to it.
    - **Counts are in memory.** A restart clears them. Each instance counts alone, so two instances allow twice the limit. Only the 5000 most recent clients are kept (`cache`). To share counts, pass a `redis` client or a custom `store`.

4. **Register it** in `src/server.ts` with `await fastify.register(rateLimit);`, after `sensible` (for `httpErrors`) and before the routes.

    - **Order matters.** The plugin hooks each route at registration. A route registered earlier is never limited, and nothing warns.
    - **A 429 keeps other plugins' headers**, such as CORS and security headers. Its hook runs after their server-wide hooks, wherever they are registered.

5. **Exempt `/health`** in `src/routes/health.ts` with `rateLimit: false`:

    ```ts
    // A check that is answered with 429 would report a healthy server as down, so it is not rate limited.
    config: { rateLimit: false },
    ```

6. **Test it.** All test requests share one address, so lift the limit for the other test files in `test/setup.ts`:

    ```ts
    // every test request comes from one address, so the real limit would cut a long test file off
    process.env.RATE_LIMIT_MAX = "100000";
    ```

    `src/env.ts` is read once per run. To test a low limit, start a process with `useProcess()` in `test/rate-limit.test.ts`. Below, `start` is `const start = useProcess();` from the `describe` block:

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

    Also cover:

    - A 429's body and headers.
    - `/health`.
    - An unknown route.
    - Two clients, with and without a trusted proxy.

7. **Update the documentation.**

    - Add both variables to `.env.example`, the `README.md` table, and `compose.yml` (as `RATE_LIMIT_MAX: ${RATE_LIMIT_MAX:-}`).
    - `README.md` API section: a client over the limit gets a 429 with `Retry-After`.
    - `AGENTS.md` Routes conventions: how a route sets or opts out of the limit.

8. **Verify** with `bun run check`. To see the limit, run `RATE_LIMIT_MAX=3 bun run dev` and send four requests. The fourth gets 429:

    ```bash
    for i in 1 2 3 4; do curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/example; done
    ```

## One route

Give a costly or guessable route, such as a login, a stricter limit in its `config`:

```ts
// five attempts a minute for each client, counted apart from the limit of the other routes
const loginLimit = { max: 5, timeWindow: "1 minute" };
fastify.post("/login", { config: { rateLimit: loginLimit } }, async () => ({ ok: true }));
```

- **Separate count.** A route with its own options has its own count. The general limit neither applies to it nor counts its requests.
- **Opt out** with `config: { rateLimit: false }` (step 5).
- **Other keys:** to count by something other than the address, such as an API key, add `keyGenerator: (req) => ...` to the options.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| All clients get 429 at once | They share one address (`req.remoteAddress` in the request log). Set `TRUST_PROXY` to the proxy's address |
| A 429 arrives as a 500 | `errorResponseBuilder` returns an object without `statusCode` |
| A route is never limited | Registered before the plugin, or has `rateLimit: false` |
| Tests in other files get 429 | `test/setup.ts` does not lift the limit (step 6) |
| `The dependency '@fastify/sensible' of plugin 'rate-limit' is not registered` | Plugin registered before `sensible` |
| `Not found handler already set for Fastify instance with prefix: '/'` | The project has its own not-found handler (step 3) |
