"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class MemoryStorage {
    constructor() {
        this.items = new Map();
    }

    get length() {
        return this.items.size;
    }

    key(index) {
        return Array.from(this.items.keys())[index] || null;
    }

    getItem(key) {
        return this.items.has(key) ? this.items.get(key) : null;
    }

    setItem(key, value) {
        this.items.set(key, String(value));
    }

    removeItem(key) {
        this.items.delete(key);
    }
}

async function testIncrementalHistoryReturnsFullMergedRange() {
    const storage = new MemoryStorage();
    const cacheKey = "ifind_hist4_TEST.CSI_2024-01-02_2026-01-04";
    storage.setItem(cacheKey, JSON.stringify({
        dates: ["2024-01-02", "2026-01-02"],
        close: [100, 200],
        amount: [10, 20],
        _cachedAt: 0,
    }));

    const requests = [];
    const context = {
        AppConfig: { PROXY_BASE: "" },
        Date,
        JSON,
        Promise,
        console,
        isNaN,
        localStorage: storage,
        window: {},
        fetch: async (_url, options) => {
            requests.push(JSON.parse(options.body));
            return {
                json: async () => ({
                    dates: ["2026-01-02", "2026-01-04"],
                    close: [222, 400],
                    amount: [22, 40],
                }),
            };
        },
    };
    context.window.Android = null;

    const source = fs.readFileSync(path.join(__dirname, "..", "www", "js", "fetch.js"), "utf8");
    vm.runInNewContext(source, context, { filename: "fetch.js" });

    const result = await context.Fetch.fetchIndexHistory("TEST.CSI", "2024-01-02", "2026-01-04");

    assert.equal(requests.length, 1);
    assert.equal(requests[0].start, "2025-12-23");
    assert.deepEqual(Array.from(result.dates), ["2024-01-02", "2026-01-02", "2026-01-04"]);
    assert.deepEqual(Array.from(result.close), [100, 222, 400]);
    assert.deepEqual(Array.from(result.amount), [10, 22, 40]);
}

testIncrementalHistoryReturnsFullMergedRange()
    .then(() => console.log("fetch cache regression test passed"))
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
