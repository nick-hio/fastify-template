import { afterAll, beforeAll } from "bun:test";
import { buildServer, type Server } from "@/server";

/** Body of every error response. See `src/plugins/error-handler.ts`. */
export interface ErrorBody {
    statusCode: number;
    error: string;
    message: string;
}

/**
 * Builds one server for the calling `describe` block and closes it afterwards.
 * Returns a getter, because the server only exists once `beforeAll` has run.
 */
export const useServer = () => {
    let server: Server;

    beforeAll(async () => {
        server = await buildServer();
    });

    afterAll(async () => {
        await server.close();
    });

    return () => server;
};
