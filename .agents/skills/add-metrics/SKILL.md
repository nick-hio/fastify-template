---
name: add-metrics
description: Steps for exposing Prometheus metrics from this Fastify server with a plugin built on @prometheus-io/client, covering request metrics, the token-protected `/metrics` endpoint, metrics of your own and tests. Use this when asked to add metrics, monitoring or a `/metrics` endpoint, to connect Prometheus or Grafana, or to add or change a metric.
---

# Add Prometheus metrics

A plugin of the project's own collects process and request metrics with [@prometheus-io/client](https://github.com/prometheus/client_js) and serves them on `GET /metrics`, where a Prometheus server reads them. The template does not ship with it.

- Use `@prometheus-io/client`. It replaces `prom-client`, which is deprecated. Most documentation still names `prom-client`, and `bun add prom-client` installs it without a warning. The classes have the same names.
- Do not use `fastify-metrics`. By default it keeps all metrics in one registry per process, so the second server of a test run fails to start, and it serves `/metrics` to anyone.

The endpoint is closed until it is configured: it exists only while `METRICS_TOKEN` is set, and it answers only a request that sends that token. Metrics name every route and show traffic, memory use and the runtime version, so they are not for the public.

## Steps

1. **Install the client.** The code below is written for version 0.16.

    ```bash
    bun add @prometheus-io/client
    ```

2. **Add the token** to `src/env.ts`:

    ```ts
    /** The bearer token a scraper sends to `GET /metrics`. While it is unset, the endpoint does not exist. */
    METRICS_TOKEN: z.string().min(32, "Must be at least 32 characters").optional(),
    ```

    Add it to `.env.example` as `METRICS_TOKEN=""`, to `compose.yml` as `METRICS_TOKEN: ${METRICS_TOKEN:-}` and to the table in `README.md`, and add `GET /metrics` to the API table there. An empty value reads as unset. `openssl rand -hex 32` prints a token. Never commit a real one.

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
            // One registry per server. The library's global registry would refuse the metrics of a second server
            // in the same process, and the tests build several.
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
                // The pattern the route was registered with, such as `/example/:id`, and one fixed label for a request
                // that matched no route. `req.url` is client input and would add a series for every URL anyone tries.
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

    - The buckets are the defaults of the library, 5 ms to 10 s, written out so that they are easy to change. Add a boundary at each response time the project has to meet, because a quantile is only as exact as the buckets around it. Every bucket is one more series for each combination of method, route and status code.
    - The route has no `schema`. Its response is text, which Fastify sends as it is, and a `headers` schema would answer a missing token with 400 instead of 401.

4. **Register the plugin** in `src/server.ts`, after `sensible` and before the routes, because route files read `fastify.metrics` while they are registered:

    ```ts
    import metrics from "@/plugins/metrics";

    await fastify.register(metrics);
    ```

    If the project builds an OpenAPI document, as [add-openapi](../add-openapi/SKILL.md) describes, register this plugin before that one. `/metrics` then stays out of the document.

5. **Test it** in `test/metrics.test.ts`. Give the test run a token in `test/setup.ts`:

    ```ts
    process.env.METRICS_TOKEN = "test-metrics-token-0123456789abcdef";
    ```

    A test reads the token from `env`, and resets the metrics before each test:

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
            // Any route with a path parameter serves here. Point this at one of your own once the example is gone.
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

    Also cover a scrape with the token (200, `text/plain; version=0.0.4; charset=utf-8`), a request without a token and one with a wrong token (401), a request that matches no route (`route="unmatched"`), that a scrape leaves no `route="/metrics"` series behind, and that a second `buildServer()` in the same process starts without the counts of the first. Add `["METRICS_TOKEN", "too-short"]` to the refused values in `test/env.test.ts`.

