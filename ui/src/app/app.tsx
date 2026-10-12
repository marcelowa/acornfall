import { useKeyboardInset } from "@/lib/keyboard";
import { WorkspaceView } from "./workspace-view";
import { usePlatform } from "./use-platform";

/** The app: the platform hook, the keyboard inset, and the composition that applies them. */
export function App() {
	// One hook for the phone's keyboard: it writes `--keyboard-inset`, and the composer reserves
	// it. Nothing else in the app knows how a keyboard works.
	useKeyboardInset();
	return <WorkspaceView platform={usePlatform()} />;
}
