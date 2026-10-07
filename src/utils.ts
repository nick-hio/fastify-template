import type { FastifyRequest } from "fastify";

export const getRequestIP = (request: FastifyRequest) => {
    if (request.headers['x-real-ip']) { // nginx
        const headers = request.headers['x-real-ip'];
        const ip = (Array.isArray(headers)
            ? headers[headers.length - 1]
            : headers)?.trim();
        if (ip) return ip;
    }

    if (request.headers['x-client-ip']) { // apache
        const headers = request.headers['x-client-ip'];
        const ip = (Array.isArray(headers)
            ? headers[headers.length - 1]
            : headers)?.trim();
        if (ip) return ip;
    }

    return request.ip
}

export const safeAwait = async <T, E = Error>(
    promise: Promise<T>,
): Promise<[null, T] | [E, null]> => {
    try {
        const data = await promise;
        return [null, data as T];
    } catch (error) {
        return [error as E, null];
    }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export const safeTry = <E = Error, T = unknown>(
    func: (...args: any[]) => T,
): [null, T] | [E, null] => {
    try {
        const data = func();
        return [null, data as T];
    } catch (error) {
        return [error as E, null];
    }
}
