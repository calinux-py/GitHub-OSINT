export function githubRateLimitFailure(status, detail = "", rate = {}, now = Date.now()) {
  const limited = status === 429 || (
    status === 403 && (
      Number(rate.remaining) === 0 || /rate.?limit|secondary limit|abuse/i.test(String(detail))
    )
  );
  if (!limited) return null;

  const resetAt = Number(rate.retryAfter)
    ? now + Number(rate.retryAfter) * 1000
    : Number(rate.reset)
      ? Number(rate.reset) * 1000
      : null;
  const reset = resetAt ? new Date(resetAt).toLocaleTimeString() : "the time specified by GitHub";
  return {
    code: "GITHUB_RATE_LIMIT",
    resetAt,
    message: `GitHub has temporarily declined additional API requests. GitHub enforces this limit; GitHub OSINT does not set it. Requests may resume after ${reset}.`
  };
}
