import type { StorybookConfig } from "@storybook/tanstack-react";

const config: StorybookConfig = {
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y"],
  framework: {
    name: "@storybook/tanstack-react",
    options: {},
  },
  stories: ["../src/**/*.stories.@(ts|tsx)"],
};

export default config;