6. **Verify** with `bun run check`. The Docker image needs no change, because everything new lives in `src/`. To read the metrics by hand, start the server with a token and send it:

    ```bash
    METRICS_TOKEN=local-metrics-token-0123456789abcdef bun run dev
    curl -H 'authorization: Bearer local-metrics-token-0123456789abcdef' http://127.0.0.1:3000/metrics
    ```

7. **Hand over the scrape configuration.** Whoever runs Prometheus adds a job like this one and puts the token in the file it names. The token is all that protects the endpoint and every scrape sends it, so scrape over HTTPS or a private network.

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

Import the metric class from `@prometheus-io/client` and create the metric where its route plugin starts, in the registry of the server. Then update it in a handler, here with `entriesCreated.inc()` once the entry is stored:

```ts
const route: FastifyPluginAsyncZod = async (fastify) => {
    const entriesCreated = new Counter({
        name: "kv_entries_created_total",
        help: "Number of entries created.",
        registers: [fastify.metrics],
    });
```

- Pass `registers: [fastify.metrics]` every time. Without it the metric lands in the library's global registry: it is missing from `/metrics`, and the second server of a test run fails to start.
- Create a metric once, while the plugin is registered. Creating it in a handler throws on the second request. `fastify.metrics` also exists while `METRICS_TOKEN` is unset, so this code needs no check.
- Name a metric in snake_case with its unit, and end a counter in `_total`. Declare its labels in `labelNames`. Only use a label with a small, fixed set of values, never an id, a key or anything else a client sends: every new value is a new series.
- For a value that is read instead of counted, such as the number of rows in a table, create a `Gauge` with a `collect()` function that calls `this.set(...)`. The library runs it on every scrape.
- To test it, call `server().metrics.resetMetrics()`, send the requests, and read the metric with `await server().metrics.getSingleMetricAsString("kv_entries_created_total")`. The result ends with the line `kv_entries_created_total 1`.

## Under Bun

`collectDefaultMetrics` runs without an error under Bun 1.4, but some default metrics read Node.js APIs that Bun only stubs. The plugin removes those, because a constant zero looks like a healthy value on a dashboard.

| Metric | Under Bun 1.4 |
| --- | --- |
| `nodejs_eventloop_utilization_*`, `nodejs_active_handles*`, `nodejs_active_requests*`, `nodejs_active_resources*` | Removed: always 0 or empty |
| `nodejs_gc_duration_seconds` | Removed: never has a sample |
| `nodejs_heap_space_size_*` | Removed: only `space="old"` has a value |
| `nodejs_eventloop_lag_*` | Work. All but `nodejs_eventloop_lag_seconds` leave out the 10 ms sampling interval that Node.js includes, so a threshold taken from a Node.js dashboard is 10 ms too high |
| `nodejs_heap_size_total_bytes` | Can be lower than `nodejs_heap_size_used_bytes`. Watch `process_resident_memory_bytes` instead |
| `nodejs_version_info` | The Node.js version that Bun emulates, not the version of Bun |

The `process_*` metrics work: CPU time, memory, open file descriptors and start time. The library reports the file descriptors, and all memory except `process_resident_memory_bytes`, on Linux only, so do not expect them in a test.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `A metric with the name <name> has already been registered` in every test file after the first | A metric was created without `registers: [fastify.metrics]`, or two metrics share a name |
| A metric of your own is missing from `/metrics` | It was created without `registers: [fastify.metrics]` |
| `TypeError: undefined is not an object (evaluating 'register.registerMetric')` at startup | The plugin is registered after the routes, see step 4 |
| `/metrics` answers 404 | `METRICS_TOKEN` is unset or empty. In a test, the line in `test/setup.ts` is missing, or the server was started with `useProcess()`, which only has the token when the test passes it |
| `Added label "<name>" is not included in initial labelset` | The label is missing from the `labelNames` of the metric |
| A count in a test is higher than expected | One server answers all tests of a `describe` block. Call `server().metrics.resetMetrics()` in `beforeEach` |
