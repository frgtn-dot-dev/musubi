import type { StorybookConfig } from "@storybook/tanstack-react";
import { mergeConfig } from "vite";

const STORYBOOK_ALLOWED_HOSTS = ["storybook.f-tuma.dev"];

const config: StorybookConfig = {
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y"],
  framework: {
    name: "@storybook/tanstack-react",
    options: {},
  },
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  viteFinal: async (config) =>
    mergeConfig(config, {
      server: {
        allowedHosts: STORYBOOK_ALLOWED_HOSTS,
      },
    }),
};

export default config;
