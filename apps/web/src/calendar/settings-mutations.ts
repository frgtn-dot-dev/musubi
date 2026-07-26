import type {
  PatchSettingsRequest,
  SettingsDocument,
} from "@musubi/types";
import { useQueryClient } from "@tanstack/react-query";
import {
  getSettingsDocument,
  patchSettings,
} from "~/api/resources";
import { getServerOrigin, queryKeys } from "~/api/query-keys";

export function useSettingsMutations(userId: string) {
  const queryClient = useQueryClient();
  const settingsKey = queryKeys.settings(getServerOrigin(), userId);
  const adopt = (document: SettingsDocument) => {
    queryClient.setQueryData(settingsKey, document.value);
  };

  return {
    adoptSettings: adopt,
    getSettingsDocument,
    patchSettings: async (request: PatchSettingsRequest) => {
      const document = await patchSettings(request);
      adopt(document);
      return document;
    },
  };
}
