// Stopgap entry point. PLUGIN_DIR resolves to templates/example/, so the
// deployed Plugin's main.ts must live here. This restructure only moves
// Transport into transport/; the Super-Plugin that routes Transport <->
// Gallery lands in a follow-up PR and replaces this re-export.
export { default } from "./transport/main.ts";
