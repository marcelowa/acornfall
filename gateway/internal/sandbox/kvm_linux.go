//go:build linux

package sandbox

import (
	"fmt"
	"os"
	"os/user"
	"strconv"
	"syscall"
)

// kvmHint names the fix when /dev/kvm exists but this user cannot open it, which is the
// way to lose an afternoon: the device is there, the group is not.
func kvmHint() string {
	info, err := os.Stat("/dev/kvm")
	if err != nil {
		return ""
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return ""
	}
	if groups, err := os.Getgroups(); err == nil {
		for _, group := range groups {
			if group == int(stat.Gid) {
				return "; check the permission bits on /dev/kvm"
			}
		}
	}
	who := "the user"
	if current, err := user.Current(); err == nil && current.Username != "" {
		who = current.Username
	}
	group := strconv.Itoa(int(stat.Gid))
	if entry, err := user.LookupGroupId(group); err == nil && entry.Name != "" {
		group = entry.Name
	}
	return fmt.Sprintf("; add %s to the %s group and start a new session", who, group)
}
