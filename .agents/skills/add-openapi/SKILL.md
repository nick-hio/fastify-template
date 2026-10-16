---
name: add-openapi
description: Steps for generating an OpenAPI document from the Zod schemas of the routes with @fastify/swagger, covering `/openapi.json`, error responses, named schemas, an optional Swagger UI page and tests. Use this when asked to add OpenAPI or Swagger docs, to publish an API specification or docs page, or to change how a route, schema or error appears in the document.
---

# Add an OpenAPI document

[@fastify/swagger](https://github.com/fastify/fastify-swagger) builds an OpenAPI document from the route schemas. The template does not include it. These steps serve it at `GET /openapi.json`.

The document shows only what the schemas declare. So every route, now and later, needs a name, a summary and its error responses.

## Steps

1. **Install the plugin** and a validator for the tests.

    ```bash
    bun add @fastify/swagger
    bun add -d @seriousme/openapi-schema-validator
    ```

    `fastify-type-provider-zod` (already installed) converts the Zod schemas. `bunfig.toml` holds back releases younger than 3 days, so read the options of the installed version in `node_modules/@fastify/swagger/README.md`.

2. **Add the switch** to `src/env.ts`:

    ```ts
    /** Serve the OpenAPI document at `/openapi.json`. Unset means: everywhere but in production. */
    OPENAPI_ENABLED: z.stringbool().optional(),
    ```

    - **Off in production** unless `true`. The document exposes every route and schema.
    - **Add the variable** to the `README.md` table, to `compose.yml` as `OPENAPI_ENABLED: ${OPENAPI_ENABLED:-}` and to `.env.example` as `OPENAPI_ENABLED=""`.
    - **Keep it empty in `.env.example`.** Compose reads `.env` too, so a value would reach the container.

3. **Add the error schema** to `src/plugins/error-handler.ts`, above the plugin. Import `z` from `zod` there.

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

    The schema describes the body the error handler sends. Change the two together.

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

    - **Set `title` and `version`** in `info`. Otherwise they default to those of the plugin package.
    - **`openapi: "3.1.0"`** matches the JSON Schema dialect of Zod 4. In 3.0, `204: z.null()` gets a JSON body.
    - **`transform`** converts the Zod schemas and removes the trailing slash. Fastify serves a `"/"` under a prefix as both `/example` and `/example/`. Both still answer, but only `/example` is listed.

5. **Register the plugin** in `src/server.ts`, after the error handler and before the routes:

    ```ts
    import openapi from "@/plugins/openapi";

    await fastify.register(openapi);
    ```

6. **Document every route** as the sections after the steps show: `operationId`, `summary`, `tags`, error responses and named schemas.

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

    - **Add each new route** to the path list in the second test.
    - **Also test**, in the same file:
        - every operation has a `summary`, a tag and a unique `operationId`
        - the `responses` of one route are the ones you expect
        - `components.schemas` has exactly the names you gave
    - **Test the switch** in `test/process.test.ts`, because it is read at startup. `NODE_ENV: "production"` gives a 404. Adding `OPENAPI_ENABLED: "true"` gives a 200.

8. **Optional: add a Swagger UI page.** Install [@fastify/swagger-ui](https://github.com/fastify/fastify-swagger-ui) as a runtime dependency (not `-d`): `bun add @fastify/swagger-ui`. Register it in `src/plugins/openapi.ts` after `@fastify/swagger`:

    ```ts
    import swaggerUi from "@fastify/swagger-ui";

    await fastify.register(swaggerUi, { routePrefix: "/docs" });
    ```

    - **`/docs`** serves the page, behind the same switch. `/docs/json` and `/docs/yaml` serve the document again.
    - **Writes nothing**, so it runs on the read-only container filesystem.
    - **Test** that `GET /docs` answers 200 with HTML.

9. **Update the documentation.**
    - **`README.md`:** replace the API table with a pointer to `/openapi.json`. Keep the sentence about the error body.
    - **`AGENTS.md`:** under Routes, add that every route gets an `operationId`, a `summary`, `tags` and `...errorResponses()`.

10. **Verify** with `bun run check`. To read the document, run `bun run dev`, then:

    ```bash
    curl http://127.0.0.1:3000/openapi.json
    ```

    The Docker image needs no change. In the container, the document stays off until `OPENAPI_ENABLED` is `true`.

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

- **`operationId`** must be unique. Client generators use it as the function name.
- **`summary`** is one line. Put more in `description`.
- **`tags`** groups routes. Use the resource name.
- **`.describe()`** on a response schema sets its description (default: `Default Response`). On a field, it describes the field or parameter. JSDoc comments do not reach the document.
- **`204: z.null()`** is listed without a body.
- **`hide: true`** keeps a route out of the document. `deprecated: true` marks it deprecated.
- **Leave the long output.** `z.number().int()` gets safe-integer bounds, and `z.iso.datetime()` gets a long `pattern` next to `format: date-time`. Both are accurate.

## Naming a schema

```ts
export const kvSchema = createSelectSchema(kvTable, {
    createdAt: z.iso.datetime(),
}).meta({ id: "Entry" });
```

With an `id`, a schema is listed once in `components.schemas`, and each use is a `$ref`. Without one, the full definition repeats at each use.

- **Name** what a client would call a type, such as a resource or the error body.
- **Keep `id`s unique.** A duplicate is not reported. Every `$ref` then points at the schema defined last.
- **In a `body`**, a named schema is listed as `<id>Input`, because input can differ from output, for example in a field with a default.
- **Never name a whole `params`, `querystring` or `headers` schema.** The plugin fails and `/openapi.json` answers 500. A named field inside one is fine.
- **Lose the name:** `.pick()`, `.omit()`, `.partial()`, `.extend()`. **Keep the reference:** `.describe()`, `.optional()`, `.nullable()`, `z.array()`.

## Error responses

`errorResponses(400, 404)` from `@/plugins/error-handler` returns `response` entries for those statuses. Each refers to the `Error` schema and has the status text, such as `Not Found`, as its description.

- **List 400** when the route has a `params`, `querystring`, `body` or `headers` schema. Also list every status the handler throws.
- **Leave out 500 and 503.** Every route can answer them.
- **Nothing checks the list.** A thrown status that is not listed still answers, but is missing from the document.
- **Keep `errorSchema` in sync** with the error handler. Fastify removes fields that the status schema does not list. Add a new body field to `errorSchema`, or routes that list their errors stop sending it.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `/openapi.json` answers 404 | `NODE_ENV` is `production` (the default) and `OPENAPI_ENABLED` is not `true` |
| `/openapi.json` answers 500, log says `undefined is not an object (evaluating 'jsonSchema.properties')` | A `params`, `querystring` or `headers` schema has an `id` |
| A route is missing from `paths` | It is registered before the plugin, or has `hide: true` |
| A path ends in a slash, such as `/example/` | `transform` does not remove it, see step 4 |
| A schema is listed with `def` and `shape` | `transform` is missing. The plugin printed the Zod object |
| Validator reports `Can't resolve #/components/schemas/<id>` | `transformObject` is missing. Named schemas are not listed |
| An error response lost a field, such as `issues` | The schema for that status does not list it |
| An error is a 500 `Response doesn't match the schema` | The schema for that status does not match the error handler's body |
| Two routes show the same schema but return different ones | Their schemas share an `id` |
| A 204 is listed with a JSON body | `openapi` is 3.0. There, use `z.undefined()` and send with `reply.code(204).send()` |
