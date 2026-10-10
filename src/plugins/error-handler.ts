import { STATUS_CODES } from "node:http";
import type { FastifyError } from "fastify";
import fp from "fastify-plugin";

/** The `message` of a request that failed validation, by the part of the request that is invalid. */
const VALIDATION_MESSAGES: Record<string, string> = {
    body: "Invalid Request Body",
    querystring: "Invalid Query String",
    params: "Invalid Path Parameters",
    headers: "Invalid Request Headers",
};

/**
 * Gives every error response the same `{ statusCode, error, message }` body.
 * Client errors (4xx) keep their message. Server errors (5xx) are logged in full and
 * answered with a generic message so internal details never reach the client.
 *
 * A request that fails validation also gets `issues`, one `{ path, message }` per invalid field,
 * so a client can show each message next to the field it belongs to.
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

            // The client of a request that timed out may still be sending it, which would hold the connection open.
            if (error.code === "FST_ERR_HANDLER_TIMEOUT") {
                reply.header("connection", "close");
            }

            if (error.validation) {
                return reply.code(statusCode).send({
                    statusCode,
                    error: reason,
                    message: VALIDATION_MESSAGES[error.validationContext ?? ""] ?? "Invalid Request",
                    issues: error.validation.map((issue) => ({
                        // "/items/0/name" becomes "items.0.name", and "" stands for the whole body
                        path: issue.instancePath.split("/").filter(Boolean).join("."),
                        message: issue.message ?? "Invalid Value",
                    })),
                });
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
