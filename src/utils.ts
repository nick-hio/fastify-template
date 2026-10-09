/**
 * Anything can be thrown, including `null`, `undefined` and `0`, which would read as "no error" in a result.
 * A thrown value that is not an `Error` is wrapped in one and kept as its `cause`.
 */
const toError = (thrown: unknown): Error => {
    return thrown instanceof Error ? thrown : new Error(`Non-Error value thrown: ${String(thrown)}`, { cause: thrown });
};

/**
 * Awaits a promise and returns its outcome instead of throwing:
 * `[null, data]` when it resolves, `[error, null]` when it rejects.
 * Check `error` first. After that, TypeScript knows that `data` is not `null`.
 *
 * `error` is always an `Error`. Beyond that it is typed as `E` without a runtime check.
 *
 * @example
 * const [error, response] = await safeAwait(fetch(url));
 * if (error) {
 *     throw fastify.httpErrors.badGateway("Upstream Unavailable");
 * }
 */
export const safeAwait = async <T, E extends Error = Error>(promise: Promise<T>): Promise<[null, T] | [E, null]> => {
    try {
        const data = await promise;
        return [null, data];
    } catch (error) {
        return [toError(error) as E, null];
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
export const safeTry = <T, E extends Error = Error>(func: () => T): [null, T] | [E, null] => {
    try {
        const data = func();
        return [null, data];
    } catch (error) {
        return [toError(error) as E, null];
    }
};
