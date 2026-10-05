package control

import (
	"errors"
	"testing"

	"github.com/acornfall/acornfall/gateway/internal/workerpool"
)

// A worker's death is only news if it is the worker that is running.
//
// The notification arrives from the process that ended, which can be one that was already
// replaced by a restart. Acting on it then marked a live workspace as down — the interface said
// "harness down" with the previous process's error while a healthy one was serving — and the
// signal woke the supervisor, which started a second harness over the same storage. Two writers,
// from a late message about a dead process.
//
// No processes are needed to test the rule: the identity of the dying worker is the whole of it.
func TestOnlyTheCurrentWorkersDeathCounts(t *testing.T) {
	control := New(Options{Workspace: Workspace{Name: "w", Path: t.TempDir()}})

	replaced := workerpool.New(workerpool.Config{})
	current := workerpool.New(workerpool.Config{})
	control.worker = current
	control.workerUp = true

	// A death reported for a worker that has been replaced changes nothing, and does not wake
	// the supervisor.
	control.workerFailed(replaced, errors.New("signal: killed"))
	if !control.WorkerUp() {
		t.Error("a replaced worker's death marked the running one down")
	}
	if control.workerError != "" {
		t.Errorf("a replaced worker's death wrote an error onto a healthy workspace: %q", control.workerError)
	}
	select {
	case <-control.workerExited:
		t.Error("a replaced worker's death woke the supervisor, which would start a second harness")
	default:
	}

	// The worker that is running is a different matter: it goes down, and the supervisor is told.
	control.workerFailed(current, errors.New("signal: killed"))
	if control.WorkerUp() {
		t.Error("the running worker's death should mark the workspace down")
	}
	if control.workerError == "" {
		t.Error("the death should carry a reason")
	}
	select {
	case <-control.workerExited:
	default:
		t.Error("the running worker's death should wake the supervisor")
	}
}
