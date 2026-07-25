import { system } from "@hztrmnl/config/system";
import { createApp } from "./app.ts";

// Entry point: read the mounted config, build the graph, serve it. Every
// decision worth testing lives in createApp (app.ts).

const { app, shutdown } = await createApp(system);

console.log(`trmnl-byos-deno on :${system.port}${system.debug ? " (debug mode)" : ""}`);
await Deno.serve({ port: system.port, hostname: "0.0.0.0" }, app.fetch).finished;
await shutdown();
