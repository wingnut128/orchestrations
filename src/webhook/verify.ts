import { createHmac, timingSafeEqual } from "node:crypto";

const HEX_SHA256_RE = /^[0-9a-fA-F]{64}$/;

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
	if (!HEX_SHA256_RE.test(signature)) return false;

	const expected = createHmac("sha256", secret).update(body).digest();
	const received = Buffer.from(signature, "hex");

	return timingSafeEqual(expected, received);
}
