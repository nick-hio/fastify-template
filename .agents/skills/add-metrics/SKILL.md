---
name: add-metrics
description: Steps for exposing Prometheus metrics from this Fastify server with @prometheus-io/client, covering request metrics, the token-protected `/metrics` endpoint, custom metrics and tests. Use this when asked to add metrics, monitoring or a `/metrics` endpoint, to connect Prometheus or Grafana, or to add or change a metric.
---

# Add Prometheus metrics

A plugin collects process and request metrics with [@prometheus-io/client](https://github.com/prometheus/client_js) and serves them on `GET /metrics` for Prometheus to read. The template does not ship with it.

- **Use `@prometheus-io/client`**, not the deprecated `prom-client`. Most docs still name `prom-client`, and `bun add prom-client` gives no warning. The class names match.
- **Not `fastify-metrics`.** Its default per-process registry makes the second server of a test run fail to start. It also serves `/metrics` to anyone.
- **The endpoint is private.** It exists only while `METRICS_TOKEN` is set, and answers only requests with that token. Metrics expose every route, traffic, memory use and the runtime version.

## Steps

1. **Install the client.** The code below is for version 0.16.

    ```bash
    bun add @prometheus-io/client
    ```

2. **Add the token** to `src/env.ts`:

    ```ts
    /** The bearer token a scraper sends to `GET /metrics`. While it is unset, the endpoint does not exist. */
    METRICS_TOKEN: z.string().min(32, "Must be at least 32 characters").optional(),
    ```

    - Add it to `.env.example` (`METRICS_TOKEN=""`), `compose.yml` (`METRICS_TOKEN: ${METRICS_TOKEN:-}`) and the variables table in `README.md`. Add `GET /metrics` to the API table there.
    - An empty value counts as unset.
    - `openssl rand -hex 32` prints a token. Never commit a real one.

3. **Create the plugin** in `src/plugins/metrics.ts`:

    ```ts
    import { createHash, timingSafeEqual } from "node:crypto";
    import { Counter, collectDefaultMetrics, Histogram, Registry } from "@prometheus-io/client";
    import fp from "fastify-plugin";
    import { env } from "@/env";

    declare module "fastify" {
        interface FastifyInstance {
            /** The metrics of this server. Create a metric of your own with `registers: [fastify.metrics]`. */
            metrics: Registry;
        }
    }

    const ENDPOINT = "/metrics";

    /** Default metrics that are always zero, empty or a copy of another metric, because Bun lacks the API they read. */
    const UNSUPPORTED_BY_BUN = /^nodejs_(eventloop_utilization|active_|gc_duration|heap_space_size)/;

    const digest = (value: string) => createHash("sha256").update(value).digest();

    /**
     * Collects Prometheus metrics and serves them on `GET /metrics` to a scraper that sends `METRICS_TOKEN`.
     * While the token is unset, nothing is collected and the endpoint does not exist.
     */
    export default fp(
        async (fastify) => {
            // One registry per server: the global registry refuses a second server's metrics, and tests build several.
            const registry = new Registry();
            fastify.decorate("metrics", registry);

            if (!env.METRICS_TOKEN) {
                return;
            }

            collectDefaultMetrics({ register: registry });
            for (const { name } of registry.getMetricsAsArray()) {
                if (UNSUPPORTED_BY_BUN.test(name)) {
                    registry.removeSingleMetric(name);
                }
            }

            const labelNames = ["method", "route", "status_code"] as const;
            const requests = new Counter({
                name: "http_requests_total",
                help: "Number of HTTP requests answered.",
                labelNames,
                registers: [registry],
            });
            const duration = new Histogram({
                name: "http_request_duration_seconds",
                help: "Time from receiving an HTTP request to sending its response.",
                labelNames,
                buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
                registers: [registry],
            });

            fastify.addHook("onResponse", async (req, reply) => {
                // The route pattern, such as `/example/:id`, or one fixed label when no route matched.
                // Not `req.url`: it is client input and would add a series for every URL anyone tries.
                const route = req.routeOptions.url ?? "unmatched";

                if (route !== ENDPOINT) {
                    const labels = { method: req.method, route, status_code: reply.statusCode };
                    requests.inc(labels);
                    duration.observe(labels, reply.elapsedTime / 1000);
                }
            });

            const expected = digest(env.METRICS_TOKEN);

            // A scraper polls this route, so `logLevel` keeps it out of the request log.
            fastify.get(ENDPOINT, { logLevel: "warn" }, async (req, reply) => {
                const token = /^Bearer (.+)$/i.exec(req.headers.authorization ?? "")?.[1] ?? "";

                // compare digests in constant time, so the response time does not reveal how much of the token matched
                if (!timingSafeEqual(digest(token), expected)) {
                    reply.header("www-authenticate", "Bearer");
                    throw fastify.httpErrors.unauthorized("Invalid Token");
                }

                return reply.type(registry.contentType).send(await registry.metrics());
            });
        },
        { name: "metrics", dependencies: ["@fastify/sensible"] },
    );
    ```

    - **Buckets** are the library defaults (5 ms to 10 s). Add a boundary at each response-time target: a quantile is only as exact as its nearby buckets. Each bucket adds a series per method, route and status code combination.
    - **No `schema`.** The response is text. A `headers` schema would answer a missing token with 400, not 401.

4. **Register the plugin** in `src/server.ts`, after `sensible` and before the routes. Route files read `fastify.metrics` at registration.

    ```ts
    import metrics from "@/plugins/metrics";

    await fastify.register(metrics);
    ```

    With [add-openapi](../add-openapi/SKILL.md), register this plugin first, so `/metrics` stays out of the document.

5. **Test it** in `test/metrics.test.ts`. Set a token in `test/setup.ts`:

    ```ts
    process.env.METRICS_TOKEN = "test-metrics-token-0123456789abcdef";
    ```

    Read the token from `env` and reset the metrics before each test:

    ```ts
    // `test/setup.ts` sets the token for the whole test run.
    const AUTHORIZATION = `Bearer ${env.METRICS_TOKEN}`;

    describe("/metrics", () => {
        const server = useServer();

        beforeEach(() => {
            // One server answers every test in this block, so the counts of earlier tests would add up.
            server().metrics.resetMetrics();
        });

        const scrape = (authorization = AUTHORIZATION) => {
            return server().inject({ method: "GET", url: "/metrics", headers: { authorization } });
        };

        test("labels a request with the pattern of its route, not with its URL", async () => {
            // Any route with a path parameter works. Use one of your own once the example is gone.
            await server().inject({ method: "GET", url: "/example/123" });

            const { body } = await scrape();
            expect(body).toContain('route="/example/:id"');
            expect(body).not.toContain("/example/123");
        });
    });

    describe("/metrics without METRICS_TOKEN", () => {
        const start = useProcess();

        test("does not exist", async () => {
            // a started server has the defaults of `src/env.ts`, not the token that `test/setup.ts` sets
            const server = await start();

            const response = await fetch(`${server.url}/metrics`, { headers: { authorization: AUTHORIZATION } });
            expect(response.status).toBe(404);
        });
    });
    ```

    Also cover:

    - Scrape with the token: 200, `text/plain; version=0.0.4; charset=utf-8`.
    - No token, wrong token: 401.
    - Unmatched route: `route="unmatched"`.
    - No `route="/metrics"` series after a scrape.
    - A second `buildServer()` in the same process does not start with the first one's counts.
    - Add `["METRICS_TOKEN", "too-short"]` to the refused values in `test/env.test.ts`.

6. **Verify** with `bun run check`. The Docker image needs no change (all new code is in `src/`). To scrape by hand:

    ```bash
    METRICS_TOKEN=local-metrics-token-0123456789abcdef bun run dev
    curl -H 'authorization: Bearer local-metrics-token-0123456789abcdef' http://127.0.0.1:3000/metrics
    ```

7. **Hand over the scrape configuration.** The Prometheus operator adds a job like this, with the token in `credentials_file`. The token is the only protection and every scrape sends it: use HTTPS or a private network.

    ```yaml
    scrape_configs:
      - job_name: my-api
        scheme: https
        authorization:
          type: Bearer
          credentials_file: /etc/prometheus/my-api.token
        static_configs:
          - targets: ["api.example.com"]
    ```

## Adding a metric of your own

Create the metric at the top of its route plugin, then update it in a handler (here `entriesCreated.inc()` after storing the entry). Import the class from `@prometheus-io/client`.

```ts
const route: FastifyPluginAsyncZod = async (fastify) => {
    const entriesCreated = new Counter({
        name: "kv_entries_created_total",
        help: "Number of entries created.",
        registers: [fastify.metrics],
    });
```

- **Always pass `registers: [fastify.metrics]`.** Otherwise the metric goes to the global registry: it is missing from `/metrics`, and the second server of a test run fails to start.
- **Create it once**, when the plugin registers. Creating it in a handler throws on the second request.
- **No token check needed.** `fastify.metrics` exists even without `METRICS_TOKEN`.
- **Names:** snake_case with the unit. Counters end in `_total`.
- **Labels:** declare them in `labelNames`. Use only small, fixed sets of values. Never an id, a key or other client input: each new value is a new series.
- **Read values**, such as a table's row count: use a `Gauge` with a `collect()` function that calls `this.set(...)`. It runs on every scrape.
- **Test:** call `server().metrics.resetMetrics()`, send requests, then read `await server().metrics.getSingleMetricAsString("kv_entries_created_total")`. It ends with the line `kv_entries_created_total 1`.

## Under Bun

Some default metrics read Node.js APIs that Bun 1.4 only stubs, with no error. The plugin removes them: a constant zero looks healthy on a dashboard.

| Metric | Under Bun 1.4 |
| --- | --- |
| `nodejs_eventloop_utilization_*`, `nodejs_active_handles*`, `nodejs_active_requests*`, `nodejs_active_resources*` | Removed: always 0 or empty |
| `nodejs_gc_duration_seconds` | Removed: no samples |
| `nodejs_heap_space_size_*` | Removed: only `space="old"` has a value |
| `nodejs_eventloop_lag_*` | Work, but all except `nodejs_eventloop_lag_seconds` omit the 10 ms sampling interval that Node.js includes. Node.js dashboard thresholds are 10 ms too high |
| `nodejs_heap_size_total_bytes` | Can be below `nodejs_heap_size_used_bytes`. Watch `process_resident_memory_bytes` instead |
| `nodejs_version_info` | The emulated Node.js version, not Bun's |

`process_*` metrics work (CPU time, memory, open file descriptors, start time). File descriptors and all memory except `process_resident_memory_bytes` are Linux-only, so do not expect them in a test.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `A metric with the name <name> has already been registered` in every test file after the first | Missing `registers: [fastify.metrics]`, or two metrics share a name |
| A custom metric is missing from `/metrics` | Missing `registers: [fastify.metrics]` |
| `TypeError: undefined is not an object (evaluating 'register.registerMetric')` at startup | Plugin registered after the routes. See step 4 |
| `/metrics` answers 404 | `METRICS_TOKEN` is unset or empty. In tests: the `test/setup.ts` line is missing, or `useProcess()` started the server without the token |
| `Added label "<name>" is not included in initial labelset` | Label missing from the metric's `labelNames` |
| A test count is too high | One server serves the whole `describe` block. Call `server().metrics.resetMetrics()` in `beforeEach` |
