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

export const safeAwait = async <T, E = Error>(promise: Promise<T>): Promise<[null, T] | [E, null]> => {
    try {
        const data = await promise;
        return [null, data];
    } catch (error) {
        return [error as E, null];
    }
};

export const safeTry = <T, E = Error>(func: () => T): [null, T] | [E, null] => {
    try {
        const data = func();
        return [null, data];
    } catch (error) {
        return [error as E, null];
    }
};
