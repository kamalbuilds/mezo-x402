/**
 * mezo-x402 — a paid API storefront settled in MUSD on Mezo.
 *
 * GET /                    free landing page: catalog, prices, curl example
 * GET /api/btc-price       $0.01  BTC/USDT 24h ticker (Binance)
 * GET /api/mempool         $0.02  Bitcoin mempool fees + tip height (mempool.space)
 * GET /api/mezo-network    $0.03  Mezo testnet chain stats via RPC
 * GET /api/musd-stats      $0.03  MUSD totalSupply on-chain (Mezo RPC)
 * GET /api/mezo-market     $0.02  MEZO market data (CoinGecko)
 * GET /demo                $0.001 paywall demo route — pay in browser, get JSON
 *
 * Every paid route answers 402 + PAYMENT-REQUIRED header until a payment
 * settles through https://facilitator.vativ.io. Browser requests get the
 * bundled @x402/paywall UI; programmatic clients get JSON + header.
 *
 *   npm install
 *   PAY_TO=0x<your-merchant-address> npm start
 */
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { RouteConfig } from "@x402/core/server";
import type { Network } from "@x402/core/types";
import { createPaywall } from "@x402/paywall";
import { evmPaywall } from "@x402/paywall/evm";
import { createPublicClient, http, erc20Abi, formatUnits } from "viem";

// --- Config -----------------------------------------------------------------
const PORT = Number(process.env.PORT ?? 4021);
const NETWORK = (process.env.NETWORK ?? "eip155:31611") as Network; // Mezo testnet
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "https://facilitator.vativ.io";
// Merchant receives every payment. Default is the hosted x402 demo address —
// set PAY_TO to your own account before taking real payments.
const PAY_TO = process.env.PAY_TO ?? "0xC3376296a18ef364eA19287203EEd7a87f18e738";
const MEZO_RPC = process.env.MEZO_RPC ?? "https://rpc.test.mezo.org";
const MUSD_ADDRESS = "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503" as const; // testnet

const mezoChain = {
  id: 31611,
  name: "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: [MEZO_RPC] } },
  testnet: true,
} as const;

const mezoClient = createPublicClient({ chain: mezoChain, transport: http(MEZO_RPC) });

const app = express();
app.disable("x-powered-by");

// --- x402 wiring -------------------------------------------------------------
const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitator).register(
  NETWORK,
  new ExactEvmScheme(),
);
const paywall = createPaywall().withNetwork(evmPaywall).build();

const route = (path: string, price: string, description: string): Record<string, RouteConfig> => ({
  [`GET ${path}`]: {
    accepts: {
      scheme: "exact",
      price,
      network: NETWORK,
      payTo: PAY_TO,
    },
    description,
  },
});

app.use(
  paymentMiddleware(
    {
      ...route("/api/btc-price", "$0.01", "BTC/USDT 24h market data"),
      ...route("/api/mempool", "$0.02", "Bitcoin mempool fee estimates and tip height"),
      ...route("/api/mezo-network", "$0.03", "Mezo testnet chain statistics"),
      ...route("/api/musd-stats", "$0.03", "MUSD on-chain supply statistics"),
      ...route("/api/mezo-market", "$0.02", "MEZO token market data"),
      ...route("/demo", "$0.001", "mezo-x402 storefront demo - pay to unlock"),
    },
    resourceServer,
    { appName: "mezo-x402 - MUSD paid API storefront", testnet: true },
    paywall,
  ),
);

// --- Helpers ------------------------------------------------------------------
async function upstream(url: string, timeoutMs = 8000): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "user-agent": "mezo-x402-storefront/1.0" },
  });
  if (!res.ok) throw new Error(`upstream ${res.status} from ${url}`);
  return res.json();
}

function fail(res: express.Response, err: unknown) {
  res.status(502).json({ error: "upstream data unavailable", detail: String(err) });
}

