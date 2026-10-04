// Package web embeds the client. v0 has no build step: ES modules served as-is.
package web

import "embed"

//go:embed index.html app.js style.css
var Files embed.FS
