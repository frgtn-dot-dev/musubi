import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { Avatar, type AvatarSize } from "./Avatar";
import styles from "./AvatarStories.module.css";

const meta = {
  args: {
    name: "Mika Tanaka",
  },
  component: Avatar,
  title: "Primitives/Avatar",
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {};

const SCALE: ReadonlyArray<{ label: string; name: string; size: AvatarSize }> = [
  { label: "Compact", name: "Ari", size: "compact" },
  { label: "Default", name: "Mika", size: "default" },
  { label: "Profile", name: "Ren", size: "profile" },
];

export const Sizes: Story = {
  render: () => (
    <div className={styles.list}>
      {SCALE.map((item) => (
        <div className={styles.identity} key={item.label}>
          <Avatar name={item.name} size={item.size} />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  ),
};
