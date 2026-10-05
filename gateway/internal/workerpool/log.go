package workerpool

import "log"

// Log writes worker diagnostics to stderr. stdout carries protocol frames only.
func Log(format string, args ...any) {
	log.Printf(format, args...)
}
