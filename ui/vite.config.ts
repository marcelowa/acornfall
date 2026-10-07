import process from "node:process";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
	},
	build: {
		// The gateway embeds this directory; `make ui-build` then restores the placeholder
		// that keeps `go:embed` satisfiable. Outside the project root, Vite needs to be told
		// it may empty the directory.
		outDir: "../gateway/web/dist",
		emptyOutDir: true,
	},
	server: {
		// In production the app talks to the gateway on its own origin; in development the dev
		// server forwards /api there, so the client has one URL scheme either way. Point it at
		// a tailnet-bound gateway with VITE_GATEWAY when that is where `make dev` listens.
		proxy: {
			"/api": process.env["VITE_GATEWAY"] ?? "http://127.0.0.1:7777",
		},
	},
});
