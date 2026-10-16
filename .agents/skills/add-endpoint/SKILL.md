---
name: add-endpoint
description: Steps for adding or changing an HTTP endpoint in this Fastify server, including its Zod schemas, registration and tests. Use this when creating a route, adding a method to an existing route, or changing what a route accepts or returns.
---

# Add an endpoint

The reference is `src/routes/example.ts` and `test/example.test.ts`. Read both first.

## Steps

1. **Pick the file.** One file per resource in `src/routes/`: `src/routes/users.ts` serves `/users`. If the resource has a file, add the method there.

2. **Get the schemas.**
    - **Table schemas.** Reuse the Zod schemas from `src/db/schema/<table>.ts`. Narrow them with `.pick()`, `.omit()` or `.partial()`. No table yet? Follow [change-schema](../change-schema/SKILL.md) first.
    - **Route-only schemas**, such as path parameters or the query string, go at the top of the route file.
    - **Response and body schemas differ.** The response has generated fields such as `id` and `createdAt`. The body lists only what a client may set.

3. **Write the route** as a `FastifyPluginAsyncZod` with a default export:

    ```ts
    import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

    const route: FastifyPluginAsyncZod = async (fastify) => {
        fastify.get(
            "/:id",
            {
                schema: {
                    params: z.object({ id: z.coerce.number().int() }),
                    response: { 200: userSchema },
                },
            },
            async (req) => {
                // req.params.id is a validated number here
            },
        );
    };

    export default route;
    ```

    - **Schemas.** Declare one for every input the handler reads and for the success response.
    - **200:** return the value from the handler.
    - **Other statuses:** declare the schema under that status and send the reply yourself.
        - Create: `response: { 201: userSchema }` with `return reply.code(201).send(user)`.
        - Delete: `response: { 204: z.null() }` with `return reply.code(204).send(null)`.
    - **Expected failures:** throw `fastify.httpErrors.<name>("message")`, such as `notFound`, `conflict` or `forbidden`.
    - **Unexpected errors:** do not catch them. The error handler logs them and sends a generic 500.
    - **Acting on a failure**, such as a 502 when another service is down: use `safeAwait` or `safeTry` from `@/utils`, not `try`/`catch`. See "Error handling" in `AGENTS.md`.
    - **Lists** page by cursor. Copy `listQuerySchema`, `listSchema` and the `GET /` handler from `src/routes/example.ts`.
    - **Duplicates:** insert with `.onConflictDoNothing().returning()`. Throw `conflict` when no row comes back, as `POST /` in `src/routes/example.ts` does. Do not check with a `select` first: two requests at the same time can both pass it.
    - **Several rows together:** use a transaction. Its callback is synchronous. See "Database" in `AGENTS.md`.

4. **Register a new file** in `src/routes/index.ts`:

    ```ts
    await fastify.register(usersRoute, { prefix: "/users" });
    ```

5. **Test it** in `test/<resource>.test.ts`. Cover:
    - the success case
    - each expected failure
    - one invalid input per schema. Assert the `message` and the `issues[].path` of the 400, as the `rejects %s with 400` test in `test/example.test.ts` does

    Empty the tables the file uses in `beforeEach`.

6. **Verify** with `bun run check`. To try the route by hand, run `bun run dev` and call it with `curl`.

## Checks before you finish

- The path, status codes and error messages match the task.
- Query and path parameters arrive as strings. Use `z.coerce` or `z.stringbool()` for numbers and booleans.
- The response schema lists every field the client should get. Other fields are removed.
- The body schema lists only the fields a client may set. Other fields in the body are ignored.
- A handler that can run longer than `REQUEST_TIMEOUT_MS` sets `handlerTimeout`, in milliseconds, next to `schema`. It passes `req.signal` to the calls that accept one.
- `README.md` matches, if it documents the endpoint.
