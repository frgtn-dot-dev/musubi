import { createContext } from "react";

/** Portals retain React context so a picker paints above its owning dialog. */
export const ElevatedDialogContext = createContext(false);
