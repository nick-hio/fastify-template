import { describe, expect, test } from "bun:test";
import { connect } from "node:net";
import { join } from "node:path";
import { DATA_DIR } from "@/db/config";
import { useProcess } from "./helpers";

// Any route that reads a JSON body. Point this at one of your own once the example is gone.
const BODY_ROUTE = "/example";

/**
 * Sends the headers of a POST and only the start of its body, then goes silent like a client that hangs.
 * `closed` resolves with everything the server sent, once the server ends the connection.
 */
const stallRequest = (port: number) => {
    const socket = connect(port, "127.0.0.1", () => {
        socket.write(
            `POST ${BODY_ROUTE} HTTP/1.1\r\nHost: test\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{"key":`,
        );
    });

    let received = "";
    socket.on("data", (chunk) => {
        received += chunk.toString();
    });
    // the server closing the connection first can surface as an error on this side
    socket.on("error", () => {});

    const closed = new Promise<string>((resolve) => {
        socket.on("close", () => resolve(received));
    });

    return { closed, socket };
};

const isIncoming = (url: string) => (line: { msg: string; req?: { url: string } }) => {
    return line.msg === "incoming request" && line.req?.url === url;
};

describe("process", () => {
    const start = useProcess();

    test("closes cleanly on SIGTERM", async () => {
        const server = await start();
        expect((await fetch(`${server.url}/health`)).status).toBe(200);

        server.child.kill("SIGTERM");

        expect(await server.child.exited).toBe(0);
        expect(server.logs().map((line) => line.msg)).toContain("Server closed");
    });

    test("answers a request that takes too long with 503 and ends its connection", async () => {
        const server = await start({ REQUEST_TIMEOUT_MS: "200" });

        const response = await stallRequest(server.port).closed;

        expect(response).toStartWith("HTTP/1.1 503 Service Unavailable");
        expect(response).toContain('"message":"Service Unavailable"');
    });

    test("stops waiting for an open request when the shutdown deadline passes", async () => {
        const server = await start({ SHUTDOWN_TIMEOUT_MS: "200" });
        const stalled = stallRequest(server.port);
        await server.waitForLog(isIncoming(BODY_ROUTE));

        server.child.kill("SIGTERM");

        expect(await server.child.exited).toBe(1);
        expect(server.logs().map((line) => line.msg)).toContain("Shutdown timed out with requests still open");
        stalled.socket.destroy();
    });

    test("exits at once on a second signal", async () => {
        // the default deadline of several seconds would fail this test by its timeout
        const server = await start();
        const stalled = stallRequest(server.port);
        await server.waitForLog(isIncoming(BODY_ROUTE));

        server.child.kill("SIGTERM");
        await server.waitForLog((line) => line.msg === "Shutdown signal received");
        server.child.kill("SIGINT");

        expect(await server.child.exited).toBe(1);
        expect(server.logs().map((line) => line.msg)).toContain("Second shutdown signal received, exiting now");
        stalled.socket.destroy();
    }, 3000);

    test("takes the client address from X-Forwarded-For only when the sender is a trusted proxy", async () => {
        const headers = { "x-forwarded-for": "198.51.100.1, 203.0.113.7" };

        // a request is logged with the address of its client, also when no route matches it
        const direct = await start();
        await fetch(`${direct.url}/whoami`, { headers });
        expect((await direct.waitForLog(isIncoming("/whoami"))).req?.remoteAddress).toBe("127.0.0.1");

        // The proxy appends the address it saw, so the last entry is the one to believe. The first is client input.
        const proxied = await start({ TRUST_PROXY: "127.0.0.1" });
        await fetch(`${proxied.url}/whoami`, { headers });
        expect((await proxied.waitForLog(isIncoming("/whoami"))).req?.remoteAddress).toBe("203.0.113.7");
    });

    test("starts in a data directory with URL characters in its name", async () => {
        const server = await start({ DATA_DIR: join(DATA_DIR, "data #1 50%?") });

        expect((await fetch(`${server.url}/health`)).status).toBe(200);
    });
});
