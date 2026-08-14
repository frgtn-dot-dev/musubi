import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { Avatar } from "./Avatar";
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

export const Sizes: Story = {
  render: () => (
    <div className={styles.list}>
      {[
        { label: "Compact", name: "Ari", size: 28 },
        { label: "Default", name: "Mika", size: 36 },
        { label: "Profile", name: "Ren", size: 52 },
      ].map((item) => (
        <div className={styles.identity} key={item.label}>
          <Avatar name={item.name} size={item.size} />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  ),
};
