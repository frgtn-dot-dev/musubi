import type { StorybookConfig } from "@storybook/tanstack-react";

const STORYBOOK_ALLOWED_HOSTS = ["storybook.f-tuma.dev"];

const config: StorybookConfig = {
  addons: [
    "@storybook/addon-docs",
    "@storybook/addon-a11y",
    "@storybook/addon-vitest",
    "@chromatic-com/storybook",
  ],
  core: {
    allowedHosts: STORYBOOK_ALLOWED_HOSTS,
  },
  framework: {
    name: "@storybook/tanstack-react",
    options: {},
  },
  stories: ["../src/**/*.stories.@(ts|tsx)"],
};

export default config;
