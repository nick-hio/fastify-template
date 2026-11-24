---
name: add-mcp-server
description: Steps for adding an MCP (Model Context Protocol) server with the MCP TypeScript SDK, covering the protocol versions, installation, tools, the host allowlist, authentication and tests. Use this when asked to expose the API to AI clients over MCP, to add an `/mcp` endpoint, to add or change an MCP tool, or when an MCP client fails with `Unsupported protocol version`.
---

# Add an MCP server

Add `POST /mcp`, where AI clients call your tools. The template does not ship with it.

## Protocol versions

MCP has two kinds of revision. Many clients still speak only the older kind.

| Revision | How a client talks to it | Example client (November 2026) |
| --- | --- | --- |
| `2026-07-28` | No handshake. Every request names its version and client in `params._meta` and in headers | Claude Code |
| `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05` | `initialize` first, then `notifications/initialized`, then the calls | Codex (`2025-06-18`) |

There are two ways to mount the endpoint:

- **Both kinds (default).** Your own plugin around the SDK's `createMcpHandler`, with `legacy: "stateless"`. See [Serve both kinds of revision](#serve-both-kinds-of-revision).
- **`2026-07-28` only.** The [fastify-mcp-server](https://github.com/flaviodelgrosso/fastify-mcp-server) plugin. Version 1.x hard-codes `legacy: "reject"` and has no option to change it. A 2025 client then fails to start with `-32022: Unsupported protocol version: 2025-06-18`.

Serve both unless the task says that every client speaks `2026-07-28`. Neither way keeps a session: every request gets a fresh server from `createMcpServer()`.

## Steps

1. **Install the MCP SDK.**

    ```bash
    # both kinds of revision
    bun add @modelcontextprotocol/server @modelcontextprotocol/node

    # 2026-07-28 only
    bun add fastify-mcp-server @modelcontextprotocol/server
    ```

    `bunfig.toml` holds back releases younger than 3 days. Read the installed version's options in `node_modules/@modelcontextprotocol/server/dist/*.d.mts` (and `node_modules/fastify-mcp-server/dist/types.d.ts`), not on GitHub.

2. **Add the tool helpers** in `src/mcp/utils.ts`:

    ```ts
    import type { CallToolResult } from "@modelcontextprotocol/server";
    import type { FastifyBaseLogger } from "fastify";
    import { safeAwait } from "@/utils";

    /** The result of a tool call that failed for a reason the client can act on. */
    export const toolError = (message: string): CallToolResult => ({
        content: [{ type: "text", text: message }],
        isError: true,
    });

    /**
     * Runs the body of a tool handler. Logs an unexpected error and returns a generic message,
     * because the SDK would otherwise send the error's own message to the client.
     */
    export const runTool = async (log: FastifyBaseLogger, run: () => Promise<CallToolResult>): Promise<CallToolResult> => {
        const [error, result] = await safeAwait(run());

        if (error) {
            log.error({ err: error }, "MCP tool failed");
            return toolError("Internal Server Error");
        }

        return result;
    };
    ```

    `src/plugins/error-handler.ts` does not cover tools. Only `runTool` hides internal details, such as database errors, from the client.

3. **Write the tools.** Use one file per resource in `src/mcp/tools/`, named like the files in `src/routes/`. Example `src/mcp/tools/example.ts`:

    ```ts
    import type { McpServer } from "@modelcontextprotocol/server";
    import { eq } from "drizzle-orm";
    import type { FastifyBaseLogger } from "fastify";
    import { db } from "@/db";
    import { kvCreateSchema, kvSchema, kvTable } from "@/db/schema/kv";
    import { runTool, toolError } from "@/mcp/utils";

    export const registerExampleTools = (mcp: McpServer, log: FastifyBaseLogger) => {
        mcp.registerTool(
            "get-entry",
            {
                description: "Return the entry stored under a key.",
                inputSchema: kvCreateSchema.pick({ key: true }),
                outputSchema: kvSchema,
            },
            ({ key }) =>
                runTool(log, async () => {
                    const [entry] = await db.select().from(kvTable).where(eq(kvTable.key, key)).limit(1);

                    if (!entry) {
                        return toolError("Entry Not Found");
                    }

                    return { content: [{ type: "text", text: JSON.stringify(entry) }], structuredContent: entry };
                }),
        );
    };
    ```

    - **Reuse the Zod schemas** from `src/db/schema/`. The SDK validates arguments against `inputSchema` before the handler runs.
    - **Wrap every handler** in `runTool`. Return `toolError("...")` for a failure the client can act on.
    - **With `outputSchema`**, return a matching `structuredContent`. Repeat it as text in `content` for clients that read only that.
    - **Describe the tool.** The model picks tools by `description`. Say what the tool does and returns.

4. **Create the server factory** in `src/mcp/index.ts`. Register each tool file there:

    ```ts
    import { McpServer } from "@modelcontextprotocol/server";
    import type { FastifyBaseLogger } from "fastify";
    import { registerExampleTools } from "@/mcp/tools/example";

    /**
     * Builds the MCP server. The plugin calls this once per request and keeps nothing between
     * requests, so only register tools here and leave the work to their handlers.
     */
    export const createMcpServer = (log: FastifyBaseLogger) => {
        const mcp = new McpServer({ name: "my-api", version: "1.0.0" });

        registerExampleTools(mcp, log);

        return mcp;
    };
    ```

5. **Add the host allowlist** to `src/env.ts`:

    ```ts
    /** Hostnames, without a port, that the MCP endpoint accepts in the `Host` header. Unset means localhost only. */
    MCP_ALLOWED_HOSTS: z
        .string()
        .transform((value) => value.split(",").map((host) => host.trim()))
        .optional(),
    ```

    - **403** unless the `Host` header is on the list.
    - **Default list:** `localhost`, `127.0.0.1` and `[::1]`. Setting the variable replaces it.
    - **Deployed server:** add its public hostname, for example `MCP_ALLOWED_HOSTS="api.example.com"`.
    - **Config files:** add it to `.env.example` as `MCP_ALLOWED_HOSTS="localhost,127.0.0.1,[::1]"`, to the `README.md` table, and to `compose.yml` as `MCP_ALLOWED_HOSTS: ${MCP_ALLOWED_HOSTS:-}`.

6. **Register the endpoint** in `src/server.ts`, with the other plugins and before the routes.

    Both kinds of revision: write `src/plugins/mcp.ts` from [Serve both kinds of revision](#serve-both-kinds-of-revision), then:

    ```ts
    import { createMcpServer } from "@/mcp";
    import mcp from "@/plugins/mcp";

    await fastify.register(mcp, {
        createMcpServer: () => createMcpServer(fastify.log),
        allowedHosts: env.MCP_ALLOWED_HOSTS,
    });
    ```

    `2026-07-28` only:

    ```ts
    import mcp from "fastify-mcp-server";
    import { createMcpServer } from "@/mcp";

    await fastify.register(mcp, {
        transport: "http",
        createMcpServer: () => createMcpServer(fastify.log),
        allowedHosts: env.MCP_ALLOWED_HOSTS,
        // the request log shows every call as `POST /mcp`, this adds the method and the tool name
        onRequestComplete: (event) => fastify.log.info(event, "MCP request completed"),
    });
    ```

    `transport` is required from 1.1.0. On 1.0.x, leave it out, or the typecheck fails with `'transport' does not exist`.

7. **Decide who may call the endpoint.** Without a verifier, anyone who reaches the server can call every tool. If the task does not name the clients, ask before exposing a tool that changes data. See [Authentication](#authentication).

8. **Test it.** Add this helper to `test/helpers.ts`:

    ```ts
    import {
        CLIENT_CAPABILITIES_META_KEY,
        CLIENT_INFO_META_KEY,
        PROTOCOL_VERSION_META_KEY,
    } from "@modelcontextprotocol/server";

    const MCP_PROTOCOL_VERSION = "2026-07-28";

    /**
     * Sends one MCP request to `/mcp` and returns the JSON-RPC `result`.
     * There is no session, so every request names its protocol version and client.
     */
    export const mcpRequest = async <T>(server: Server, method: string, params: Record<string, unknown> = {}) => {
        const response = await server.inject({
            method: "POST",
            url: "/mcp",
            headers: {
                "mcp-protocol-version": MCP_PROTOCOL_VERSION,
                "mcp-method": method,
                // a `tools/call` request must repeat the tool name in this header
                ...(typeof params.name === "string" && { "mcp-name": params.name }),
            },
            payload: {
                jsonrpc: "2.0",
                id: 1,
                method,
                params: {
                    ...params,
                    _meta: {
                        [PROTOCOL_VERSION_META_KEY]: MCP_PROTOCOL_VERSION,
                        [CLIENT_INFO_META_KEY]: { name: "test", version: "0.0.0" },
                        [CLIENT_CAPABILITIES_META_KEY]: {},
                    },
                },
            },
        });

        return response.json<{ result: T }>().result;
    };
    ```

    Cover each tool in `test/mcp.test.ts`, with a `describe` block set up like `test/example.test.ts`:

    - the success case
    - each `toolError`
    - one call with invalid arguments. The SDK returns `isError: true` with a text that starts `Input validation error`.

    ```ts
    import type { CallToolResult, ListToolsResult } from "@modelcontextprotocol/server";

    test("lists the tools", async () => {
        const { tools } = await mcpRequest<ListToolsResult>(server(), "tools/list");
        expect(tools.map((tool) => tool.name)).toEqual(["get-entry"]);
    });

    test("get-entry reports a key that does not exist", async () => {
        const result = await mcpRequest<CallToolResult>(server(), "tools/call", {
            name: "get-entry",
            arguments: { key: "DOES_NOT_EXIST" },
        });
        expect(result.isError).toBe(true);
        expect(result.content).toEqual([{ type: "text", text: "Entry Not Found" }]);
    });
    ```

    When you serve both kinds of revision, also test a 2025 client. Add this helper to `test/helpers.ts`:

    ```ts
    /**
     * Sends one MCP request the way a 2025 client does: no `_meta`, and `initialize` before the calls.
     * Returns the HTTP status and the JSON-RPC message, which the SDK can send as one SSE event.
     */
    export const legacyMcpRequest = async (server: Server, body: Record<string, unknown>) => {
        const response = await server.inject({
            method: "POST",
            url: "/mcp",
            headers: {
                // a 2025 client must accept both, or it gets a 406
                accept: "application/json, text/event-stream",
                // after `initialize`, the client sends the version that the server agreed to
                ...(body.method !== "initialize" && { "mcp-protocol-version": "2025-06-18" }),
            },
            payload: { jsonrpc: "2.0", ...body },
        });
        const data = response.body.match(/^data: (.*)$/m)?.[1] ?? response.body;

        return { statusCode: response.statusCode, message: data ? JSON.parse(data) : undefined };
    };
    ```

    ```ts
    test("a 2025 client can initialize, then list the tools", async () => {
        const init = await legacyMcpRequest(server(), {
            id: 1,
            method: "initialize",
            params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0.0.0" } },
        });
        expect(init.statusCode).toBe(200);
        expect(init.message.result.protocolVersion).toBe("2025-06-18");

        const initialized = await legacyMcpRequest(server(), { method: "notifications/initialized" });
        expect(initialized.statusCode).toBe(202);

        const list = await legacyMcpRequest(server(), { id: 2, method: "tools/list" });
        expect(list.statusCode).toBe(200);
        expect(list.message.result.tools.map((tool: { name: string }) => tool.name)).toEqual(["get-entry"]);
    });
    ```

9. **Update the documentation.**
    - `README.md`: add `POST /mcp` to the API table. Name the MCP revisions it serves.
    - `AGENTS.md` layout: add `mcp/`. Name `mcpRequest()` (and `legacyMcpRequest()`) on the `test/helpers.ts` line.

10. **Verify** with `bun run check`. To test by hand, run `bun run dev` and send a `2026-07-28` request:

    ```bash
    curl http://127.0.0.1:3000/mcp \
        -H 'content-type: application/json' \
        -H 'mcp-protocol-version: 2026-07-28' \
        -H 'mcp-method: tools/list' \
        -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}'
    ```

    When you serve both kinds, also send a 2025 `initialize`. The answer is one SSE event with `"protocolVersion":"2025-06-18"`:

    ```bash
    curl http://127.0.0.1:3000/mcp \
        -H 'content-type: application/json' \
        -H 'accept: application/json, text/event-stream' \
        -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
    ```

    The Docker image needs no change, because all new code is in `src/`.

## Serve both kinds of revision

`src/plugins/mcp.ts` mounts the SDK handler on a Fastify route. It does the checks that `fastify-mcp-server` would do: `Host`, `Origin` and the bearer token.

```ts
import { toNodeHandler } from "@modelcontextprotocol/node";
import {
    bearerAuthChallengeResponse,
    createMcpHandler,
    localhostAllowedHostnames,
    localhostAllowedOrigins,
    type McpServerFactory,
    type OAuthTokenVerifier,
    validateHostHeader,
    validateOriginHeader,
    verifyBearerToken,
} from "@modelcontextprotocol/server";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { safeAwait } from "@/utils";

export interface McpOptions {
    /** Builds the MCP server. Called once per request. */
    createMcpServer: McpServerFactory;
    /** Hostnames allowed in the `Host` header. Defaults to localhost. */
    allowedHosts?: string[];
    /** Hostnames of the browser origins allowed in the `Origin` header. Defaults to localhost. */
    allowedOrigins?: string[];
    /** Checks the bearer token. Without it, every request is accepted. */
    verifier?: OAuthTokenVerifier;
}

/** The JSON-RPC method of a request body. 2025 clients do not send the `Mcp-Method` header. */
const bodyMethod = (body: unknown) => {
    return body && typeof body === "object" && "method" in body && typeof body.method === "string"
        ? body.method
        : undefined;
};

/**
 * `POST /mcp` for MCP `2026-07-28` and the 2025 revisions.
 * A 2025 request gets a fresh server and no session, like a `2026-07-28` request.
 */
const mcp: FastifyPluginAsync<McpOptions> = async (fastify, options) => {
    const handler = createMcpHandler(options.createMcpServer, { legacy: "stateless" });
    const nodeHandler = toNodeHandler(handler);

    fastify.addHook("onClose", async () => {
        await handler.close();
    });

    fastify.all("/mcp", {
        onRequest: async (req, reply) => {
            const checks = [
                validateHostHeader(req.headers.host, options.allowedHosts ?? localhostAllowedHostnames()),
                validateOriginHeader(req.headers.origin, options.allowedOrigins ?? localhostAllowedOrigins()),
            ];

            for (const check of checks) {
                if (!check.ok) {
                    return reply
                        .status(403)
                        .send({ jsonrpc: "2.0", error: { code: -32600, message: check.message }, id: null });
                }
            }
        },
        preHandler: async (req, reply) => {
            if (!options.verifier) {
                return;
            }

            const [error, auth] = await safeAwait(
                verifyBearerToken(req.headers.authorization, { verifier: options.verifier }),
            );

            if (error) {
                const response = bearerAuthChallengeResponse(error, {});
                return reply
                    .status(response.status)
                    .headers(Object.fromEntries(response.headers))
                    .send(await response.json());
            }

            // the SDK reads the token from `req.raw.auth` and passes it to tool handlers as `ctx.http.authInfo`
            Object.assign(req.raw, { auth });
        },
        handler: async (req, reply) => {
            const startedAt = performance.now();

            // the SDK writes the response, Fastify must not
            reply.hijack();

            try {
                await nodeHandler(req.raw, reply.raw, req.body);
            } finally {
                // the request log shows every call as `POST /mcp`, this adds the method and the tool name
                req.log.info(
                    {
                        method: req.headers["mcp-method"]?.toString() ?? bodyMethod(req.body),
                        name: req.headers["mcp-name"]?.toString(),
                        protocolVersion: req.headers["mcp-protocol-version"]?.toString(),
                        durationMs: performance.now() - startedAt,
                        statusCode: reply.raw.statusCode,
                    },
                    "MCP request completed",
                );
            }
        },
    });
};

export default fp(mcp, { name: "mcp" });
```

- **No session for 2025 clients.** Each request, `initialize` too, gets a fresh server. `GET` and `DELETE` (the 2025 session operations) get 405. Keep tools free of state between calls.
- **Tool code is the same** for both kinds. The SDK translates. `ctx.http?.authInfo` works for both.
- **A 2025 answer can be SSE:** `event: message` and one `data:` line. The client must accept both `application/json` and `text/event-stream`, or it gets a 406. Real clients do this.
- **To drop 2025 support later,** change `legacy: "stateless"` to `legacy: "reject"`.

## Authentication

Pass the verifier to the endpoint:

- Both kinds of revision: `verifier` option of `src/plugins/mcp.ts`.
- `2026-07-28` only: `authorization: { bearer: { verifier } }`.

A request then needs `Authorization: Bearer <token>` with a token the verifier accepts, or it gets a 401.

For one shared secret, add `MCP_TOKEN: z.string().min(32)` to `src/env.ts`. Write the verifier in `src/mcp/auth.ts`:

```ts
import { createHash, timingSafeEqual } from "node:crypto";
import { OAuthError, OAuthErrorCode, type OAuthTokenVerifier } from "@modelcontextprotocol/server";
import { env } from "@/env";

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Accepts the one shared token from `MCP_TOKEN`. */
export const verifier: OAuthTokenVerifier = {
    verifyAccessToken: async (token) => {
        // constant-time digest compare, so response time does not reveal how much of the token matched
        if (!timingSafeEqual(digest(token), digest(env.MCP_TOKEN))) {
            throw new OAuthError(OAuthErrorCode.InvalidToken, "Invalid token");
        }

        // the SDK refuses a token without an expiry, and a shared token has none of its own
        return { token, clientId: "shared-token", scopes: [], expiresAt: Math.floor(Date.now() / 1000) + 60 };
    },
};
```

- **No default.** Without `MCP_TOKEN`, nothing that reads the environment starts: the server, `bun run db:generate`, `bun run db:studio` and `bun run db:backup`.
- **Config files:** set a value in `.env.example` and under `env` of the `docker` job in `.github/workflows/ci.yml`. Add a `README.md` table row. Add `MCP_TOKEN: ${MCP_TOKEN:-}` to `compose.yml`.
- **"Every variable is optional"** is now false. Fix that sentence in `README.md` and at the top of `.env.example`.
- **Test setup:** set `process.env.MCP_TOKEN` in `test/setup.ts`. Child processes do not get it: also add `MCP_TOKEN: env.MCP_TOKEN` next to `NODE_ENV` in `childEnv` of `test/helpers.ts`, or every test that starts a process fails.
- **`mcpRequest`** (and `legacyMcpRequest`) must send the header ``authorization: `Bearer ${env.MCP_TOKEN}` ``.
- **Test** a request with no token and one with a wrong token. Both get a 401.
- **Each `curl`** from step 10 needs `-H "authorization: Bearer $MCP_TOKEN"`.
- **OAuth provider:** verify its token in `verifyAccessToken`. Return the real client, scopes and expiry.
- **Caller identity:** read `ctx.http?.authInfo`. `ctx` is the handler's last argument: `(args, ctx) => ...`, or `(ctx) => ...` without `inputSchema`.

## Adding a tool later

Add it to the matching file in `src/mcp/tools/`. Register any new file in `src/mcp/index.ts`. Add tests and run `bun run check`. Resources and prompts go in the same place, with `mcp.registerResource` and `mcp.registerPrompt`.

## How the endpoint differs from a route

- **JSON-RPC bodies**, not `{ statusCode, error, message }`. Rejected tokens get the OAuth body `{ error, error_description }`. Only requests that fail before the plugin (invalid JSON, body too large) get the usual error body.
- **Failed tool calls are HTTP 200**, with `isError: true`. Unknown tools are also 200, with a JSON-RPC `error` and no `result`.
- **No `REQUEST_TIMEOUT_MS`.** Slow tool calls never get a 503. Give slow work its own time limit.
- **Only `POST`.** Other methods on `/mcp` get a 405.
- **The request log** shows every call as `POST /mcp`. One more line, `MCP request completed`, adds the method and the tool name. See step 6.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| 403 `Invalid Host: <name>` | Hostname not in `MCP_ALLOWED_HOSTS`. Behind a proxy, allow the `Host` value it forwards |
| 403 `Invalid Origin: <name>` | Browser client on another site. Add its hostname to plugin option `allowedOrigins` |
| `-32022: Unsupported protocol version: 2025-…` (HTTP 400), client fails at startup | Client speaks a 2025 revision and the endpoint serves `2026-07-28` only. See [Serve both kinds of revision](#serve-both-kinds-of-revision) |
| 406 `Client must accept both application/json and text/event-stream` | 2025 request without that `Accept` header |
| 405 on `GET` or `DELETE` | 2025 client wants a session. Sessions are not served, see [Serve both kinds of revision](#serve-both-kinds-of-revision) |
| 400 `the request headers and body disagree` | `2026-07-28` request with the `MCP-Protocol-Version`, `Mcp-Method` or (tool calls) `Mcp-Name` header missing or not matching the body |
| 401 `Token has no expiration time` | Verifier returned no `expiresAt` |
| `Output validation error` in a tool result | `structuredContent` missing or not matching `outputSchema` |
| Typecheck fails on `transport` | Option does not match the installed version, see step 6 |
