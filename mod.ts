import { serve } from "https://deno.land/std@0.133.0/http/server.ts";
import { encode as encodeBase64UrlSafe } from "https://deno.land/std@0.133.0/encoding/base64url.ts";
import { decode as decodeHex } from "https://deno.land/std@0.133.0/encoding/hex.ts";

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Helper methods

const hex2str = (hex: string) => new TextDecoder().decode(decodeHex(new TextEncoder().encode(hex)));

/**
 * Given a secret key and some data, generate a HMAC of the data using SHA-256.
 */
async function sha256hmac(
    secretKey: Uint8Array | string,
    data: Uint8Array | string,
): Promise<Uint8Array> {
    const enc = new TextEncoder();
    const keyObject = await crypto.subtle.importKey(
        "raw", // raw format of the key - should be Uint8Array
        secretKey instanceof Uint8Array ? secretKey : enc.encode(secretKey),
        { name: "HMAC", hash: { name: "SHA-256" } }, // algorithm
        false, // export = false
        ["sign", "verify"], // what this key can do
    );
    const signature = await crypto.subtle.sign(
        "HMAC",
        keyObject,
        data instanceof Uint8Array ? data : enc.encode(data),
    );
    return new Uint8Array(signature);
}

function makeErrorResponse(message: string, statusCode = 400): Response {
    const body = JSON.stringify({ error: message });
    console.error(` -> Error (${statusCode}): ${message}`);
    return new Response(body, { status: statusCode, headers: { "content-type": "application/json; charset=utf-8" } });
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Configuration

/** What port to listen on. */
const port = parseInt(Deno.env.get("IMGPROXY_GATEWAY_PORT") ?? "5558", 10);
/**
 * The hex-encoded key that imgproxy uses. Note the decoded version must be
 * a valid Unicode string - this can't be random binary data.
 */
const imgProxyKeyHex = Deno.env.get("IMGPROXY_KEY");
if (!imgProxyKeyHex) {
    throw new Error(`IMGPROXY_KEY is required.`);
}
const imgProxyKey = hex2str(imgProxyKeyHex);
/**
 * The hex-encoded salt that imgproxy uses. Note the decoded version must be
 * a valid Unicode string - this can't be random binary data.
 */
const imgProxySaltHex = Deno.env.get("IMGPROXY_SALT");
if (!imgProxySaltHex) {
    throw new Error(`IMGPROXY_SALT is required.`);
}
const imgProxySalt = hex2str(imgProxySaltHex);
/**
 * The JSON-encoded list of widths (in pixels) that we allow for thumbnails.
 */
const allowedWidthsPx: number[] = JSON.parse(
    Deno.env.get("IMGPROXY_GATEWAY_ALLOWED_WIDTHS") ?? "[256, 640, 1000, 2000, 4000]",
);
if (!Array.isArray(allowedWidthsPx) || typeof allowedWidthsPx[0] !== "number") {
    throw new Error(
        `IMGPROXY_GATEWAY_ALLOWED_WIDTHS is invalid. Expected a JSON-encoded array of numbers (pixel widths).`,
    );
}
/**
 * The full URL prefix of the object storage, if we are redirecting to the full-sized original file
 * (no thumbnail)
 */
const upstreamImageSourcePrefix = Deno.env.get("IMGPROXY_GATEWAY_OBJSTORE_PUBLIC_URL_PREFIX") ??
    "http://localhost:9000/neolace-objects";
/**
 * The full URL prefix we can use to request thumbnails from imgproxy. Omit the trailing slash.
 */
const imgproxyUrl = Deno.env.get("IMGPROXY_GATEWAY_IMGPROXY_URL") ?? "http://localhost:5557";
// Always use webp images for thumbnails, regardless of the source image type
const thumbnailImageFormat = "webp";
const quality = 87;

/**
 * Handle incoming requests:
 *   - If the request is for the full image, simply return a 301 redirect to
 *     the underlying object store; we don't need to waste bandwidth proxying it.
 *   - If the request is for a thumbnail (?width=X), call imgproxy and stream
 *     its response.
 */
async function handler(req: Request): Promise<Response> {
    const url = new URL(req.url);
    {
        let query = url.searchParams.toString();
        if (query) {
            query = "?" + query;
        }
        console.log(`${req.method} ${url.pathname}${query}`);
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
        return makeErrorResponse(`Invalid request method ${req.method}`, 405);
    }

    if (url.pathname === "/favicon.ico") {
        return makeErrorResponse(`There is no favicon for this application`, 404);
    }
    if (url.searchParams.has("width")) {
        // Check if the requested width is allowed
        const width = parseInt(url.searchParams.get("width") ?? "-1", 10);
        if (!allowedWidthsPx.includes(width)) {
            return makeErrorResponse(`Invalid width requested: ${url.searchParams.get("width")}`);
        }
        // We need to pass this request on to imgproxy and stream the response
        try {
            // Build the signed request for imgproxy:
            const imgProxyRequest =
                `/rs:fit:${width}/q:${quality}/plain/${upstreamImageSourcePrefix}${url.pathname}@${thumbnailImageFormat}`;
            const hmac = await sha256hmac(imgProxyKey, imgProxySalt + imgProxyRequest);
            const signature = encodeBase64UrlSafe(hmac);
            const requestUrl = `${imgproxyUrl}/${signature}${imgProxyRequest}`;
            const thumbnailResponse = await fetch(requestUrl);
            if (thumbnailResponse.status !== 200) {
                throw new Error(await thumbnailResponse.text());
            }
            console.log(
                ` -> Streaming ${url.pathname} from imgproxy (width ${width}, request ID ${
                    thumbnailResponse.headers.get("x-request-id")
                })`,
            );
            return thumbnailResponse;
        } catch (err) {
            return makeErrorResponse(`Streaming ${url.pathname} from imgproxy failed: ${err.message}`);
        }
    } else {
        // Redirect this to the underlying object storage.
        return new Response("", {
            status: 301,
            headers: {
                Location: `${upstreamImageSourcePrefix}${url.pathname}`,
                // Cache this redirect response for up to seven days:
                "Cache-Control": "public, max-age=604800, immutable, stale-while-revalidate=604800",
            },
        });
    }
}

serve(handler, { port });
console.log(`imgproxy-gateway listening on port ${port}`);
