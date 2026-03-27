import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify a Forgejo webhook HMAC-SHA256 signature.
 *
 * Forgejo sends the signature in the `X-Forgejo-Signature` header
 * as a hex-encoded HMAC-SHA256 of the raw request body.
 */
export function verifySignature(
	body: string,
	signature: string,
	secret: string,
): boolean {
	if (!signature) return false;

	const expected = createHmac("sha256", secret).update(body).digest("hex");

	if (expected.length !== signature.length) return false;

	return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
