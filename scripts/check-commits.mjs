// Validate commit messages against Conventional Commits 1.0.0.
//
// A subject that does not parse cannot be read as a change, and history is the only place the
// why of a change survives. `.agents/skills/conventional-commits/SKILL.md` is the standard; this is
// the check, run over a pull request's commits in CI and by hand before pushing.
//
// Usage: node scripts/check-commits.mjs [range]
//   (default: origin/main..HEAD when there is an origin, else the last commit)
import { execFileSync } from "node:child_process";

const TYPES = ["feat", "fix", "refactor", "perf", "test", "docs", "build", "ci", "chore", "revert", "style"];
const SUBJECT = new RegExp(`^(${TYPES.join("|")})(\\([a-z0-9._/-]+\\))?!?: [^ ].*[^.]$`);
const SUBJECT_LIMIT = 72;

function git(args) {
	return execFileSync("git", args, { encoding: "utf8" }).trimEnd();
}

/** A range that exists, so the check is useful without arguments. */
function defaultRange() {
	try {
		git(["rev-parse", "--verify", "origin/main"]);
		return "origin/main..HEAD";
	} catch {
		return "HEAD~1..HEAD";
	}
}

const range = process.argv[2] ?? defaultRange();
let shas;
try {
	shas = git(["rev-list", "--no-merges", range]).split("\n").filter((line) => line !== "");
} catch (error) {
	console.error(`cannot read commits in ${range}: ${error.message.split("\n")[0]}`);
	process.exit(1);
}

if (shas.length === 0) {
	console.log(`commits: nothing in ${range}`);
	process.exit(0);
}

const failures = [];
for (const sha of shas) {
	const message = git(["log", "-1", "--format=%B", sha]);
	const [subject = "", ...rest] = message.split("\n");
	const body = rest.join("\n").trim();
	const short = sha.slice(0, 8);

	if (subject.startsWith("Merge ")) continue;
	if (!SUBJECT.test(subject)) {
		failures.push(`${short}  ${subject}\n    not a conventional subject: expected "<type>(<scope>): <description>"`);
	}
	if (subject.length > SUBJECT_LIMIT) {
		failures.push(`${short}  ${subject.length} characters\n    the subject limit is ${SUBJECT_LIMIT}`);
	}
	if (body !== "" && rest[0] !== "") {
		failures.push(`${short}  ${subject}\n    no blank line between the subject and the body`);
	}
}

if (failures.length > 0) {
	console.error(`commit messages in ${range}:\n  - ${failures.join("\n  - ")}`);
	console.error(`\nThe standard is .agents/skills/conventional-commits/SKILL.md.`);
	process.exit(1);
}
console.log(`commits: ${shas.length} in ${range}, all conventional`);
