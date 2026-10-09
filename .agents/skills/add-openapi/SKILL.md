---
name: add-openapi
description: Steps for generating an OpenAPI document from the Zod schemas of the routes with the @fastify/swagger plugin, covering installation, the `/openapi.json` route, error responses, named schemas, an optional Swagger UI page and tests. Use this when asked to add OpenAPI or Swagger documentation, to publish an API specification or a docs page, or to change how a route, a schema or an error appears in the document.
---

# Add an OpenAPI document

[@fastify/swagger](https://github.com/fastify/fastify-swagger) builds an OpenAPI document from the schemas that the routes already declare. These steps serve it as JSON at `GET /openapi.json`. The template does not ship with it.

The document can only repeat what a schema says, so the steps also give every route a name, a summary and its error responses. Every route added later needs the same.

## Steps

1. **Install the plugin**, and a validator for the tests.

    ```bash
    bun add @fastify/swagger
    bun add -d @seriousme/openapi-schema-validator
    ```

    `fastify-type-provider-zod`, which the template already uses, converts the Zod schemas for the plugin. `bunfig.toml` holds back releases younger than 3 days, so read the options of the version you got in `node_modules/@fastify/swagger/README.md`.

2. **Add the switch** to `src/env.ts`:

    ```ts
    /** Serve the OpenAPI document at `/openapi.json`. Unset means: everywhere but in production. */
    OPENAPI_ENABLED: z.stringbool().optional(),
    ```

    The document lists every route with its parameters and schemas. Whether to publish that is for the project to decide, so a server in production does not serve it until the variable is `true`. Add the variable to the table in `README.md`, to `compose.yml` as `OPENAPI_ENABLED: ${OPENAPI_ENABLED:-}` and to `.env.example` as `OPENAPI_ENABLED=""`. Leave it empty there: Compose reads `.env` too, so a value would also reach the container.

3. **Add the error schema** to `src/plugins/error-handler.ts`, above the plugin, and import `z` from `zod` there:

    ```ts
    /** The body of every error response. */
    export const errorSchema = z
        .object({
            statusCode: z.number().int(),
            error: z.string(),
            message: z.string(),
            issues: z
                .array(z.object({ path: z.string(), message: z.string() }))
                .optional()
                .describe("One entry per invalid field. Only present when the request failed validation."),
        })
        .meta({ id: "Error" });

    /**
     * The `response` entries for the error statuses a route answers with, each described by its status text:
     * `response: { 200: userSchema, ...errorResponses(400, 404) }`.
     */
    export const errorResponses = <Code extends number>(...codes: Code[]) => {
        const responses = {} as Record<Code, typeof errorSchema>;

        for (const code of codes) {
            responses[code] = errorSchema.describe(STATUS_CODES[code] ?? "Error");
        }

        return responses;
    };
    ```

    The schema describes the body that the error handler in the same file sends, so the two change together.

4. **Write the plugin** in `src/plugins/openapi.ts`:

    ```ts
    import swagger from "@fastify/swagger";
    import fp from "fastify-plugin";
    import { jsonSchemaTransform, jsonSchemaTransformObject } from "fastify-type-provider-zod";
    import { env } from "@/env";

    /**
     * Generates an OpenAPI document from the Zod schemas of the routes and serves it at `/openapi.json`.
     * Register it before the routes: a route that is registered earlier is missing from the document.
     */
    export default fp(
        async (fastify) => {
            // The document lists every route, so a production server only serves it when asked to.
            if (!(env.OPENAPI_ENABLED ?? env.NODE_ENV !== "production")) {
                return;
            }

            await fastify.register(swagger, {
                openapi: {
                    openapi: "3.1.0",
                    info: { title: "My API", version: "1.0.0" },
                },
                transform: (route) => {
                    const { schema, url } = jsonSchemaTransform(route);

                    // A route file registers "/" under a prefix, which would be listed as `/example/`.
                    return { schema, url: url.length > 1 && url.endsWith("/") ? url.slice(0, -1) : url };
                },
                transformObject: (input) => {
                    const document = jsonSchemaTransformObject(input);
                    const schemas = ("components" in document && document.components?.schemas) || {};

                    // Every named schema is listed twice, as `Name` and `NameInput`. Remove the ones nothing refers to,
                    // and repeat, because a removed schema can have been the only one that referred to another.
                    for (;;) {
                        const json = JSON.stringify(document);
                        const unused = Object.keys(schemas).filter(
                            (name) => !json.includes(`"#/components/schemas/${name}"`),
                        );

                        if (unused.length === 0) {
                            return document;
                        }
                        for (const name of unused) {
                            delete schemas[name];
                        }
                    }
                },
            });

            // No response schema: the document is built by the plugin, and `hide` keeps this route out of it.
            fastify.get("/openapi.json", { schema: { hide: true } }, async () => fastify.swagger());
        },
        { name: "openapi" },
    );
    ```

    - Set `title` and `version` in `info`. Left out, they become the name and version of the plugin package.
    - `openapi: "3.1.0"` uses the JSON Schema dialect that Zod 4 writes. In 3.0, `204: z.null()` would be listed with a JSON body.
    - `transform` converts the Zod schemas of a route. It also removes the trailing slash: Fastify serves a `"/"` under a prefix as `/example` and as `/example/`, and the plugin would list the second. Both keep answering.

5. **Register the plugin** in `src/server.ts`, after the error handler and before the routes:

    ```ts
    import openapi from "@/plugins/openapi";

    await fastify.register(openapi);
    ```

6. **Document the routes.** Give every route an `operationId`, a `summary`, `tags` and its error responses, and name the schemas that clients would call a type. The three sections after the steps show how.

7. **Test it** in `test/openapi.test.ts`:

    ```ts
    import { describe, expect, test } from "bun:test";
    import { Validator } from "@seriousme/openapi-schema-validator";
    import { useServer } from "./helpers";

    interface OpenApiDocument {
        [key: string]: unknown;
        paths: Record<string, Record<string, { operationId?: string; responses: Record<string, unknown> }>>;
        components: { schemas: Record<string, unknown> };
    }

    describe("/openapi.json", () => {
        const server = useServer();

        const getDocument = async () => {
            const response = await server().inject({ method: "GET", url: "/openapi.json" });
            expect(response.statusCode).toBe(200);

            return response.json<OpenApiDocument>();
        };

        test("serves a valid OpenAPI 3.1 document", async () => {
            const validator = new Validator();

            // checks the structure of the document and that every `$ref` has a target
            expect(await validator.validate(await getDocument())).toEqual({ valid: true });
            expect(validator.version).toBe("3.1");
        });

        test("lists every route once, without a trailing slash and without itself", async () => {
            const { paths } = await getDocument();
            const methods = Object.entries(paths).map(([path, item]) => [path, Object.keys(item).sort()]);

            expect(Object.fromEntries(methods)).toEqual({
                "/health": ["get"],
                "/example": ["get", "post"],
                "/example/{id}": ["delete", "get", "patch"],
            });
        });
    });
    ```

    Add a route to the list in the second test whenever you add one to the server. In the same file, also test that every operation has a `summary`, a tag and an `operationId` of its own, that the `responses` of one route are the ones you expect, and that `components.schemas` has exactly the names you gave.

    The switch is read at startup, so test it in `test/process.test.ts`: a server started with `NODE_ENV: "production"` answers 404 for `/openapi.json`, and 200 once `OPENAPI_ENABLED: "true"` is added.

8. **Optional: add a page to browse the document.** [@fastify/swagger-ui](https://github.com/fastify/fastify-swagger-ui) serves Swagger UI. The server needs it at runtime, so install it as a normal dependency with `bun add @fastify/swagger-ui`, then register it in `src/plugins/openapi.ts` after `@fastify/swagger`:

    ```ts
    import swaggerUi from "@fastify/swagger-ui";

    await fastify.register(swaggerUi, { routePrefix: "/docs" });
    ```

    The page is at `/docs`, behind the same switch. The plugin also serves the document a second time, at `/docs/json` and `/docs/yaml`. It reads its files from its package in `node_modules` and writes nothing, so it runs on the read-only filesystem of the container. Test that `GET /docs` answers 200 with HTML.

9. **Update the documentation.** In `README.md`, replace the API table with a pointer to `/openapi.json`: the table repeats by hand what the document now generates. Keep the sentence about the error body. In `AGENTS.md`, add under Routes that every route gets an `operationId`, a `summary`, `tags` and `...errorResponses()`.

10. **Verify** with `bun run check`. To read the document, run `bun run dev` and fetch it:

    ```bash
    curl http://127.0.0.1:3000/openapi.json
    ```

    The Docker image needs no change, because everything new lives in `src/` and `node_modules`. In the container the document stays off until `OPENAPI_ENABLED` is `true`.

## Documenting a route

```ts
schema: {
    operationId: "getEntry",
    summary: "Get an entry",
    tags: ["example"],
    params: paramsSchema,
    response: { 200: kvSchema.describe("The entry"), ...errorResponses(400, 404) },
},
```

- `operationId` names the operation and must be unique. Client generators use it as the function name.
- `summary` is one line, and `description` is for what needs more. `tags` groups the routes, use the name of the resource.
- `.describe()` on a response schema is the description of that response. Without it the document says `Default Response`. On a field, it describes the field or the parameter. A JSDoc comment does not reach the document.
- `204: z.null()` is listed as a response without a body.
- `hide: true` keeps a route out of the document, and `deprecated: true` marks it as deprecated.
- `z.number().int()` is listed with the bounds of a safe integer, and `z.iso.datetime()` with a long `pattern` next to `format: date-time`. Both are accurate, leave them.

## Naming a schema

```ts
export const kvSchema = createSelectSchema(kvTable, {
    createdAt: z.iso.datetime(),
}).meta({ id: "Entry" });
```

A schema with an `id` is listed once in `components.schemas`, and every use of it is a `$ref`. Without an `id`, the whole definition is repeated wherever the schema is used.

- Name what a client would call a type, such as a resource or the error body.
- An `id` must be unique. A second schema with the same `id` is not reported: every `$ref` then points at the one defined last.
- A named schema in a `body` is listed as `<id>Input`, because what a route accepts can differ from what it returns, for example in a field with a default.
- Never name a schema that is a whole `params`, `querystring` or `headers`. The plugin fails on it and `/openapi.json` answers 500. A named field inside one is fine.
- `.pick()`, `.omit()`, `.partial()` and `.extend()` return a schema without a name. `.describe()`, `.optional()`, `.nullable()` and `z.array()` keep the reference.

## Error responses

`errorResponses(400, 404)`, imported from `@/plugins/error-handler`, returns the `response` entries for those statuses. Each refers to the `Error` schema and has the status text, such as `Not Found`, as its description.

- List 400 on a route that has a `params`, `querystring`, `body` or `headers` schema, and every status that its handler throws.
- Leave out 500 and 503. Every route can answer them.
- Nothing checks the list against the handler. A status that is thrown but not listed is answered as before and is missing from the document.
- Fastify serializes an error body with the schema declared for its status, which removes every field the schema does not list. When you add a field to the body in the error handler, add it to `errorSchema`, or the routes that list their errors stop sending it.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `/openapi.json` answers 404 | `NODE_ENV` is `production`, which is the default, and `OPENAPI_ENABLED` is not `true` |
| `/openapi.json` answers 500 and the log says `undefined is not an object (evaluating 'jsonSchema.properties')` | A `params`, `querystring` or `headers` schema has an `id` |
| A route is missing from `paths` | It is registered before the plugin, or its schema has `hide: true` |
| A path ends in a slash, such as `/example/` | `transform` does not remove it, see step 4 |
| A schema is listed with `def` and `shape` | `transform` is missing, so the plugin printed the Zod object itself |
| The validator reports `Can't resolve #/components/schemas/<id>` | `transformObject` is missing, so the named schemas are not listed |
| An error response lost a field, such as `issues` | The schema declared for that status does not list the field |
| An error is answered as 500 `Response doesn't match the schema` | The schema declared for that status does not match the body the error handler sends |
| Two routes show the same schema, but return different ones | Their schemas have the same `id` |
| A 204 is listed with a JSON body | `openapi` is set to 3.0. There, declare the response as `z.undefined()` and send it with `reply.code(204).send()` |
