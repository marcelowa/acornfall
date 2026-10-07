import { WorkspaceView } from "./workspace-view";
import { usePlatform } from "./use-platform";

/** The app: the platform hook, and the composition that applies it. */
export function App() {
	return <WorkspaceView platform={usePlatform()} />;
}
