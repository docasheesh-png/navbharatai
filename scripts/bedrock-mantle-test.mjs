#!/usr/bin/env node
/**
 * Standalone proof: does Amazon Bedrock's Mantle endpoint work with THIS AWS account?
 *
 * This file is NOT part of NavBharatAI's app. It touches no production code. It does exactly one
 * thing: call the official Bedrock Mantle (OpenAI-compatible Chat Completions) endpoint once with
 * your Amazon Bedrock API key and the model zai.glm-5, sending the prompt "Hello", then print the
 * endpoint, HTTP status, request id, the full raw response body, and any error verbatim.
 *
 * Run it (Node 18+, needs global fetch):
 *   AWS_BEARER_TOKEN_BEDROCK=<your ABSK… key> node scripts/bedrock-mantle-test.mjs
 * Optional overrides:
 *   AWS_REGION=us-east-1   BEDROCK_GLM_MODEL=zai.glm-5
 *
 * The key is read ONLY from the environment — it is never printed or hard-coded.
 */

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
const model = process.env.BEDROCK_GLM_MODEL || 'zai.glm-5';
const bearer = process.env.AWS_BEARER_TOKEN_BEDROCK || process.env.BEDROCK_API_KEY || '';
const endpoint = `https://bedrock-mantle.${region}.api.aws/v1/chat/completions`;

function line() {
  console.log('─'.repeat(72));
}

async function main() {
  line();
  console.log('Amazon Bedrock Mantle — standalone connectivity proof');
  line();
  console.log('Endpoint URL :', endpoint);
  console.log('Region       :', region);
  console.log('Model        :', model);
  console.log('Bearer key   :', bearer ? `present (length ${bearer.length}, starts "${bearer.slice(0, 4)}…")` : 'MISSING');
  line();

  if (!bearer) {
    console.error('ERROR: No Amazon Bedrock API key. Set AWS_BEARER_TOKEN_BEDROCK to your "ABSK…" key.');
    process.exit(1);
  }

  const requestBody = {
    model,
    messages: [{ role: 'user', content: 'Hello' }],
    max_tokens: 256,
    temperature: 0.7,
  };
  console.log('Request body :', JSON.stringify(requestBody));
  line();

  let resp;
  try {
    resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
  } catch (err) {
    // Network / DNS / TLS failure (e.g. Mantle not available in this region).
    console.error('NETWORK ERROR (fetch threw) — the endpoint could not be reached:');
    console.error(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    console.error('This usually means the Mantle endpoint is not reachable in this region.');
    process.exit(2);
  }

  const httpStatus = resp.status;
  const requestId =
    resp.headers.get('x-amzn-requestid') || resp.headers.get('x-amzn-RequestId') || '(none in headers)';
  const rawText = await resp.text();

  console.log('HTTP Status  :', httpStatus, resp.statusText);
  console.log('Request ID   :', requestId);
  line();
  console.log('Raw response body:');
  console.log(rawText);
  line();

  let parsed = null;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    /* not JSON */
  }

  if (resp.ok && parsed) {
    const text = parsed?.choices?.[0]?.message?.content ?? parsed?.choices?.[0]?.text ?? null;
    if (text) {
      console.log('✅ SUCCESS — GLM-5 replied via Bedrock Mantle:');
      console.log(text);
      line();
      console.log('PROVEN: Bedrock Mantle is the correct integration path for this account.');
      process.exit(0);
    }
    console.log('⚠️  HTTP 2xx but no assistant text found — inspect the raw body above.');
    process.exit(3);
  }

  console.error(`❌ FAILED (HTTP ${httpStatus}). The complete raw error is printed above.`);
  console.error('If the message mentions the model, region, or "not supported", adjust');
  console.error('BEDROCK_GLM_MODEL / AWS_REGION and re-run. If it mentions auth, the API key is the issue.');
  process.exit(4);
}

main().catch((err) => {
  console.error('UNEXPECTED ERROR:', err instanceof Error ? err.stack : String(err));
  process.exit(5);
});
