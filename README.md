# imgproxy gateway

This imgproxy gateway is used to restrict access to a running [imgproxy](https://imgproxy.net/) service, by only passing
on requests for a particular host and with particular requirements.

In particular:

- Requests for the full-sized file just serve a 301 redirect to the underlying object storage (e.g. S3). We typically
  assume these downloads are rare, and large, and we don't need to cache them on our CDN.
- Requests for specific smaller-sized versions of the image will stream the result from imgproxy.

## Configuration:

- `IMGPROXY_GATEWAY_PORT`: what port to listen on, defaults to 5558.
- `IMGPROXY_KEY`: same as the imgproxy setting, also hex-encoded.
- `IMGPROXY_SALT`: same as the imgproxy setting, also hex-encoded.
- `IMGPROXY_GATEWAY_ALLOWED_WIDTHS`: List allowed image widths in pixels. Defaults to `[256, 640, 1000, 2000, 4000]`
- `IMGPROXY_GATEWAY_OBJSTORE_PUBLIC_URL_PREFIX`: The public URL prefix where the original source images are stored. Omit
  the trailing slash.
- `IMGPROXY_GATEWAY_IMGPROXY_URL`: The URL where this service can reach imgproxy. Omit the trailing slash.

## How to test

Start it with a command like this:

```
IMGPROXY_KEY=6E656F6C616365313233 IMGPROXY_SALT=6E656F73616C74 deno run --allow-env --allow-net --watch mod.ts
```

Then go to e.g. http://localhost:5558/_6y8O8Hrd2jP3kuKxzMnzWb_5gUszkTOAUFVvb5Tc5uBpW?width=1000
