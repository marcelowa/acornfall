import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export interface RenameDialogProps {
	open: boolean;
	/** What is being renamed: "Rename conversation", "Rename workspace". */
	title: string;
	/** The name it has now, which is what the field starts with. */
	initial: string;
	onSave: (name: string) => void;
	onCancel: () => void;
}

/**
 * Renaming something, in a dialog rather than a browser prompt. `window.prompt` blocks the
 * page — a test that clicked it by mistake wedged a whole run — cannot be styled, cannot say
 * what is being renamed, and offers no way back that a person can see.
 *
 * The name is trimmed, and an empty one is refused rather than saved: a nameless conversation
 * is not a rename, it is a deletion with extra steps.
 */
export function RenameDialog({ open, title, initial, onSave, onCancel }: RenameDialogProps) {
	const [name, setName] = useState(initial);

	// The field belongs to the thing being renamed; opening it again on something else starts
	// from that one's name.
	useEffect(() => {
		if (open) setName(initial);
	}, [open, initial]);

	const save = (): void => {
		const trimmed = name.trim();
		if (trimmed === "") return;
		onSave(trimmed);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onCancel();
			}}
		>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription className="sr-only">
						The name is shown in the rail and in the bar.
					</DialogDescription>
				</DialogHeader>
				<Input
					value={name}
					autoFocus
					aria-label="Name"
					onChange={(event) => setName(event.target.value)}
					onKeyDown={(event) => {
						if (event.key !== "Enter") return;
						event.preventDefault();
						save();
					}}
				/>
				<DialogFooter>
					<Button variant="ghost" onClick={onCancel}>
						Cancel
					</Button>
					<Button disabled={name.trim() === ""} onClick={save}>
						Save
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
