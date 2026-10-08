import { describe, expect, test } from "bun:test";
import { safeAwait, safeTry } from "@/utils";

describe("safeAwait", () => {
    test("returns [null, data] when the promise resolves", async () => {
        expect(await safeAwait(Promise.resolve(42))).toEqual([null, 42]);
    });

    test("returns [error, null] when the promise rejects", async () => {
        const failure = new Error("boom");
        expect(await safeAwait(Promise.reject(failure))).toEqual([failure, null]);
    });
});

describe("safeTry", () => {
    test("returns [null, data] when the function returns", () => {
        expect(safeTry(() => JSON.parse("[1]") as number[])).toEqual([null, [1]]);
    });

    test("returns [error, null] when the function throws", () => {
        const [error, data] = safeTry(() => JSON.parse("not json") as unknown);
        expect(error).toBeInstanceOf(SyntaxError);
        expect(data).toBeNull();
    });
});
