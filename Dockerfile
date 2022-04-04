FROM denoland/deno:alpine-1.20.4
WORKDIR /imgproxy-gateway
ENV DENO_DIR /imgproxy-gateway/deno_dir
RUN mkdir /imgproxy-gateway/deno_dir

COPY mod.ts /imgproxy-gateway/mod.ts

# Cache dependencies and check types
RUN deno cache mod.ts

# The service runs on port 5558 by default
EXPOSE 5558

# Start the server
CMD ["deno", "run", "--no-check", "--allow-net", "--allow-env", "mod.ts"]
