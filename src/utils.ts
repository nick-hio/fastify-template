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
