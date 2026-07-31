import { createHash } from "node:crypto";

const apiKey = process.env.RESEND_API_KEY;
const to = process.env.BUILD_IN_PUBLIC_ALERT_TO;
const from = process.env.BUILD_IN_PUBLIC_ALERT_FROM;
const subject = process.env.ALERT_SUBJECT ?? "build-in-public automation failed";
const message = process.env.ALERT_MESSAGE ?? "the build-in-public automation encountered an error.";
const idempotencyKey = createHash("sha256")
  .update(`${process.env.GITHUB_RUN_ID ?? "local"}:${subject}`)
  .digest("hex");

if (!apiKey || !to || !from) {
  throw new Error(
    "RESEND_API_KEY, BUILD_IN_PUBLIC_ALERT_TO, and BUILD_IN_PUBLIC_ALERT_FROM are required for failure email delivery."
  );
}

let lastError;
for (let attempt = 1; attempt <= 3; attempt += 1) {
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `build-in-public/${idempotencyKey}`,
      },
      body: JSON.stringify({ from, to: [to], subject, text: message }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(`Resend failed: ${result.message ?? response.statusText}`);
      error.status = response.status;
      throw error;
    }
    console.log(`Sent failure notification ${result.id ?? ""}.`.trim());
    process.exit(0);
  } catch (error) {
    lastError = error;
    const retryable = !error.status || error.status === 408 || error.status === 429 || error.status >= 500;
    if (!retryable || attempt === 3) break;
    await new Promise((resolve) => setTimeout(resolve, 1000 * (2 ** (attempt - 1))));
  }
}

throw lastError;
