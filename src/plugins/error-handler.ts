import { STATUS_CODES } from "node:http";
import type { FastifyError } from "fastify";
import fp from "fastify-plugin";

/**
 * Gives every error response the same `{ statusCode, error, message }` body.
 * Client errors (4xx) keep their message. Server errors (5xx) are logged in full and
 * answered with a generic message so internal details never reach the client.
 */
export default fp(
    async (fastify) => {
        fastify.setErrorHandler<FastifyError>((error, request, reply) => {
            const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
            const reason = STATUS_CODES[statusCode] ?? "Error";
            const isServerError = statusCode >= 500;

            if (isServerError) {
                request.log.error({ err: error }, "Request failed");
            }

            return reply.code(statusCode).send({
                statusCode,
                error: reason,
                message: isServerError ? reason : error.message,
            });
        });
    },
    { name: "error-handler" },
);
