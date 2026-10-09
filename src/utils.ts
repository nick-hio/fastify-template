import type { FastifyRequest } from "fastify";
import { env } from "@/env";

const lastHeaderValue = (header: string | string[] | undefined) => {
    return (Array.isArray(header) ? header[header.length - 1] : header)?.trim();
};

/**
 * Returns the client IP. The proxy headers are client-controlled unless a reverse proxy
 * overwrites them, so they are only read when `TRUST_PROXY` is enabled.
 */
export const getRequestIP = (request: FastifyRequest) => {
    if (!env.TRUST_PROXY) {
        return request.ip;
    }

    return (
        lastHeaderValue(request.headers["x-real-ip"]) || // nginx
        lastHeaderValue(request.headers["x-client-ip"]) || // apache
        request.ip
    );
};

/**
 * Awaits a promise and returns its outcome instead of throwing:
 * `[null, data]` when it resolves, `[error, null]` when it rejects.
 * Check `error` first. After that, TypeScript knows that `data` is not `null`.
 *
 * `error` is whatever was thrown, typed as `E` without a runtime check.
 *
 * @example
 * const [error, response] = await safeAwait(fetch(url));
 * if (error) {
 *     throw fastify.httpErrors.badGateway("Upstream Unavailable");
 * }
 */
export const safeAwait = async <T, E = Error>(promise: Promise<T>): Promise<[null, T] | [E, null]> => {
    try {
        const data = await promise;
        return [null, data];
    } catch (error) {
        return [error as E, null];
    }
};

/**
 * The synchronous counterpart of `safeAwait`: calls `func` and returns `[null, data]`,
 * or `[error, null]` when it throws. Use `safeAwait` for anything that returns a promise,
 * because a rejection happens after `func` has returned and is not caught here.
 *
 * @example
 * const [error, config] = safeTry(() => JSON.parse(text) as Config);
 * if (error) {
 *     throw fastify.httpErrors.badRequest("Invalid Config");
 * }
 */
export const safeTry = <T, E = Error>(func: () => T): [null, T] | [E, null] => {
    try {
        const data = func();
        return [null, data];
    } catch (error) {
        return [error as E, null];
    }
};