// --- Paid endpoints ------------------------------------------------------------
app.get("/api/btc-price", async (_req, res) => {
  try {
    const t = (await upstream(
      "https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT",
    )) as Record<string, string>;
    res.json({
      symbol: "BTC/USDT",
      price: Number(t.lastPrice),
      change24h: Number(t.priceChangePercent),
      volume24h: Number(t.quoteVolume),
      high24h: Number(t.highPrice),
      low24h: Number(t.lowPrice),
      source: "binance",
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    fail(res, err);
  }
});

app.get("/api/mempool", async (_req, res) => {
  try {
    const [fees, height] = await Promise.all([
      upstream("https://mempool.space/api/v1/fees/recommended"),
      upstream("https://mempool.space/api/v1/blocks/tip/height"),
    ]);
    res.json({ fees, tipHeight: height, source: "mempool.space" });
  } catch (err) {
    fail(res, err);
  }
});

app.get("/api/mezo-network", async (_req, res) => {
  try {
    const [blockNumber, gasPrice, chainId] = await Promise.all([
      mezoClient.getBlockNumber(),
      mezoClient.getGasPrice(),
      mezoClient.getChainId(),
    ]);
    res.json({
      chainId: Number(chainId),
      network: "Mezo Testnet",
      blockNumber: Number(blockNumber),
      gasPriceGwei: Number(gasPrice) / 1e9,
      rpc: MEZO_RPC,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    fail(res, err);
  }
});

app.get("/api/musd-stats", async (_req, res) => {
  try {
    const [supply, decimals, symbol, name] = await Promise.all([
      mezoClient.readContract({
        address: MUSD_ADDRESS,
        abi: erc20Abi,
        functionName: "totalSupply",
      }),
      mezoClient.readContract({
        address: MUSD_ADDRESS,
        abi: erc20Abi,
        functionName: "decimals",
      }),
      mezoClient.readContract({
        address: MUSD_ADDRESS,
        abi: erc20Abi,
        functionName: "symbol",
      }),
      mezoClient.readContract({
        address: MUSD_ADDRESS,
        abi: erc20Abi,
        functionName: "name",
      }),
    ]);
    res.json({
      token: name,
      symbol,
      address: MUSD_ADDRESS,
      decimals: Number(decimals),
      totalSupply: formatUnits(supply as bigint, Number(decimals)),
      chainId: 31611,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    fail(res, err);
  }
});

app.get("/api/mezo-market", async (_req, res) => {
  try {
    const data = (await upstream(
      "https://api.coingecko.com/api/v3/simple/price?ids=mezo&vs_currencies=usd&include_24hr_change=true&include_market_cap=true",
    )) as Record<string, Record<string, number>>;
    const mezo = data.mezo;
    if (!mezo) {
      res.status(502).json({ error: "MEZO not listed on CoinGecko free API" });
      return;
    }
    res.json({
      symbol: "MEZO/USD",
      price: mezo.usd,
      change24h: mezo.usd_24h_change ?? null,
      marketCap: mezo.usd_market_cap ?? null,
      source: "coingecko",
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    fail(res, err);
  }
});

app.get("/demo", (_req, res) => {
  res.json({
    ok: true,
    message: "Paid! You unlocked the mezo-x402 demo route.",
    howToPay: "Open any paid route in a browser to see the @x402/paywall UI, or run: node client.js /api/btc-price",
    endpoints: [
      "/api/btc-price $0.01",
      "/api/mempool $0.02",
      "/api/mezo-network $0.03",
      "/api/musd-stats $0.03",
      "/api/mezo-market $0.02",
    ],
  });
});

// --- Free landing page ---------------------------------------------------------
const LANDING = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>mezo-x402 — pay per call in MUSD</title>
<style>
  :root{color-scheme:dark}
  body{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#0b0e14;color:#e6edf3;max-width:860px;margin:0 auto;padding:48px 20px;line-height:1.55}
  h1{font-size:1.9rem;margin:0 0 8px}
  h2{font-size:1.1rem;color:#7ee787;margin-top:40px}
  .sub{color:#8b949e}
  table{width:100%;border-collapse:collapse;margin:16px 0;font-size:.9rem}
  td,th{padding:8px 10px;border-bottom:1px solid #21262d;text-align:left}
  th{color:#8b949e;font-weight:normal}
  code,pre{background:#161b22;border:1px solid #21262d;border-radius:6px}
  code{padding:2px 6px;font-size:.85em}
  pre{padding:14px;overflow-x:auto;font-size:.82rem}
  a{color:#58a6ff;text-decoration:none}
  .badge{display:inline-block;background:#1f6feb33;color:#58a6ff;border:1px solid #1f6feb66;border-radius:20px;padding:2px 12px;font-size:.75rem;margin-left:8px;vertical-align:middle}
  .steps{counter-reset:s;list-style:none;padding:0}
  .steps li{counter-increment:s;margin:10px 0;padding-left:34px;position:relative}
  .steps li::before{content:counter(s);position:absolute;left:0;top:0;width:22px;height:22px;border-radius:50%;background:#1f6feb;color:#fff;font-size:.75rem;display:flex;align-items:center;justify-content:center}
</style></head><body>
<h1>mezo-x402 <span class="badge">MUSD · Mezo testnet · x402</span></h1>
<p class="sub">A paid API storefront. Agents and developers pay <strong>per request in MUSD</strong>: one signature, no account, no API key. Settled on Mezo (eip155:31611) through the x402 facilitator at <code>facilitator.vativ.io</code>.</p>

<h2>Endpoints</h2>
<table>
<tr><th>Endpoint</th><th>Price (MUSD)</th><th>Returns</th></tr>
<tr><td><a href="/api/btc-price"><code>/api/btc-price</code></a></td><td>$0.01</td><td>BTC/USDT 24h ticker</td></tr>
<tr><td><a href="/api/mempool"><code>/api/mempool</code></a></td><td>$0.02</td><td>Bitcoin mempool fee estimates, tip height</td></tr>
<tr><td><a href="/api/mezo-network"><code>/api/mezo-network</code></a></td><td>$0.03</td><td>Mezo testnet block height, gas price, chain id</td></tr>
<tr><td><a href="/api/musd-stats"><code>/api/musd-stats</code></a></td><td>$0.03</td><td>MUSD totalSupply, symbol, decimals on-chain</td></tr>
<tr><td><a href="/api/mezo-market"><code>/api/mezo-market</code></a></td><td>$0.02</td><td>MEZO/USD price, 24h change, market cap</td></tr>
<tr><td><a href="/demo"><code>/demo</code></a></td><td>$0.001</td><td>Minimal paywall smoke test</td></tr>
</table>

<h2>Try it</h2>
<p>Any paid route returns <code>402 Payment Required</code> with machine-readable requirements until paid. In a browser you get the paywall UI: connect a wallet holding testnet MUSD, sign once, done.</p>
<pre id="curl">curl -i __BASE__/api/btc-price</pre>
<p>Decode the payment requirements from the <code>PAYMENT-REQUIRED</code> response header, or just open the URL in a browser.</p>

<h2>Pay programmatically</h2>
<pre>PRIVATE_KEY=0x... node client.js /api/btc-price</pre>
<p>The client wraps <code>fetch</code> with <code>@x402/fetch</code>, answers the 402, signs an EIP-712 permit2 authorization, and retries. The facilitator pays gas; the buyer pays only MUSD.</p>

<h2>How it works</h2>
<ol class="steps">
<li>Client requests a paid route, server responds <code>402</code> + <code>PAYMENT-REQUIRED</code> header (scheme, network, asset, amount, payTo).</li>
<li>Client signs a permit2 authorization with its key and retries with a payment header.</li>
<li>Server posts payload + requirements to <code>facilitator.vativ.io</code>; the facilitator verifies, settles MUSD on-chain, and pays gas.</li>
<li>Server runs the handler and returns JSON.</li>
</ol>

<h2>Need testnet MUSD?</h2>
<p>MUSD on testnet is minted by borrowing against testnet BTC: drip BTC from <a href="https://faucet.test.mezo.org">the faucet</a>, then borrow at <a href="https://mezo.org/feature/borrow">mezo.org/feature/borrow</a> (minimum 2,000 MUSD borrow). See README for details.</p>

<p class="sub">Built for the Mezo Buildathon, Access &amp; Distribution track. Network: Mezo testnet eip155:31611. MUSD <code>0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503</code></p>
</body></html>`;

app.get("/", (_req, res) => {
  const base = process.env.PUBLIC_URL ?? `http://localhost:${PORT}`;
  res.type("html").send(LANDING.split("__BASE__").join(base));
});

app.listen(PORT, () => {
  console.log(`mezo-x402 listening on http://localhost:${PORT}`);
  console.log(`Network: ${NETWORK} · Facilitator: ${FACILITATOR_URL} · payTo: ${PAY_TO}`);
});
