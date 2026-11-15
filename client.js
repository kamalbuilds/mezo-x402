#!/usr/bin/env node
/**
 * mezo-x402 client — pays for a storefront endpoint in MUSD, end to end.
 *
 * Usage:
 *   PRIVATE_KEY=0x<buyer-key-with-testnet-MUSD> node client.js /api/btc-price
 *   PRIVATE_KEY=0x... BASE_URL=https://your-deploy.example.com node client.js /api/mempool
 *
 * Flow: GET -> 402 + PAYMENT-REQUIRED -> sign permit2 authorization -> retry with
 * payment header -> facilitator.vativ.io verifies + settles MUSD on Mezo testnet
 * (facilitator pays gas) -> JSON response.
 */
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http } from "viem";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:4021").replace(/\/$/, "");
const path = process.argv[2] ?? "/api/btc-price";
const privateKey = process.env.PRIVATE_KEY;

if (!privateKey) {
  console.error("Set PRIVATE_KEY to a testnet buyer key holding MUSD.");
  process.exit(1);
}
if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  console.error("PRIVATE_KEY must be a 32-byte hex key (0x + 64 hex chars).");
  process.exit(1);
}

const MEZO_RPC = process.env.MEZO_RPC ?? "https://rpc.test.mezo.org";
const account = privateKeyToAccount(privateKey);
const publicClient = createPublicClient({
  transport: http(MEZO_RPC),
});
const signer = toClientEvmSigner(account, publicClient);

const client = new x402Client();
registerExactEvmScheme(client, {
  signer,
  schemeOptions: { 31611: { rpcUrl: MEZO_RPC } },
});

const payFetch = wrapFetchWithPayment(fetch, client);

console.log(`Buyer:    ${account.address}`);
console.log(`Request:  ${BASE_URL}${path}`);
console.log("Requesting (expect a 402 -> pay -> retry cycle)...");

const res = await payFetch(`${BASE_URL}${path}`, { headers: { accept: "application/json" } });
const body = await res.text();

console.log(`Status:   ${res.status}`);
try {
  console.log(JSON.stringify(JSON.parse(body), null, 2));
} catch {
  console.log(body.slice(0, 2000));
}
if (!res.ok) process.exit(1);
