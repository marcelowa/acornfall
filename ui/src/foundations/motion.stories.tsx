import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@/components/layout/stack";
import { Code } from "@/components/typography/code";
import { Heading } from "@/components/typography/heading";
import { Text } from "@/components/typography/text";

const meta = {
	title: "Foundations/Motion",
	parameters: {
		layout: "fullscreen",
		docs: {
			description: {
				story: "Durations and easings are named in the tokens; the default transition uses the normal duration and the in-out easing, so a component that says transition-colors is already on the system. Hover a track to see the curve.",
			},
		},
	},
	tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const easings = [
	{ name: "--base-ease-in", value: "var(--base-ease-in)" },
	{ name: "--base-ease-out", value: "var(--base-ease-out)" },
	{ name: "--base-ease-in-out", value: "var(--base-ease-in-out)" },
];

const durations = [
	{ name: "--base-duration-fast", value: "var(--base-duration-fast)" },
	{ name: "--base-duration-normal", value: "var(--base-duration-normal)" },
	{ name: "--base-duration-slow", value: "var(--base-duration-slow)" },
];

function Track({ timingFunction, duration }: { timingFunction: string; duration: string }) {
	return (
		<div className="group flex w-40 items-center rounded-md bg-muted p-2">
			<div
				className="size-6 rounded-sm bg-primary transition-transform group-hover:translate-x-24"
				style={{ transitionDuration: duration, transitionTimingFunction: timingFunction }}
			/>
		</div>
	);
}

export const Motion: Story = {
	render: () => (
		<div className="mx-auto w-full max-w-3xl p-8">
			<Stack gap="xl">
				<Stack gap="xs">
					<Heading level={1}>Motion</Heading>
					<Text tone="muted">
						Hover a track. The timings are tokens; the classes a component types are
						transition-colors and duration-200, whose default is the normal token.
					</Text>
				</Stack>
				<Stack gap="md">
					<Heading level={3}>Easing</Heading>
					<Stack gap="sm">
						{easings.map((easing) => (
							<div key={easing.name} className="flex items-center gap-4">
								<Track
									timingFunction={easing.value}
									duration="var(--base-duration-slow)"
								/>
								<Code>{easing.name}</Code>
							</div>
						))}
					</Stack>
				</Stack>
				<Stack gap="md">
					<Heading level={3}>Duration</Heading>
					<Stack gap="sm">
						{durations.map((duration) => (
							<div key={duration.name} className="flex items-center gap-4">
								<Track
									timingFunction="var(--base-ease-out)"
									duration={duration.value}
								/>
								<Code>{duration.name}</Code>
							</div>
						))}
					</Stack>
				</Stack>
			</Stack>
		</div>
	),
};
