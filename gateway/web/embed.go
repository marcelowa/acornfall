// Package web embeds the interface the gateway serves.
//
// The interface is built, not committed: `make ui-build` runs Vite over `ui/` and writes
// here, and `make build` depends on it. The placeholder that keeps `go:embed` satisfiable
// in a fresh checkout is the only file in the tree; everything else is generated and
// ignored. A binary built without it answers 500 with "client not found", which is the
// honest answer to a request for something that was never built.
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// Files is the built interface, rooted at its index.html.
var Files = func() fs.FS {
	root, err := fs.Sub(dist, "dist")
	if err != nil {
		// The embed above cannot succeed without the directory, so this is unreachable.
		panic(err)
	}
	return root
}()
