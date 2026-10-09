---
name: add-auth
description: Steps for adding authentication to this Fastify server, with API keys for other programs or with users, passwords and cookie sessions for people, covering the auth plugin, the tables, protecting routes and tests. Use this when asked to restrict who may call the API, to add API keys, login or user accounts, or to protect a route.
---

# Add authentication

The template ships without authentication: every route answers everyone. This playbook adds an `auth` plugin that identifies the caller, and makes routes require it.

It covers who is calling. What a caller may do, such as roles or owning a row, is the project's own logic, built on `req.apiKey` or `req.user`.

## Decide first

Who calls the API decides the variant. If the task does not say, ask before you write code.

| Callers | Variant |
| --- | --- |
| Other programs: services, scripts, scheduled jobs | [A](#variant-a-api-keys): API keys, sent as `Authorization: Bearer <key>` |
| People, from a browser | [B](#variant-b-users-and-sessions): email, password and a session cookie |
| Callers that hold tokens from an identity provider | [Tokens from an identity provider](#tokens-from-an-identity-provider) |

Also ask:

- Which routes stay public? `/health` always does, because the Docker health check calls it.
- For Variant B: may anyone create an account? Is the frontend served from the same origin as the API? The steps assume it is. A frontend on another origin also needs CORS with credentials, see [add-cors](../add-cors/SKILL.md).
- Are there both kinds of caller? Each variant is written to stand alone. An `authenticate` that accepts either credential is not worked out here.

## The auth plugin

Both variants protect routes with the same plugin, `src/plugins/auth.ts`. It adds `fastify.authenticate`, a hook that a route runs to require credentials, and puts the caller on the request. This is the plugin of Variant A:

```ts
import type { FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { findApiKey } from "@/auth/api-keys";
import type { ApiKey } from "@/db/schema/api-keys";

declare module "fastify" {
    interface FastifyInstance {
        /** An `onRequest` hook that answers 401 unless the request carries a valid API key. */
        authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    }

    interface FastifyRequest {
        /** The key that authenticated the request. Reading it in a route without `authenticate` throws. */
        apiKey: ApiKey;
    }
}

/** Adds `fastify.authenticate` and `req.apiKey`. A route is protected once it runs the hook: `src/routes/index.ts`. */
export default fp(
    async (fastify) => {
        const callers = new WeakMap<FastifyRequest, ApiKey>();

        fastify.decorateRequest("apiKey", {
            getter() {
                const apiKey = callers.get(this);

                if (!apiKey) {
                    throw new Error("`req.apiKey` was read in a route that does not run `fastify.authenticate`");
                }

                return apiKey;
            },
        });

        fastify.decorate("authenticate", async (req, reply) => {
            // "Bearer" in any case: the scheme of an `Authorization` header is case-insensitive
            const key = /^Bearer (.+)$/i.exec(req.headers.authorization ?? "")?.[1];
            const apiKey = key ? await findApiKey(key) : undefined;

            if (!apiKey) {
                // names the kind of credentials the server expects, as a 401 has to
                reply.header("www-authenticate", "Bearer");
                throw fastify.httpErrors.unauthorized(key ? "Invalid API Key" : "Missing API Key");
            }

            callers.set(req, apiKey);
        });
    },
    { name: "auth", dependencies: ["@fastify/sensible"] },
);
```

- `authenticate` is an `onRequest` hook, so an anonymous request is answered before its body is read.
- `req.apiKey` is typed without `null`, so a handler uses it without a check. In a route that does not run the hook, reading it throws and the error handler answers 500. A forgotten hook fails loudly instead of running a handler that has no caller.
- With `dependencies`, the server refuses to start when the plugin is registered before one it needs.

Register it in `src/server.ts`, after `errorHandler` and before the routes, with `await fastify.register(auth);`.

## Variant A: API keys

The server generates a key, shows it once and stores only its SHA-256 digest, so a copy of the database holds no key that works.

1. **Add the table** `api_keys` in `src/db/schema/api-keys.ts`, exported as `apiKeysTable`: `id` and `createdAt` as in `kv.ts`, `name: text().notNull()`, `keyHash: text("key_hash").notNull().unique()`, and the nullable `lastUsedAt: text("last_used_at")` and `revokedAt: text("revoked_at")`. Export `type ApiKey = Omit<typeof apiKeysTable.$inferSelect, "keyHash">`.

    Generate the migration as [change-schema](../change-schema/SKILL.md) describes, with `bun run db:generate --name add_api_keys_table`. Its SQL is a single `CREATE TABLE`.

2. **Write `src/auth/api-keys.ts`.** It imports `createHash` and `randomBytes` from `node:crypto`, and `and`, `eq`, `getColumns` and `isNull` from `drizzle-orm`.

    ```ts
    /** `lastUsedAt` is written at most this often per key, so a busy client does not cause a write on every request. */
    const LAST_USED_INTERVAL_MS = 60_000;

    // Every column except the digest, which has no use outside the lookup.
    const { keyHash: _, ...columns } = getColumns(apiKeysTable);

    /**
     * The SHA-256 digest of a key, as hex. A key is 32 random bytes, which nobody can guess, so a fast hash is
     * enough. A slow password hash would protect nothing here, and it would run on every request.
     */
    export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

    /** Creates a key. `key` is the secret to hand out: it is not stored and cannot be read again. */
    export const createApiKey = async (name: string): Promise<{ key: string; apiKey: ApiKey }> => {
        const key = randomBytes(32).toString("base64url");
        const [apiKey] = await db
            .insert(apiKeysTable)
            .values({ name, keyHash: hashKey(key) })
            .returning(columns);

        if (!apiKey) {
            throw new Error("The key was not stored");
        }

        return { key, apiKey };
    };

    /** Returns the row of a key that exists and is not revoked, and records that the key was used. */
    export const findApiKey = async (key: string): Promise<ApiKey | undefined> => {
        // The lookup is by digest, so the key is never compared and no response time shows how much of it matched.
        const [apiKey] = await db
            .select(columns)
            .from(apiKeysTable)
            .where(and(eq(apiKeysTable.keyHash, hashKey(key)), isNull(apiKeysTable.revokedAt)))
            .limit(1);

        if (apiKey && (!apiKey.lastUsedAt || Date.now() - Date.parse(apiKey.lastUsedAt) > LAST_USED_INTERVAL_MS)) {
            apiKey.lastUsedAt = new Date().toISOString();
            await db.update(apiKeysTable).set({ lastUsedAt: apiKey.lastUsedAt }).where(eq(apiKeysTable.id, apiKey.id));
        }

        return apiKey;
    };
    ```

    - Nothing compares a key in JavaScript. If you add a comparison of secrets, for example with a token from the environment, compare digests with `timingSafeEqual`, as the verifier in [add-mcp-server](../add-mcp-server/SKILL.md) does.
    - Also export `revokeApiKey(id)`: an `update` that sets `revokedAt` to `new Date().toISOString()` where the id matches and `revokedAt` is null, with `.returning(columns)`. A revoked key keeps its row, so the list still shows it.

3. **Add the script** at the end of the same file, in an `if (import.meta.main)` block as in `src/db/backup.ts`. Keys are managed from the command line, because a route that creates keys would need a key itself. The command and its argument are `Bun.argv.slice(2)`:

    - `create <name>` calls `createApiKey` and prints the key on a line of its own, so a script can read it with `tail -n 1`
    - `list` prints `console.table(await db.select(columns).from(apiKeysTable))`
    - `revoke <id>` calls `revokeApiKey(Number(argument))`
    - anything else, and an id that no active key has, prints the usage with `console.error` and sets `process.exitCode = 1`

    End the block with `db.$client.close()`. Add `"keys": "bun src/auth/api-keys.ts"` to the scripts in `package.json`, and the file to the `noConsole` override in `biome.json`, next to `src/db/backup.ts`. The file is in `src/`, so the Docker image has it: `docker compose exec app bun run keys create "billing service"`.

4. **Write the plugin** as shown in [The auth plugin](#the-auth-plugin), register it and [protect the routes](#protect-the-routes).

5. **Verify** with `bun run check` once the [tests](#tests) are in place, then by hand:

    ```bash
    bun run dev                                  # applies the migration
    bun run keys create "billing service"        # prints the key, this once
    curl -i http://127.0.0.1:3000/example        # 401 with `WWW-Authenticate: Bearer`
    curl http://127.0.0.1:3000/example -H 'Authorization: Bearer <key>'
    bun run keys revoke 1                        # the key answers 401 from now on
    ```

## Variant B: users and sessions

A password is stored as an argon2id hash made by `Bun.password`, which is built into Bun. A login adds a row to `sessions` and puts a random token into a cookie. The row holds only the SHA-256 digest of the token.

1. **Install the cookie plugin** with `bun add @fastify/cookie` and register it in `src/server.ts` before `auth`, with `await fastify.register(cookie);`.

2. **Add the tables.** `src/db/schema/users.ts` exports `usersTable` for `users`: `id` and `createdAt` as in `kv.ts`, `email: text().notNull().unique()` and `passwordHash: text("password_hash").notNull()`. `src/db/schema/sessions.ts` exports `sessionsTable` for `sessions`: `id`, `createdAt`, `tokenHash: text("token_hash").notNull().unique()`, `expiresAt: text("expires_at").notNull()` and `userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" })`, with `(table) => [index("sessions_expires_at_idx").on(table.expiresAt)]` as the third argument of `sqliteTable`.

    Derive three Zod schemas in `users.ts`:

    - `userSchema`, for responses: `createSelectSchema(usersTable, { createdAt: z.iso.datetime() }).omit({ passwordHash: true })`. `User` is its inferred type.
    - `userCreateSchema`, for registering: `createInsertSchema` with the email rule `z.string().trim().toLowerCase().pipe(z.email().max(254))`, then `.pick({ email: true }).extend({ password: z.string().min(8).max(128) })`. The email is trimmed first, because `z.email().trim()` checks the format before it trims.
    - `loginSchema`: `userCreateSchema.extend({ password: z.string().min(1).max(128) })`. A password that is too short for a new account is simply a wrong password at login.

    Generate the migration with `bun run db:generate --name add_users_and_sessions`. Its SQL creates `sessions` before `users`, the table it references. SQLite accepts that.

3. **Write `src/auth/sessions.ts`.** It imports `createHash` and `randomBytes` from `node:crypto`, the type `CookieSerializeOptions` from `@fastify/cookie`, and `and`, `eq`, `gt` and `lte` from `drizzle-orm`.

    ```ts
    export const SESSION_COOKIE = "session";

    /** How long a login lasts. After that the user logs in again, however active they were. */
    const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

    export const sessionCookieOptions = {
        path: "/",
        // Scripts in the page cannot read the cookie, so a script injected into the page cannot steal the session.
        httpOnly: true,
        // The browser leaves the cookie out of requests that another site makes, except when a link leads here.
        sameSite: "lax",
        // The browser only sends the cookie over HTTPS.
        secure: env.NODE_ENV === "production",
        // in seconds
        maxAge: SESSION_TTL_MS / 1000,
    } satisfies CookieSerializeOptions;

    /** A token is 32 random bytes, so a fast hash is enough, as it runs on every request. */
    const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

    /** Starts a session for a user and returns its token. The token goes into the cookie and is not stored. */
    export const createSession = async (userId: number): Promise<string> => {
        const token = randomBytes(32).toString("base64url");
        const now = Date.now();

        // Expired sessions are removed at every login, which needs no timer and is often enough.
        await db.delete(sessionsTable).where(lte(sessionsTable.expiresAt, new Date(now).toISOString()));
        await db.insert(sessionsTable).values({
            tokenHash: hashToken(token),
            userId,
            expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
        });

        return token;
    };

    /** Returns the user of a session that exists and has not expired. */
    export const findSessionUser = async (token: string): Promise<User | undefined> => {
        const [user] = await db
            .select({ id: usersTable.id, email: usersTable.email, createdAt: usersTable.createdAt })
            .from(sessionsTable)
            .innerJoin(usersTable, eq(usersTable.id, sessionsTable.userId))
            // ISO 8601 timestamps in UTC sort like the moments they name, so they compare as text.
            .where(
                and(eq(sessionsTable.tokenHash, hashToken(token)), gt(sessionsTable.expiresAt, new Date().toISOString())),
            )
            .limit(1);

        return user;
    };
    ```

    - Also export `deleteSession(token)`, which deletes the row with the digest of that token.
    - The cookie is not signed, and `@fastify/cookie` gets no `secret`. The token is random and only found through its digest, so a made-up cookie matches nothing.
    - A session ends 30 days after the login, however active the user is. Deleting a user deletes their sessions.

4. **Write the plugin** as shown in [The auth plugin](#the-auth-plugin), with `user: User` in place of `apiKey: ApiKey`, and with `"@fastify/cookie"` added to `dependencies`. `authenticate` reads `req.cookies[SESSION_COOKIE]` instead of the header and calls `findSessionUser`. It throws `unauthorized("Not Logged In")` without a cookie and `unauthorized("Session Expired")` without a session. It sends no `WWW-Authenticate` header, because no scheme describes a session cookie.

5. **Add `REGISTRATION_ENABLED`** to `src/env.ts`, as `REGISTRATION_ENABLED: z.stringbool().default(false)`. Every account passes `authenticate`, so open registration opens every protected route. Leave the variable `false` unless people sign up on their own. A closed project switches it on only for as long as it takes to create its accounts. Add it to `.env.example`, to the table in `README.md` and to `compose.yml` as `REGISTRATION_ENABLED: ${REGISTRATION_ENABLED:-}`.

6. **Write the routes** in `src/routes/auth.ts`, and register the file with the prefix `/auth` in the public group of [Protect the routes](#protect-the-routes). Above the plugin function, the file holds `const dummyHash = await Bun.password.hash(randomBytes(32).toString("hex"));`, the hash of a password that nobody knows. The login route uses it:

    ```ts
    fastify.post(
        "/login",
        {
            schema: {
                body: loginSchema,
                response: { 200: userSchema },
            },
        },
        async (req, reply) => {
            const [user] = await db.select().from(usersTable).where(eq(usersTable.email, req.body.email)).limit(1);

            // An unknown email is checked against the dummy hash, so it takes as long as a wrong password
            // and the response time does not tell which emails have an account.
            const isValid = await Bun.password.verify(req.body.password, user?.passwordHash ?? dummyHash);

            if (!user || !isValid) {
                // one message for both, so the answer does not tell them apart either
                throw fastify.httpErrors.unauthorized("Invalid Email Or Password");
            }

            reply.setCookie(SESSION_COOKIE, await createSession(user.id), sessionCookieOptions);

            // `userSchema` has no `passwordHash`, so the response does not carry it
            return user;
        },
    );
    ```

    - `POST /register`, inside `if (env.REGISTRATION_ENABLED) { ... }`: body `userCreateSchema`, response `{ 201: userSchema }`. Hash first, with `await Bun.password.hash(req.body.password)`, then insert with `.onConflictDoNothing().returning()` and throw `conflict("Email Already Registered")` when no row comes back, as `POST /example` does. This 409 tells a caller which emails have an account. Hiding that takes a confirmation email, which is not covered here.
    - `POST /logout`, with `onRequest: fastify.authenticate`: call `deleteSession` with `req.cookies[SESSION_COOKIE]`, then `reply.clearCookie(SESSION_COOKIE, sessionCookieOptions)`, and answer 204. A browser only removes a cookie when the path matches the one it was set with.
    - `GET /me` is shown in [Protect the routes](#protect-the-routes).
    - A hash takes about 100 ms and 64 MiB of memory, and login has no limit on attempts. Add one before the server is public, as [add-rate-limit](../add-rate-limit/SKILL.md) describes under "One route".

7. **Know what stands in for a CSRF token.** None is used. `SameSite=Lax` keeps the cookie out of every request that another site makes, except when the user follows a link, which is a `GET`. A route with a body schema also accepts nothing but JSON, which an HTML form cannot send: a form post is answered 415, or 400 when it is sent as `text/plain`. This does not cover:

    - a `GET` route that changes data, so never write one
    - a page on another subdomain of the same site: `SameSite` compares sites, not origins, so its requests carry the cookie, and a route without a body, such as `POST /auth/logout`, accepts them
    - a deployment that enables CORS with credentials, or sets `SameSite=None` for a frontend on another site

    If one of these applies, add a token with `@fastify/csrf-protection`. This playbook does not cover it.

8. **Verify** with `bun run check` once the [tests](#tests) are in place. By hand, set `REGISTRATION_ENABLED="true"` in `.env`, run `bun run dev`, register and log in with `curl -c cookies.txt`, then call `/auth/me` with `curl -b cookies.txt`.

## Protect the routes

Routes opt in. `src/routes/index.ts` registers them in two groups. This is the file of Variant B. Variant A has no `authRoute`:

```ts
const routes: FastifyPluginAsync = async (fastify) => {
    /* public: anyone can call these */
    await fastify.register(healthRoute, { prefix: "/health" });
    await fastify.register(authRoute, { prefix: "/auth" });

    /* protected: every route registered in this block requires credentials */
    await fastify.register(async (protectedRoutes) => {
        protectedRoutes.addHook("onRequest", fastify.authenticate);

        await protectedRoutes.register(exampleRoute, { prefix: "/example" });
    });
};
```

- Register every new route file inside the block, unless anonymous callers must reach it. The file then shows at a glance what is public.
- The alternative, one hook for the whole server with a list of exceptions, was not chosen. It answers 401 instead of 404 for a path that does not exist, and its exceptions would be spread over the route files instead of standing in one place.
- The price: a route registered outside the block is public, and nothing fails. Test every protected route file with one request that sends no credentials.
- A hook inside the block does not run for a path that matches no route, so that path still answers 404.

To protect one route, pass the hook to it. To protect one route file, call `fastify.addHook("onRequest", fastify.authenticate)` at the top of its plugin function.

```ts
fastify.get(
    "/me",
    {
        onRequest: fastify.authenticate,
        schema: {
            response: { 200: userSchema },
        },
    },
    async (req) => req.user,
);
```

## Tests

The tests that exist now get 401 from protected routes. Add `authHeaders()` to `test/helpers.ts`, which returns the headers of an authenticated request. In Variant A it runs `const { key } = await createApiKey("test");` and returns ``{ authorization: `Bearer ${key}` }``. In Variant B:

```ts
/**
 * Creates a user with a session and returns the headers that authenticate a request as that user.
 * The user has no password hash, which would take 100 ms to compute, and so cannot log in.
 */
export const authHeaders = async () => {
    const user = db
        .insert(usersTable)
        .values({ email: `${randomUUID()}@example.com`, passwordHash: "" })
        .returning()
        .get();

    return { cookie: `${SESSION_COOKIE}=${await createSession(user.id)}` };
};
```

- In each test file of a protected route, call the helper once, in a `beforeAll` after `useServer()`, and pass `headers` to every `inject` call.
- `test/process.test.ts` stalls a request to `/example`, which now answers 401 before it reads the body. In Variant B, set `BODY_ROUTE` to `/auth/login`. In Variant A, send a key with the raw request: create it with `runBun(["src/auth/api-keys.ts", "create", "test"], { DATA_DIR: server.dataDir })`, take the last line of its `stdout`, and add `Authorization: Bearer ${key}\r\n` to the request in `stallRequest`.
- A process that a test starts has the defaults of `src/env.ts` and nothing that `test/setup.ts` sets. `useProcess()` gives its server a database of its own. `runBun` does not, so pass `DATA_DIR` to it, or the script opens `./data`.
- In Variant B, add `process.env.REGISTRATION_ENABLED = "true";` to `test/setup.ts`. It reaches the servers of `useServer()`.
- Cover in `test/auth.test.ts`: valid credentials, none, wrong ones, a revoked key or an expired session, and one anonymous request per protected route. In Variant A also the script, with `runBun(["src/auth/api-keys.ts", "list"], { DATA_DIR })`, where `DATA_DIR` comes from `@/db/config` and is the database of the test run. In Variant B also a wrong password and an unknown email getting the same answer, logout, and the exact `Set-Cookie` header.
- What is read at startup needs `useProcess()`: `start({ NODE_ENV: "production", REGISTRATION_ENABLED: "true" })` for the `Secure` cookie, and `start()` for the register route that does not exist by default.
- To test the plugin on its own, build a small server as `test/error-handler.test.ts` does.

## Documentation

- `README.md`: say which routes need credentials and how to send them. Add the new routes to the API table and, in Variant A, `bun run keys` to the scripts.
- `AGENTS.md`: add `auth/` to the layout and, in Variant A, `bun run keys` to the commands. Under Routes, say that a new route file is registered inside the protected block of `src/routes/index.ts` and that `req.apiKey` or `req.user` is the caller. Under Tests, name `authHeaders()`.
- `.agents/skills/add-endpoint/SKILL.md`: say the same in its steps for registering and testing a route.

## Tokens from an identity provider

This section names the approach. It is not worked out in steps.

When a provider such as Auth0, Keycloak or Entra ID logs the users in, a caller sends the provider's access token, a JWT, as `Authorization: Bearer <token>`. The server then stores no passwords, sessions or keys. `authenticate` keeps its shape: it reads the token as in Variant A, verifies it and sets `req.user` from its claims.

Verify with [jose](https://github.com/panva/jose): `createRemoteJWKSet(new URL(jwksUrl))` once, then `jwtVerify(token, keys, { issuer, audience })` for each request. Always pass `issuer` and `audience`, or a token that the provider issued for another API is accepted. The three values belong in `src/env.ts`. Never read the claims of a token without verifying it.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Tests of existing routes fail with 401 | The routes are protected now. Send `authHeaders()`, see [Tests](#tests) |
| `test/process.test.ts` gets 401 instead of 503, or exit code 0 instead of 1 | Its stalled request goes to a protected route, see [Tests](#tests) |
| Typecheck fails with `'FastifyReply' is declared but never used` | Inside `declare module "fastify"`, the types of that module need no import. Import only what the rest of the file uses |
| `bun run keys` fails with `Failed query: insert into "api_keys"` | The database has no tables yet. Start the server once, it applies the migrations |
| `POST /auth/register` answers 404 | `REGISTRATION_ENABLED` is not `true` |
| Login answers 200, the next request 401 `Not Logged In` | `NODE_ENV` is `production`, the default, and the server is reached over plain HTTP. A client drops a `Secure` cookie that arrives that way. curl makes an exception for `localhost` and `127.0.0.1`. Use HTTPS, or `NODE_ENV=development` for a local test |
| Startup fails with `The dependency '@fastify/cookie' of plugin 'auth' is not registered` | `auth` is registered before `cookie` in `src/server.ts` |
| Register answers 400 for an email with a space around it | The schema checks the format before it trims, as `z.email().trim()` does. Use the schema of step 2 |
| Login answers 500 and the log shows `PASSWORD_UNSUPPORTED_ALGORITHM` | The `passwordHash` of that user was not made by `Bun.password.hash`, for example in a seed |
| A route answers 500 and the log shows `was read in a route that does not run` | The route reads `req.apiKey` or `req.user` without the hook. Move it into the protected block |
