import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
import { Badge } from "@/components/ui/badge";
import { Text } from "@/components/typography/text";

export interface MockWorkspaceRowProps {
	name: string;
	path: string;
	/** A worker in this workspace is running a turn right now. */
	running?: boolean | undefined;
	/** The workspace the console is showing. */
	inView?: boolean | undefined;
}

/**
 * A workspace row that says whether anything is running in it. The finding (J2, TINKERER): the
 * screen shows title, path, in-view and Open, and ignores `running` — a field the app already
 * maps (`app/view-models.ts:17`). Checking on a workspace should not mean opening it.
 *
 * The row wraps. The first version of this mock did not, and on a phone it kept its desktop
 * shape: the mark, the badge and the two buttons sat on one line that could not shrink, so the
 * row ran off the screen. The real screen has the same non-wrapping row
 * (`workspaces-screen.tsx`), so step 09 owes it the same rule: below `sm`, the controls drop to
 * their own line instead of the row growing.
 */
export function MockWorkspaceRow({ name, path, running, inView }: MockWorkspaceRowProps) {
	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-border bg-card px-3 py-2">
			<div className="flex min-w-0 flex-1 items-center gap-2">
				{running ? <StatusDot state="running" size="sm" /> : null}
				<div className="min-w-0 flex-1">
					<Text as="p" size="sm" weight="medium" className="truncate" dir="auto">
						{name}
					</Text>
					<Text as="p" size="2xs" tone="muted" className="truncate font-mono">
						{path}
					</Text>
				</div>
			</div>
			<div className="flex shrink-0 items-center gap-2">
				{running ? (
					<Text as="span" size="2xs" tone="muted">
						running
					</Text>
				) : null}
				{inView ? (
					<Badge variant="soft" tone="primary" size="sm">
						in view
					</Badge>
				) : (
					<Button type="button" variant="outline" size="xs">
						Open
					</Button>
				)}
				<Button type="button" variant="ghost" size="icon-xs" aria-label="Workspace actions">
					…
				</Button>
			</div>
		</div>
	);
}
