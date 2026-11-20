import rateLimit from 'express-rate-limit';

/**
 * Per-IP rate limiter for the public (unauthenticated) kiosk endpoints.
 *
 * Skipped under NODE_ENV=test so the suite, which fires lots of requests
 * back to back, isn't perturbed. Pass `{ skipInTest: false }` to exercise
 * the limiter itself from a test, or set VISITAS_TEST_RATE_LIMITS=1.
 *
 * Behind a reverse proxy (Caddy), set TRUST_PROXY so req.ip is the real
 * client and not the proxy — otherwise every client shares one bucket.
 */
export function publicLimiter({ max, windowMs = 60 * 1000, message, skipInTest = true }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message },
    // Checked per request, so a test can set VISITAS_TEST_RATE_LIMITS=1 to
    // exercise the real limiters wired on the real routes.
    skip: () => skipInTest && process.env.NODE_ENV === 'test' && !process.env.VISITAS_TEST_RATE_LIMITS,
  });
}
