import assert from "node:assert/strict";
import * as lifePlusSolana from "../src/lib/lifePlusSolana";

const exported = lifePlusSolana as Record<string, unknown>;

assert.equal(typeof exported.getLifePlusMint, "function");
assert.equal(typeof exported.getAssociatedTokenAddress, "function");
assert.equal(exported.createTransferCheckedInstruction, undefined);
assert.equal(exported.transferLifePlusToFoundation, undefined);
assert.equal(exported.createAssociatedTokenAccountIdempotentInstruction, undefined);

console.log("Solana LIFE++ readonly safety fixtures passed");
