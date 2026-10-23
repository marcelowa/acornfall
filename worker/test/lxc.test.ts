import { expect, test } from "bun:test";
import { engineName, isOngoingCreation, lxcAttachArgs, machinePath, rootfsOf } from "../src/lxc.ts";

// The name is the one control sends, so the two sides of one install cannot disagree about
// which engine is in use.
test("the container engine is named lxc", () => {
	expect(engineName()).toBe("lxc");
});

// A workspace is mounted into its container at its own path, so its files are the machine's
// own; everything else lives inside the container's rootfs, which is a folder in the machine.
test("a path inside the container maps to the machine", () => {
	const rootfs = rootfsOf("acornfall-general-1234");
	expect(rootfs).toBe("/var/lib/lxc/acornfall-general-1234/rootfs");
	expect(machinePath(rootfs, "/home/me/work", "/home/me/work")).toBe("/home/me/work");
	expect(machinePath(rootfs, "/home/me/work", "/home/me/work/src/main.ts")).toBe(
		"/home/me/work/src/main.ts",
	);
	expect(machinePath(rootfs, "/home/me/work", "/tmp/x")).toBe(
		"/var/lib/lxc/acornfall-general-1234/rootfs/tmp/x",
	);
	// A sibling whose name merely starts the same way is not inside the workspace.
	expect(machinePath(rootfs, "/home/me/work", "/home/me/workshop")).toBe(
		"/var/lib/lxc/acornfall-general-1234/rootfs/home/me/workshop",
	);
	// A relative path is a path inside the container, not a path in the machine's cwd.
	expect(machinePath(rootfs, "/home/me/work", "notes.txt")).toBe(
		"/var/lib/lxc/acornfall-general-1234/rootfs/notes.txt",
	);
});

// Control and the worker both start a stopped container; the second caller gets the runtime's
// "Ongoing container creation detected" while the first is still working. That is a lock, not a
// fault, and the worker waits for RUNNING instead of reporting a workspace with no sandbox.
test("a start that is still being made is not a failure", () => {
	expect(isOngoingCreation("lxc-start: x: Ongoing container creation detected")).toBe(true);
	expect(isOngoingCreation("lxc-start: x: Config file not found")).toBe(false);
});

// A command in an unprivileged container runs as the workspace's owner, or it cannot write the
// bind: the id map keeps that uid as itself and leaves root outside. A root-owned share runs
// privileged, where root is mapped, and the default attach is right.
test("a tool runs as the workspace's owner", () => {
	expect(lxcAttachArgs("acornfall-x", ["hostname"], { uid: 1001, gid: 1001 })).toEqual([
		"lxc-attach",
		"-n",
		"acornfall-x",
		"-u",
		"1001",
		"-g",
		"1001",
		"--",
		"hostname",
	]);
	expect(lxcAttachArgs("acornfall-x", ["hostname"], { uid: 0, gid: 0 })).toEqual([
		"lxc-attach",
		"-n",
		"acornfall-x",
		"--",
		"hostname",
	]);
	expect(lxcAttachArgs("acornfall-x", ["hostname"])).toEqual([
		"lxc-attach",
		"-n",
		"acornfall-x",
		"--",
		"hostname",
	]);
});
