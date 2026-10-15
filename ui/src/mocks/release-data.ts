/**
 * The release surface's mock data for run 4 of the refactor-ux chain. The tags, dates, asset
 * sizes and notes are this repository's own releases, read from GitHub and from the tag
 * annotations — the notes are the tag messages, because the GitHub release bodies are null for
 * every release so far (finding, `06-mocks.md`). `ui/src/mocks/` is deleted in the build step.
 */
export interface MockRelease {
	tag: string;
	/** Published date, as the API gives it. */
	date: string;
	/** Binary bytes for this platform and the worker tarball. */
	size: number;
	workerSize: number;
	prerelease: boolean;
	notes: string;
}

const mb = 1_000_000;
const kb = 1_000;

/** Newest first, as the gateway's list answers. */
export const releases: MockRelease[] = [
	{
		tag: "v0.9.33",
		date: "2026-10-13",
		size: 13.6 * mb,
		workerSize: 81 * kb,
		prerelease: false,
		notes: "Provider sign-in: a long address cannot widen the dialog, the dialog keeps its frame and its slots across its steps, a prompt the provider resolved goes away, and the providers list stops lying about a key it cannot forget.",
	},
	{
		tag: "v0.9.32",
		date: "2026-10-13",
		size: 13.6 * mb,
		workerSize: 81 * kb,
		prerelease: false,
		notes: "Provider sign-in: a prompt cannot be lost, an unanswered sign-in cannot hold up the worker, the connect dialog shows the sign-in address for a headless paste, and OpenAI's ChatGPT sign-in gets a stable install id.",
	},
	{
		tag: "v0.9.31",
		date: "2026-10-13",
		size: 13.6 * mb,
		workerSize: 80 * kb,
		prerelease: false,
		notes: "The rail is a stack: the workspaces list fills the sidebar, its X goes back to the conversations, and a desktop behaves like the phone.",
	},
	{
		tag: "v0.9.30",
		date: "2026-10-13",
		size: 13.6 * mb,
		workerSize: 80 * kb,
		prerelease: false,
		notes: "Two small fixes on top of the phone pass: the rail's toggle is the familiar hamburger, and a pasted token can no longer widen the console.",
	},
	{
		tag: "v0.9.29",
		date: "2026-10-12",
		size: 13.6 * mb,
		workerSize: 80 * kb,
		prerelease: false,
		notes: "The phone pass: one layer with one close, a folded composer, one keyboard variable, a 44px thumb ladder below sm, and the workspaces list as a layer with no address. See docs/ui-workflow/refactor-ux/run-2/.",
	},
	{
		tag: "v0.9.28",
		date: "2026-10-12",
		size: 13.6 * mb,
		workerSize: 80 * kb,
		prerelease: false,
		notes: "The refactor-ux pass: the rail row carries spend and when it moved; cards fold to two lines from their header; a message keeps the mark it was sent with; Enter does what the buttons offer; one commit moment in settings; the sandbox moved to the workspaces row menu; theme into Defaults; an even phone type ladder; and clipped text one gesture from being read.",
	},
	{
		tag: "v0.9.27",
		date: "2026-10-12",
		size: 13.6 * mb,
		workerSize: 80 * kb,
		prerelease: false,
		// No notes at all: the tag shipped with only its own name. A real state the page must
		// carry without looking broken.
		notes: "",
	},
	{
		tag: "v0.9.26",
		date: "2026-10-11",
		size: 13.6 * mb,
		workerSize: 80 * kb,
		prerelease: false,
		notes: "Amber brand system: bronze primary, blue secondary, ember warning on warm bark neutrals, both themes. Dark-mode brand mark, theme-aware favicon.",
	},
	{
		tag: "v0.9.25",
		date: "2026-10-11",
		size: 13.6 * mb,
		workerSize: 80 * kb,
		prerelease: false,
		notes: "Favicon follows the new brand mark: one logo everywhere.",
	},
	{
		tag: "v0.9.24",
		date: "2026-10-11",
		size: 13.6 * mb,
		workerSize: 80 * kb,
		prerelease: false,
		notes: "New brand mark: the long acornfall logo, sized by height so its portrait ratio survives.",
	},
	{
		tag: "v0.9.23",
		date: "2026-10-11",
		size: 13.6 * mb,
		workerSize: 79 * kb,
		prerelease: false,
		notes: "Attachments: SVG rides inline as text, image parts carry a real mime, other rasters ride as a path. Binary files are described by kind, size, and place so the model decides what to do.",
	},
	{
		tag: "v0.9.22",
		date: "2026-10-11",
		size: 13.6 * mb,
		workerSize: 79 * kb,
		prerelease: false,
		notes: "Files and images ride with a message: staged under the workspace's hidden .attachments folder; image parts, inline text, or a sandbox path for the model. Caps 10 MB per file, 20 files and 100 MB per message.",
	},
	{
		tag: "v0.9.21",
		date: "2026-10-11",
		size: 13.5 * mb,
		workerSize: 77 * kb,
		prerelease: false,
		notes: "Client reloads on its own after the server restarts under it. Update button disables with an Updating label while the apply call runs.",
	},
	{
		tag: "v0.9.20",
		date: "2026-10-11",
		size: 13.5 * mb,
		workerSize: 77 * kb,
		prerelease: false,
		notes: "Slash compaction reports what it folded: entries and turns, plus the last reply's provider tokens with a percent of the window.",
	},
	{
		tag: "v0.9.19",
		date: "2026-10-11",
		size: 13.5 * mb,
		workerSize: 76 * kb,
		prerelease: false,
		notes: "Slash builtins show busy while they run and answer when done: summary card on a real fold, Nothing to compact note on a short talk.",
	},
	{
		tag: "v0.9.18",
		date: "2026-10-11",
		size: 13.5 * mb,
		workerSize: 75 * kb,
		prerelease: false,
		notes: "Slash builtins leave a trace: /compact and /clear are recorded in the transcript.",
	},
	{
		tag: "v0.9.17",
		date: "2026-10-11",
		size: 13.5 * mb,
		workerSize: 75 * kb,
		prerelease: false,
		notes: "Builtin slash commands: /compact and /clear always on offer, actions instead of turns.",
	},
	{
		tag: "v0.9.16",
		date: "2026-10-11",
		size: 13.5 * mb,
		workerSize: 75 * kb,
		prerelease: false,
		notes: "Manual compaction: context cost under the composer, Compact past 70%, preview dialog, summary card.",
	},
	{
		tag: "v0.9.15",
		date: "2026-10-11",
		size: 13.5 * mb,
		workerSize: 74 * kb,
		prerelease: false,
		notes: "fix(sandbox): lock migrations to the pinned engine (#61)",
	},
	{
		tag: "v0.9.14",
		date: "2026-10-11",
		size: 13.5 * mb,
		workerSize: 74 * kb,
		prerelease: false,
		notes: "fix(worker): wake an idle-stopped sandbox on the next tool call (#60)",
	},
];

/** One build that is not a release yet, so the pre-release switch has something to show. */
export const releaseCandidate: MockRelease = {
	tag: "v0.9.34-rc.1",
	date: "2026-10-15",
	size: 13.7 * mb,
	workerSize: 81 * kb,
	prerelease: true,
	notes: "Release candidate for the release surface: the page, the picker, and the bar's mark.",
};

/** The states the page is mocked in, as `06-mocks.md` lists them. */
export const devBuild = "dev";
export const rolledBackCause =
	"migrate failed, rolled back: migrate v0.9.33: exit 1: cannot open state/state.db";
