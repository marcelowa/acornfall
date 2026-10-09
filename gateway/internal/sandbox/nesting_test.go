package sandbox

import (
	"strings"
	"testing"
)

// The machine half of nesting has two shapes: a Linux kernel parameter and an Apple chip.
// Both are parsed rather than executed here, so the decisions can be tested on any machine.

func TestNestedFromKVMParameters(t *testing.T) {
	cases := []struct {
		name          string
		intel, amd    string
		wantAvailable bool
		wantReason    string
	}{
		{"intel on", "Y\n", "", true, ""},
		{"intel off", "N\n", "", false, "kvm_intel.nested=0"},
		{"amd on", "", "1\n", true, ""},
		{"amd off", "", "0\n", false, "kvm_amd.nested=0"},
		{"one of two on", "N\n", "1\n", true, ""},
		{"neither module reports", "", "", false, "does not report nested virtualization"},
		{"a value nobody wrote", "", "maybe", false, "does not report nested virtualization"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			got := nestedFromKVMParameters(test.intel, test.amd)
			if got.Available != test.wantAvailable {
				t.Fatalf("available = %t, want %t (%s)", got.Available, test.wantAvailable, got.Reason)
			}
			if test.wantReason == "" {
				if got.Reason != "" {
					t.Errorf("an available answer carries no reason, got %q", got.Reason)
				}
				return
			}
			if !strings.Contains(got.Reason, test.wantReason) {
				t.Errorf("reason = %q, want it to mention %q", got.Reason, test.wantReason)
			}
		})
	}
}

func TestNestedFromApple(t *testing.T) {
	cases := []struct {
		name          string
		brand         string
		version       string
		wantAvailable bool
		wantReason    string
	}{
		{"m3 on sequoia", "Apple M3", "15.0", true, ""},
		{"m4 on a later system", "Apple M4 Pro", "15.4", true, ""},
		{"m2 is too old", "Apple M2 Max", "15.0", false, "M3 or later"},
		{"sequoia is the floor", "Apple M3 Pro", "14.6", false, "macOS 15 or later"},
		{"an intel mac", "Intel(R) Core(TM) i9-9880H", "15.0", false, "M3 or later"},
		{"a version nobody wrote", "Apple M3", "", false, "cannot tell the macOS version"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			got := nestedFromApple(test.brand, test.version)
			if got.Available != test.wantAvailable {
				t.Fatalf("available = %t, want %t (%s)", got.Available, test.wantAvailable, got.Reason)
			}
			if test.wantReason == "" {
				if got.Reason != "" {
					t.Errorf("an available answer carries no reason, got %q", got.Reason)
				}
				return
			}
			if !strings.Contains(got.Reason, test.wantReason) {
				t.Errorf("reason = %q, want it to mention %q", got.Reason, test.wantReason)
			}
		})
	}
}
