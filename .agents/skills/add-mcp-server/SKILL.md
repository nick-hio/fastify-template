---
name: add-mcp-server
description: Steps for adding an MCP (Model Context Protocol) server to this Fastify server with the fastify-mcp-server plugin, covering installation, tools, the host allowlist, authentication and tests. Use this when asked to expose the API to AI clients over MCP, to add an `/mcp` endpoint, or to add or change an MCP tool.
---

# Add an MCP server

[fastify-mcp-server](https://github.com/flaviodelgrosso/fastify-mcp-server) mounts an MCP endpoint, `POST /mcp`, on the existing server. AI clients call the tools registered there. The template does not ship with it.

The plugin speaks MCP revision `2026-07-28` only. That revision has no session and no `initialize` handshake: every request stands alone. A client that only speaks an older revision is answered with a 400.

## Steps

1. **Install the plugin and the MCP SDK.**

    ```bash
    bun add fastify-mcp-server @modelcontextprotocol/server
    ```

    `bunfig.toml` holds back releases younger than 3 days, so the installed version can be older than the README on GitHub. Read the options of the version you got in `node_modules/fastify-mcp-server/README.md` and `node_modules/fastify-mcp-server/dist/types.d.ts`.

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
     * Runs the body of a tool handler. An unexpected error is logged and answered with a generic
     * message, because the SDK would otherwise send the error's own message to the client.
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

    The error handler in `src/plugins/error-handler.ts` does not cover tools. `runTool` is what keeps internal details, such as a database error, away from the client.

3. **Write the tools.** One file per resource in `src/mcp/tools/`, named after the resource, like the files in `src/routes/`. This one is `src/mcp/tools/example.ts`:

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

    - Reuse the Zod schemas from `src/db/schema/`. The SDK validates the arguments against `inputSchema` before the handler runs, so `key` is a validated string here.
    - Wrap the body of every handler in `runTool`, and return `toolError("...")` for a failure the client can act on.
    - A tool with an `outputSchema` must return a matching `structuredContent`. Also put the same data in `content` as text, for clients that only read that.
    - The model on the other end chooses a tool by its `description`. Say what the tool does and what it returns.

4. **Create the server factory** in `src/mcp/index.ts` and register each tool file there:

    ```ts
    import { McpServer } from "@modelcontextprotocol/server";
    import type { FastifyBaseLogger } from "fastify";
    import { registerExampleTools } from "@/mcp/tools/example";

    /**
     * Builds the MCP server. The plugin calls this once per request and keeps nothing
     * between requests, so only register tools here and leave the work to their handlers.
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

    The endpoint answers 403 unless the `Host` header of the request is on this list, and the default list is `localhost`, `127.0.0.1` and `[::1]`. A deployed server therefore needs its public hostname here, for example `MCP_ALLOWED_HOSTS="api.example.com"`. Setting the variable replaces the default list.

    Add the variable to `.env.example` as `MCP_ALLOWED_HOSTS="localhost,127.0.0.1,[::1]"`, to the table in `README.md` and to `compose.yml` as `MCP_ALLOWED_HOSTS: ${MCP_ALLOWED_HOSTS:-}`.

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

    `transport` is required from version 1.1.0. Version 1.0.x does not know the option and fails the typecheck with `'transport' does not exist`, so leave the line out there.

7. **Decide who may call the endpoint.** Without `authorization`, anyone who can reach the server can call every tool. If the task does not say who the clients are, ask before you expose a tool that changes data. See [Authentication](#authentication).

8. **Test it.** Add this helper to `test/helpers.ts`:

    ```ts
    import {
        CLIENT_CAPABILITIES_META_KEY,
        CLIENT_INFO_META_KEY,
        PROTOCOL_VERSION_META_KEY,
    } from "@modelcontextprotocol/server";

    const MCP_PROTOCOL_VERSION = "2026-07-28";

    /**
     * Sends one MCP request to `/mcp` and returns the `result` of the JSON-RPC response.
     * The protocol keeps no session, so every request names its protocol version and client itself.
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

    Then cover each tool in `test/mcp.test.ts`, in a `describe` block set up like the one in `test/example.test.ts`: the success case, each `toolError` and one call with invalid arguments. The SDK answers invalid arguments itself, with `isError: true` and a text that starts with `Input validation error`.

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

9. **Update the documentation.** Add `POST /mcp` to the API table in `README.md`. In the layout in `AGENTS.md`, add `mcp/` and name `mcpRequest()` on the line of `test/helpers.ts`.

10. **Verify** with `bun run check`. To call the endpoint by hand, run `bun run dev` and send:

    ```bash
    curl http://127.0.0.1:3000/mcp \
        -H 'content-type: application/json' \
        -H 'mcp-protocol-version: 2026-07-28' \
        -H 'mcp-method: tools/list' \
        -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}'
    ```

    The Docker image needs no change, because everything new lives in `src/`.

## Authentication

Pass a verifier as `authorization: { bearer: { verifier } }` when you register the plugin. The plugin then answers 401 unless the request carries `Authorization: Bearer <token>` and the verifier accepts the token.

For one shared secret, add `MCP_TOKEN: z.string().min(32)` to `src/env.ts` and write the verifier in `src/mcp/auth.ts`:

```ts
import { createHash, timingSafeEqual } from "node:crypto";
import { OAuthError, OAuthErrorCode, type OAuthTokenVerifier } from "@modelcontextprotocol/server";
import { env } from "@/env";

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Accepts the one shared token from `MCP_TOKEN`. */
export const verifier: OAuthTokenVerifier = {
    verifyAccessToken: async (token) => {
        // compare digests in constant time, so the response time does not reveal how much of the token matched
        if (!timingSafeEqual(digest(token), digest(env.MCP_TOKEN))) {
            throw new OAuthError(OAuthErrorCode.InvalidToken, "Invalid token");
        }

        // the SDK refuses a token without an expiry, and a shared token has none of its own
        return { token, clientId: "shared-token", scopes: [], expiresAt: Math.floor(Date.now() / 1000) + 60 };
    },
};
```

- `MCP_TOKEN` has no default, so nothing that reads the environment starts without it: the server, `bun run db:generate`, `bun run db:studio` and `bun run db:backup`.
- Give it a value in `.env.example` and add a row for it to the table in `README.md`. Pass it through `compose.yml` as `MCP_TOKEN: ${MCP_TOKEN:-}`, and set a value for the `docker` job of `.github/workflows/ci.yml` under `env`. Correct the sentence that says every variable is optional, in `README.md` and at the top of `.env.example`.
- For the tests, set `process.env.MCP_TOKEN` in `test/setup.ts`. A process that a test starts does not get what that file sets, so also add `MCP_TOKEN: env.MCP_TOKEN` next to `NODE_ENV` in `childEnv` of `test/helpers.ts`. Without it, every test that starts a process fails. Send the token from `mcpRequest` as the header ``authorization: `Bearer ${env.MCP_TOKEN}` ``. Add a test for a request without a token and one for a wrong token. Both get a 401.
- The `curl` from step 10 now needs `-H "authorization: Bearer $MCP_TOKEN"`.
- To accept tokens from an OAuth provider instead, verify the token in `verifyAccessToken` and return its real client, scopes and expiry.
- A handler reads the caller from its last argument: `(args, ctx) => ...`, or `(ctx) => ...` for a tool without `inputSchema`, then `ctx.http?.authInfo`.

## Adding a tool later

Add it to the matching file in `src/mcp/tools/`, or to a new file that you register in `src/mcp/index.ts`. Add its tests and run `bun run check`. Resources and prompts are registered in the same place, with `mcp.registerResource` and `mcp.registerPrompt`.

## How the endpoint differs from a route

- Its responses are JSON-RPC, not the `{ statusCode, error, message }` body of the other routes. Rejected tokens get an OAuth body, `{ error, error_description }`. Only a request that fails before it reaches the plugin, such as a body that is not JSON or is too large, gets the body of the other routes.
- A failed tool call is still HTTP 200. The failure is in the result, as `isError: true`. A call to a tool that does not exist is also HTTP 200, with a JSON-RPC `error` and no `result`.
- `REQUEST_TIMEOUT_MS` does not apply. A tool call that takes longer is not answered with 503, so give slow work in a tool a time limit of its own.
- The plugin answers every method on `/mcp`. Anything but `POST` gets a 405.
- The request log shows every call as `POST /mcp`. To log the method and tool name, pass `onRequestComplete: (event) => fastify.log.info(event, "MCP request completed")` to the plugin.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| 403 `Invalid Host: <name>` | The hostname is not in `MCP_ALLOWED_HOSTS`. Behind a reverse proxy, allow the `Host` value the proxy forwards |
| 403 `Invalid Origin: <name>` | A browser-based client on another site. Pass its hostname in the plugin option `allowedOrigins` |
| 400 `Unsupported protocol version` | The client speaks an older MCP revision |
| 400 `the request headers and body disagree` | The `MCP-Protocol-Version` or `Mcp-Method` header, or `Mcp-Name` on a tool call, is missing or differs from the body |
| 401 `Token has no expiration time` | The verifier returned no `expiresAt` |
| `Output validation error` in a tool result | `structuredContent` is missing or does not match `outputSchema` |
| Typecheck fails on `transport` | The option does not match the installed version, see step 6 |
