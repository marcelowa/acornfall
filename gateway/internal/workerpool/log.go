package workerpool

import (
	"log"
	"os"
)

// Log writes worker diagnostics to stderr. stdout carries protocol frames only.
func Log(format string, args ...any) {
	log.Printf(format, args...)
}

func init() {
	log.SetOutput(os.Stderr)
	log.SetFlags(log.Ltime)
}
