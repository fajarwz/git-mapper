import type { Repository } from "../types";
import { gitMapperRepo } from "./gitMapperRepo";
import { ledgerApiRepo } from "./ledgerApiRepo";

/** The repositories shown as tabs. Swapped for real repositories once Git plumbing lands. */
export const repositories: Repository[] = [gitMapperRepo, ledgerApiRepo];
