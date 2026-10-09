import { describe, expect, test } from "bun:test";
import { safeAwait, safeTry } from "@/utils";

// Values that are not an `Error`, and that would read as "no error" if they were returned as they are.
const FALSY_THROWN_VALUES = [null, undefined, false, 0, ""];

describe("safeAwait", () => {
    test("returns [null, data] when the promise resolves", async () => {
        expect(await safeAwait(Promise.resolve(42))).toEqual([null, 42]);
    });

    test("returns [error, null] when the promise rejects", async () => {
        const failure = new Error("boom");
        expect(await safeAwait(Promise.reject(failure))).toEqual([failure, null]);
    });

    test.each(FALSY_THROWN_VALUES)("wraps a rejection with %p in an Error", async (thrown) => {
        const [error, data] = await safeAwait(Promise.reject(thrown));
        expect(error).toBeInstanceOf(Error);
        expect(error?.cause).toBe(thrown);
        expect(data).toBeNull();
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

    test.each(FALSY_THROWN_VALUES)("wraps a thrown %p in an Error", (thrown) => {
        const [error, data] = safeTry(() => {
            throw thrown;
        });
        expect(error).toBeInstanceOf(Error);
        expect(error?.cause).toBe(thrown);
        expect(data).toBeNull();
    });
});
