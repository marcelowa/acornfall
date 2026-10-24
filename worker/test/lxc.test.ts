import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { engineName, homeOf, isOngoingCreation, lxcAttachArgs, machinePath, rootfsOf } from "../src/lxc.ts";

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

// The attach inherits this process's environment, and the appliance's HOME is "/", so every `~`
// in a workspace resolved to the root of the container's filesystem. Beta 60 to 63 mounted the
// home and wrote nothing into it (measured).
describe("the home a command gets", () => {
	test("is the container's, not the machine's", () => {
		const args = lxcAttachArgs("acornfall-x", ["hostname"], { uid: 1001, gid: 1001 }, "/home/acornfall");
		expect(args).toContain("-v");
		expect(args[args.indexOf("-v") + 1]).toBe("HOME=/home/acornfall");
	});

	test("is left alone when the container cannot name the uid", () => {
		expect(lxcAttachArgs("acornfall-x", ["hostname"], { uid: 1001, gid: 1001 }, "")).not.toContain("-v");
	});

	test("is read from the container's own passwd", async () => {
		const rootfs = await mkdtemp(join(tmpdir(), "acornfall-home-"));
		await mkdir(join(rootfs, "etc"), { recursive: true });
		await writeFile(
			join(rootfs, "etc", "passwd"),
			"root:x:0:0:root:/root:/bin/sh\nacornfall:x:1001:1001:acornfall:/home/acornfall:/bin/sh\n",
		);
		expect(homeOf(rootfs, 1001)).toBe("/home/acornfall");
		expect(homeOf(rootfs, 0)).toBe("/root");
		expect(homeOf(rootfs, 4242)).toBe("");
		expect(homeOf(join(rootfs, "nowhere"), 1001)).toBe("");
	});
});
