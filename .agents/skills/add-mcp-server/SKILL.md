---
name: add-mcp-server
description: Steps for adding an MCP (Model Context Protocol) server with fastify-mcp-server, covering installation, tools, the host allowlist, authentication and tests. Use this when asked to expose the API to AI clients over MCP, to add an `/mcp` endpoint, or to add or change an MCP tool.
---

# Add an MCP server

[fastify-mcp-server](https://github.com/flaviodelgrosso/fastify-mcp-server) adds `POST /mcp`, where AI clients call your tools. The template does not ship with it.

- **MCP revision `2026-07-28` only.** Clients on an older revision get a 400.
- **No session** and no `initialize` handshake. Every request stands alone.

## Steps

1. **Install the plugin and the MCP SDK.**

    ```bash
    bun add fastify-mcp-server @modelcontextprotocol/server
    ```

    `bunfig.toml` holds back releases younger than 3 days. Read the installed version's options in `node_modules/fastify-mcp-server/README.md` and `node_modules/fastify-mcp-server/dist/types.d.ts`, not on GitHub.

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

6. **Register the plugin** in `src/server.ts`, with the other plugins and before the routes:

    ```ts
    import mcp from "fastify-mcp-server";
    import { createMcpServer } from "@/mcp";

    await fastify.register(mcp, {
        transport: "http",
        createMcpServer: () => createMcpServer(fastify.log),
        allowedHosts: env.MCP_ALLOWED_HOSTS,
    });
    ```

    `transport` is required from 1.1.0. On 1.0.x, leave it out, or the typecheck fails with `'transport' does not exist`.

7. **Decide who may call the endpoint.** Without `authorization`, anyone who reaches the server can call every tool. If the task does not name the clients, ask before exposing a tool that changes data. See [Authentication](#authentication).

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

9. **Update the documentation.**
    - `README.md`: add `POST /mcp` to the API table.
    - `AGENTS.md` layout: add `mcp/`. Name `mcpRequest()` on the `test/helpers.ts` line.

10. **Verify** with `bun run check`. To test by hand, run `bun run dev` and send:

    ```bash
    curl http://127.0.0.1:3000/mcp \
        -H 'content-type: application/json' \
        -H 'mcp-protocol-version: 2026-07-28' \
        -H 'mcp-method: tools/list' \
        -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}'
    ```

    The Docker image needs no change, because all new code is in `src/`.

## Authentication

Pass `authorization: { bearer: { verifier } }` to the plugin. A request then needs `Authorization: Bearer <token>` with a token the verifier accepts, or it gets a 401.

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
- **`mcpRequest`** must send the header ``authorization: `Bearer ${env.MCP_TOKEN}` ``.
- **Test** a request with no token and one with a wrong token. Both get a 401.
- **`curl`** from step 10 needs `-H "authorization: Bearer $MCP_TOKEN"`.
- **OAuth provider:** verify its token in `verifyAccessToken`. Return the real client, scopes and expiry.
- **Caller identity:** read `ctx.http?.authInfo`. `ctx` is the handler's last argument: `(args, ctx) => ...`, or `(ctx) => ...` without `inputSchema`.

## Adding a tool later

Add it to the matching file in `src/mcp/tools/`. Register any new file in `src/mcp/index.ts`. Add tests and run `bun run check`. Resources and prompts go in the same place, with `mcp.registerResource` and `mcp.registerPrompt`.

## How the endpoint differs from a route

- **JSON-RPC bodies**, not `{ statusCode, error, message }`. Rejected tokens get the OAuth body `{ error, error_description }`. Only requests that fail before the plugin (invalid JSON, body too large) get the usual error body.
- **Failed tool calls are HTTP 200**, with `isError: true`. Unknown tools are also 200, with a JSON-RPC `error` and no `result`.
- **No `REQUEST_TIMEOUT_MS`.** Slow tool calls never get a 503. Give slow work its own time limit.
- **Only `POST`.** Other methods on `/mcp` get a 405.
- **The request log** shows every call as `POST /mcp`. For method and tool name, pass `onRequestComplete: (event) => fastify.log.info(event, "MCP request completed")` to the plugin.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| 403 `Invalid Host: <name>` | Hostname not in `MCP_ALLOWED_HOSTS`. Behind a proxy, allow the `Host` value it forwards |
| 403 `Invalid Origin: <name>` | Browser client on another site. Add its hostname to plugin option `allowedOrigins` |
| 400 `Unsupported protocol version` | Client speaks an older MCP revision |
| 400 `the request headers and body disagree` | `MCP-Protocol-Version`, `Mcp-Method` or (tool calls) `Mcp-Name` header missing or not matching the body |
| 401 `Token has no expiration time` | Verifier returned no `expiresAt` |
| `Output validation error` in a tool result | `structuredContent` missing or not matching `outputSchema` |
| Typecheck fails on `transport` | Option does not match the installed version, see step 6 |
