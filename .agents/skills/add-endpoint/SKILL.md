---
name: add-endpoint
description: Steps for adding or changing an HTTP endpoint in this Fastify server, including its Zod schemas, registration and tests. Use this when creating a route, adding a method to an existing route, or changing what a route accepts or returns.
---

# Add an endpoint

`src/routes/example.ts` and `test/example.test.ts` are the reference. Read both before writing a new route.

## Steps

1. **Decide where the route lives.** One file per resource in `src/routes/`, named after the resource (`src/routes/users.ts` serves `/users`). Add a method to the existing file if the resource already has one.

2. **Get the schemas.** If the route reads or writes a table, reuse the Zod schemas exported from `src/db/schema/<table>.ts` (narrow them with `.pick()`, `.omit()` or `.partial()`). If the table does not exist yet, follow [change-schema](../change-schema/SKILL.md) first. Define schemas that belong to this route only at the top of the route file.

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

    - Declare a schema for every input the handler reads and for the success response.
    - Return the response value from the handler. Use `reply.code(201)` only when the status is not 200.
    - Throw `fastify.httpErrors.<name>("message")` for expected failures such as `notFound`, `conflict` or `forbidden`.
    - Do not catch unexpected errors. The error handler turns them into a logged, generic 500.
    - To act on a failure, for example to answer 502 when another service is down, use `safeAwait` or `safeTry` from `@/utils` instead of `try`/`catch`. See "Error handling" in `AGENTS.md`.

4. **Register a new file** in `src/routes/index.ts`:

    ```ts
    await fastify.register(usersRoute, { prefix: "/users" });
    ```

5. **Test it** in `test/<resource>.test.ts`. Cover the success case, each expected failure, and one invalid input per schema. Empty the tables the file uses in `beforeEach`.

6. **Verify** with `bun run check`. To try the route by hand, run `bun run dev` and call it with `curl`.

## Checks before you finish

- The path, status codes and error messages are the ones the task asked for.
- Query and path parameters arrive as strings, so numeric and boolean ones use `z.coerce` or `z.stringbool()`.
- The response schema lists every field the client should receive. Anything else is removed from the response.
- If the endpoint is documented in `README.md`, the documentation matches.
